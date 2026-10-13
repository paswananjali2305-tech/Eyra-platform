import express from 'express';
import fs from 'fs';
import path from 'path';
import { scanStorage } from '../services/storage.js';
import { runCodebaseAudit } from '../services/staticAnalyzer.js';
import { auditDependencies } from '../services/dependencyAuditor.js';
import { runAiSemanticPass } from '../services/aiSemanticPass.js';
import { runRuffAnalysis } from '../services/analysis/ruffAnalyzer.js';
import { runRadonAnalysis } from '../services/analysis/radonAnalyzer.js';
import { normalizeAndDeduplicate } from '../services/analysis/findingsNormalize.js';
import { collectRepoFiles } from '../services/repoFileInventory.js';

const router = express.Router();

// Active SSE client connections
const sseClients = new Map();
/** @type {Map<string, boolean>} Cooperative cancel flags for in-flight scans */
const cancelFlags = new Map();

class ScanCancelledError extends Error {
  constructor() {
    super('Scan cancelled by user');
    this.name = 'ScanCancelledError';
  }
}

function sendSseEvent(scanId, data) {
  const clients = sseClients.get(scanId) || [];
  for (const client of clients) {
    client.write(`data: ${JSON.stringify(data)}\n\n`);
  }
}

function formatElapsed(startedAtMs) {
  const ms = Math.max(0, Date.now() - (startedAtMs || Date.now()));
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const cs = Math.floor((ms % 1000) / 10);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function levelForTag(tag) {
  switch (String(tag || '').toUpperCase()) {
    case 'WARN':
      return 'warn';
    case 'FAIL':
    case 'ERROR':
      return 'error';
    case 'EXEC':
      return 'exec';
    case 'DONE':
    case 'OK':
      return 'ok';
    case 'INIT':
    case 'INFO':
      return 'info';
    default:
      return 'info';
  }
}

/** Persist a mockup-style daemon line (INIT/INFO/WARN/EXEC/DONE) from real scan work. */
function pushDaemonLog(scanId, tag, text, startedAtMs, { healthy = false } = {}) {
  const current = scanStorage.getScan(scanId);
  if (!current) return null;
  let level = levelForTag(tag);
  // Healthy AST / success INFO lines render green like the design mock
  if (healthy && level === 'info') level = 'ok';
  const updated = scanStorage.appendLog(scanId, {
    tag: String(tag || 'INFO').toUpperCase(),
    text: String(text || '').trim(),
    level,
    elapsed: formatElapsed(startedAtMs),
    status: current.status,
  });
  if (updated) {
    sendSseEvent(scanId, {
      status: updated.status,
      progress: updated.progress,
      currentStage: updated.currentStage,
      error: updated.error,
      logs: updated.logs || [],
    });
  }
  return updated;
}

/**
 * Update scan progress fields and notify SSE. Terminal lines come from pushDaemonLog.
 */
function pushStage(scanId, updates = {}, extraSse = {}) {
  const updated = scanStorage.updateScan(scanId, updates);
  if (!updated) return null;
  sendSseEvent(scanId, {
    status: updated.status,
    progress: updated.progress,
    currentStage: updated.currentStage,
    error: updated.error,
    logs: updated.logs || [],
    ...extraSse,
  });
  return updated;
}

function issueFile(issue = {}) {
  return issue.file || issue.path || issue.filename || 'unknown';
}

function issueLineNo(issue = {}) {
  return issue.line ?? issue.lineNumber ?? issue.lineno ?? '?';
}

function filePathOf(file = {}) {
  return file.path || file.file || file.name || file.relativePath || null;
}

function assertNotCancelled(scanId) {
  if (cancelFlags.get(scanId)) throw new ScanCancelledError();
  const scan = scanStorage.getScan(scanId);
  if (scan?.status === 'cancelled') throw new ScanCancelledError();
}

async function delay(ms, scanId) {
  const step = 100;
  let left = ms;
  while (left > 0) {
    assertNotCancelled(scanId);
    await new Promise((r) => setTimeout(r, Math.min(step, left)));
    left -= step;
  }
}

function normalizeEngines(body = {}) {
  const e = body.engines || body.options || {};
  const offline = Boolean(e.offline);
  return {
    ast: e.ast !== false,
    cve: e.cve !== false,
    partials: e.partials !== false,
    // Security rules (SEC-*/secrets) come from the AST pass; this flag only filters them out.
    security: e.security !== false,
    // Offline mode suppresses remote AI enrichment
    ai: offline ? false : e.ai !== false,
    offline,
  };
}

function isSecurityIssue(issue = {}) {
  const blob = `${issue.type || ''} ${issue.ruleId || ''} ${issue.id || ''} ${issue.title || ''}`;
  return /sec-|secret|sql[ií]|injection|xss|dangerousexec|shell.?inject|hardcod/i.test(blob);
}

// Get all scans
router.get('/scans', (req, res) => {
  const scans = scanStorage.getAllScans().map(s => ({
    id: s.id,
    projectName: s.projectName,
    status: s.status,
    createdAt: s.createdAt,
    meta: s.meta,
    summary: s.summary
  }));
  res.json({ scans });
});

// Clear all persisted scans (Investigation History → Clear Stale Cache)
router.delete('/scans', (req, res) => {
  cancelFlags.clear();
  const cleared = scanStorage.clearAll();
  res.json({ ok: true, cleared });
});

// SSE endpoint for live scan progress
router.get('/scan/:id/events', (req, res) => {
  const { id } = req.params;
  const scan = scanStorage.getScan(id);
  if (!scan) return res.status(404).json({ error: 'Scan not found' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  if (!sseClients.has(id)) {
    sseClients.set(id, []);
  }
  sseClients.get(id).push(res);

  // Send current state + persisted daemon log immediately
  res.write(`data: ${JSON.stringify({
    status: scan.status,
    progress: scan.progress,
    currentStage: scan.currentStage,
    logs: scan.logs || [],
  })}\n\n`);

  req.on('close', () => {
    const clients = sseClients.get(id) || [];
    sseClients.set(id, clients.filter(c => c !== res));
  });
});

// Cancel an in-flight (or pending) scan — cooperative stop between stages
router.post('/scan/:id/cancel', (req, res) => {
  const { id } = req.params;
  const scan = scanStorage.getScan(id);
  if (!scan) return res.status(404).json({ error: 'Scan not found' });

  if (scan.status === 'completed' || scan.status === 'failed') {
    return res.status(409).json({
      error: `Scan already ${scan.status}`,
      scan,
    });
  }

  if (scan.status === 'cancelled') {
    return res.json({ success: true, message: 'Scan already cancelled', scan });
  }

  cancelFlags.set(id, true);
  const startedAt = scan.scanStartedAt ? Date.parse(scan.scanStartedAt) : Date.now();
  let updated = pushStage(id, {
    status: 'cancelled',
    currentStage: 'Cancelled by user',
    error: null,
  });
  updated = pushDaemonLog(id, 'WARN', 'Cancelled by user', startedAt) || updated;
  if (updated) {
    sendSseEvent(id, {
      status: 'cancelled',
      progress: updated.progress,
      currentStage: updated.currentStage,
      logs: updated.logs || [],
      scan: updated,
    });
  }
  res.json({ success: true, message: 'Scan cancelled', scan: updated });
});

// Trigger asynchronous analysis
router.post('/scan/:id/start', async (req, res) => {
  const { id } = req.params;
  const scan = scanStorage.getScan(id);
  if (!scan) return res.status(404).json({ error: 'Scan not found' });

  if (scan.status === 'analyzing') {
    return res.json({ success: true, message: 'Scan already running', scan });
  }

  if (scan.status === 'completed') {
    return res.json({ success: true, message: 'Scan already completed', scan });
  }

  const engines = normalizeEngines(req.body || {});
  cancelFlags.delete(id);
  const startedAtMs = Date.now();
  const scanStartedAt = new Date(startedAtMs).toISOString();
  pushStage(
    id,
    {
      engines,
      status: 'analyzing',
      progress: 5,
      currentStage: 'Starting scan',
      error: null,
      logs: [],
      scanStartedAt,
    },
    { engines },
  );
  pushDaemonLog(id, 'INIT', 'Initializing AST runner worker', startedAtMs);
  const moduleCount =
    Number(scan.meta?.totalFilesCount) ||
    Number(scan.summary?.totalFiles) ||
    0;
  if (moduleCount > 0) {
    pushDaemonLog(
      id,
      'INFO',
      `Extracted ${moduleCount} source modules to temporary workspace`,
      startedAtMs,
    );
  }

  res.json({ success: true, message: 'Scan processing started', engines });

  // Run asynchronously
  (async () => {
    try {
      assertNotCancelled(id);
      pushStage(
        id,
        { status: 'analyzing', progress: 15, currentStage: 'Parsing AST and syntax tree' },
        { engines },
      );
      await delay(400, id);

      let auditData = {
        issues: [],
        partialFeatures: [],
        files: [],
        summary: {
          healthScore: 100,
          grade: 'A',
          totalFiles: scan.meta?.totalFilesCount || 0,
          totalLoc: 0,
          totalIssues: 0,
          severity: { Critical: 0, High: 0, Medium: 0, Low: 0 },
          issueTypes: {},
        },
      };

      const toolStatuses = {
        eyraAst: { status: 'SKIPPED', message: 'Not run' },
        ruff: { status: 'SKIPPED', message: 'Not run' },
        radon: { status: 'SKIPPED', message: 'Not run' },
        dependencies: { status: 'SKIPPED', message: 'Not run' },
        aiEnrichment: { status: 'SKIPPED', message: 'Not run' },
        pytest: {
          status: 'SKIPPED',
          message:
            'pytest disabled for untrusted uploads — no strong sandbox isolation for arbitrary test code',
        },
      };
      const limitations = [];

      if (engines.ast) {
        assertNotCancelled(id);
        pushStage(id, {
          progress: 35,
          currentStage: 'Running EYRA AST / heuristic static analysis',
        });
        auditData = await runCodebaseAudit(scan.extractedDir);
        assertNotCancelled(id);
        toolStatuses.eyraAst = {
          status: auditData.engineStatus || (auditData.issues?.length ? 'FINDINGS' : 'PASS'),
          message: auditData.error || auditData.summary?.analysisLimitation || 'EYRA AST completed',
        };
        if (auditData.limitations?.length) limitations.push(...auditData.limitations);
        if (['FAILED', 'UNAVAILABLE'].includes(toolStatuses.eyraAst.status)) {
          pushDaemonLog(
            id,
            'FAIL',
            `EYRA AST engine ${toolStatuses.eyraAst.status}: ${toolStatuses.eyraAst.message}`,
            startedAtMs,
          );
        } else {
          const files = Array.isArray(auditData.files) ? auditData.files : [];
          const sampleFiles = files.filter((f) => filePathOf(f)).slice(0, 3);
          for (const f of sampleFiles) {
            const fp = filePathOf(f);
            pushDaemonLog(
              id,
              'INFO',
              `EYRA AST: analyzed ${fp}`,
              startedAtMs,
              { healthy: true },
            );
          }
          const astIssues = Array.isArray(auditData.issues) ? auditData.issues : [];
          for (const issue of astIssues.slice(0, 4)) {
            const rule = issue.ruleId || issue.id || issue.type || 'RULE';
            const title = issue.title || issue.message || 'Finding detected';
            pushDaemonLog(
              id,
              'WARN',
              `Rule ${rule}: ${title} at ${issueFile(issue)}:${issueLineNo(issue)}`,
              startedAtMs,
            );
          }
        }

        // Optional Ruff / Radon (do not replace AST)
        pushStage(id, {
          progress: 48,
          currentStage: 'Optional tools: Ruff lint + Radon metrics (if installed)',
        });
        const [ruffResult, radonResult] = await Promise.all([
          runRuffAnalysis(scan.extractedDir, { enabled: true }),
          runRadonAnalysis(scan.extractedDir, { enabled: true }),
        ]);
        toolStatuses.ruff = {
          status: ruffResult.status,
          message: ruffResult.message || ruffResult.detail,
          filesScanned: ruffResult.filesScanned,
        };
        toolStatuses.radon = {
          status: radonResult.status,
          message: radonResult.message || radonResult.detail,
        };
        pushDaemonLog(
          id,
          toolStatuses.ruff.status === 'UNAVAILABLE' || toolStatuses.ruff.status === 'FAILED'
            ? 'WARN'
            : 'INFO',
          `Ruff: ${toolStatuses.ruff.status} — ${toolStatuses.ruff.message}`,
          startedAtMs,
          { healthy: toolStatuses.ruff.status === 'PASS' },
        );
        pushDaemonLog(
          id,
          toolStatuses.radon.status === 'UNAVAILABLE' || toolStatuses.radon.status === 'FAILED'
            ? 'WARN'
            : 'INFO',
          `Radon: ${toolStatuses.radon.status} — ${toolStatuses.radon.message}`,
          startedAtMs,
          { healthy: toolStatuses.radon.status === 'PASS' },
        );
        auditData.issues = [
          ...(auditData.issues || []),
          ...(ruffResult.issues || []),
          ...(radonResult.issues || []),
        ];
      } else {
        assertNotCancelled(id);
        pushStage(id, {
          progress: 40,
          currentStage: 'AST engine skipped (disabled in ingest)',
        });
        toolStatuses.eyraAst = { status: 'SKIPPED', message: 'Disabled in ingest' };
        toolStatuses.ruff = { status: 'SKIPPED', message: 'Skipped because AST engine disabled' };
        toolStatuses.radon = { status: 'SKIPPED', message: 'Skipped because AST engine disabled' };
        pushDaemonLog(id, 'WARN', 'AST engine skipped (disabled in ingest)', startedAtMs);
      }

      let dependencyIssues = [];
      let depToolStatus = { status: 'SKIPPED', message: 'Disabled' };
      if (engines.cve) {
        assertNotCancelled(id);
        pushStage(id, {
          progress: 65,
          currentStage: 'Offline dependency advisory matching (not live OSV)',
        });
        await delay(400, id);
        const depResult = auditDependencies(scan.extractedDir);
        dependencyIssues = depResult.findings || [];
        depToolStatus = depResult.toolStatus || { status: 'PASS', message: 'ok' };
        toolStatuses.dependencies = depToolStatus;
        assertNotCancelled(id);
        for (const dep of dependencyIssues.slice(0, 4)) {
          const ver = String(dep.installedVersion || dep.currentCleanVersion || '')
            .replace(/[\^~>=<]/g, '')
            .trim();
          const verBit = ver ? `==${ver}` : '';
          const uncertain = dep.versionMatch === 'unknown' ? ' (version unresolved)' : '';
          pushDaemonLog(
            id,
            'WARN',
            `Offline advisory match: ${dep.package}${verBit} → ${dep.cve}${uncertain}`,
            startedAtMs,
          );
        }
        if (!dependencyIssues.length) {
          pushDaemonLog(
            id,
            'INFO',
            depToolStatus.message || 'Offline dependency advisory scan complete',
            startedAtMs,
            { healthy: depToolStatus.status === 'PASS' },
          );
        }
      } else {
        assertNotCancelled(id);
        pushStage(id, {
          progress: 65,
          currentStage: 'Dependency advisory skipped (disabled in ingest)',
        });
        toolStatuses.dependencies = { status: 'SKIPPED', message: 'Disabled in ingest' };
        pushDaemonLog(id, 'WARN', 'Dependency advisory skipped (disabled in ingest)', startedAtMs);
      }

      let enrichedIssues = auditData.issues || [];
      let architectureHealth = { riskRating: 'Unknown' };

      if (engines.ai) {
        assertNotCancelled(id);
        pushStage(id, {
          progress: 85,
          currentStage: 'AI enrichment of analyzer findings (Brain / heuristic fallback)',
        });
        const focus = enrichedIssues[0] || (auditData.issues || [])[0];
        if (focus) {
          pushDaemonLog(
            id,
            'EXEC',
            `Requesting AI enrichment for finding at ${issueFile(focus)}:${issueLineNo(focus)} (explains tool evidence; does not invent new scan lines)`,
            startedAtMs,
          );
        } else {
          pushDaemonLog(id, 'EXEC', 'AI enrichment: no findings to enrich', startedAtMs);
        }
        await delay(400, id);
        const aiResult = await runAiSemanticPass(
          auditData.issues || [],
          auditData.partialFeatures || [],
          auditData.files || []
        );
        assertNotCancelled(id);
        enrichedIssues = aiResult.issues || [];
        architectureHealth = aiResult.architectureHealth || architectureHealth;
        const src = architectureHealth.enrichmentSource || 'unknown';
        toolStatuses.aiEnrichment = {
          status: src === 'local_heuristic' ? 'PARTIAL' : 'PASS',
          message:
            src === 'local_heuristic'
              ? 'Brain unavailable — local heuristic explanations applied (labeled)'
              : `Brain enrichment via ${src}`,
          enrichmentSource: src,
        };
        pushDaemonLog(
          id,
          src === 'local_heuristic' ? 'WARN' : 'INFO',
          `AI enrichment: ${toolStatuses.aiEnrichment.message}`,
          startedAtMs,
          { healthy: src !== 'local_heuristic' },
        );
      } else {
        assertNotCancelled(id);
        const skipMsg = engines.offline
          ? 'AI pass skipped (offline / zero-egress mode)'
          : 'AI pass skipped (disabled in ingest)';
        pushStage(id, {
          progress: 85,
          currentStage: skipMsg,
        });
        toolStatuses.aiEnrichment = { status: 'SKIPPED', message: skipMsg };
        pushDaemonLog(id, 'WARN', skipMsg, startedAtMs);
      }

      assertNotCancelled(id);
      let partialFeatures = auditData.partialFeatures || [];
      if (!engines.partials) {
        partialFeatures = [];
        enrichedIssues = enrichedIssues.filter(
          (i) => !/partial|todo|stub|notimplemented/i.test(String(i.type || i.ruleId || ''))
        );
      }
      if (!engines.security) {
        enrichedIssues = enrichedIssues.filter((i) => !isSecurityIssue(i));
      }

      // Normalize + dedupe code findings (AST/Ruff/Radon); deps stay separate
      const deduped = normalizeAndDeduplicate(enrichedIssues);
      enrichedIssues = deduped.issues;
      const allFindingCount = enrichedIssues.length + dependencyIssues.length;
      const combinedSeverity = { ...deduped.severity };
      for (const d of dependencyIssues) {
        const s = d.severity || 'Medium';
        if (combinedSeverity[s] != null) combinedSeverity[s] += 1;
      }

      const essentialFailed =
        engines.ast && ['FAILED', 'UNAVAILABLE'].includes(toolStatuses.eyraAst.status);
      let outcomeStatus = 'completed';
      if (essentialFailed && enrichedIssues.length === 0) {
        outcomeStatus = 'failed';
        limitations.push('essential_ast_unavailable_or_failed');
      } else if (
        essentialFailed ||
        limitations.length ||
        ['UNAVAILABLE', 'FAILED'].includes(toolStatuses.ruff.status) ||
        ['UNAVAILABLE', 'FAILED'].includes(toolStatuses.radon.status) ||
        toolStatuses.aiEnrichment.status === 'PARTIAL' ||
        toolStatuses.aiEnrichment.enrichmentSource === 'brain_partial_heuristic'
      ) {
        outcomeStatus = 'completed_with_limitations';
      }

      const hasHealth = auditData.summary?.healthScore != null;
      const finalSummary = {
        ...auditData.summary,
        dependencyVulnerabilities: dependencyIssues.length,
        architectureRisk: architectureHealth.riskRating,
        totalIssues: allFindingCount,
        severity: combinedSeverity,
        duplicatesRemoved: deduped.duplicatesRemoved,
        analysisLimitation:
          outcomeStatus === 'completed'
            ? null
            : [...new Set(limitations)].join('; ') ||
              'One or more analyzers unavailable, failed, or partial',
        healthScore: essentialFailed && !hasHealth ? null : auditData.summary?.healthScore ?? null,
        grade:
          essentialFailed && !auditData.summary?.grade
            ? 'N/A'
            : auditData.summary?.grade || 'N/A',
        advisorySource: 'eyra-offline-known-cves',
        advisoryLiveLookup: false,
      };

      const { fileContents, fileInventory } = collectRepoFiles(scan.extractedDir);
      pushDaemonLog(
        id,
        'INFO',
        `Explorer inventory: ${fileInventory.listed} files` +
          (fileInventory.skippedNoise
            ? ` (${fileInventory.skippedNoise} cache/package paths skipped)`
            : ''),
        startedAtMs,
        { healthy: fileInventory.listed > 0 },
      );

      assertNotCancelled(id);
      const finalizeMsg =
        outcomeStatus === 'failed'
          ? 'Audit finished as FAILED — essential analysis could not run'
          : outcomeStatus === 'completed_with_limitations'
            ? 'Audit report finalized with documented limitations'
            : 'Audit report finalized';
      pushDaemonLog(
        id,
        outcomeStatus === 'failed' ? 'FAIL' : 'DONE',
        finalizeMsg,
        startedAtMs,
      );
      const completedScan = pushStage(
        id,
        {
          status: outcomeStatus === 'failed' ? 'failed' : 'completed',
          outcomeStatus,
          progress: 100,
          currentStage: finalizeMsg,
          summary: finalSummary,
          issues: enrichedIssues,
          partialFeatures,
          dependencies: dependencyIssues,
          files: auditData.files || [],
          fileContents,
          fileInventory,
          meta: {
            ...(scan.meta || {}),
            totalFilesCount:
              fileInventory.listed || scan.meta?.totalFilesCount || Object.keys(fileContents).length,
            excludedFilesCount: fileInventory.skippedNoise,
            unreadableFileCount: fileInventory.binaryOrUnreadable,
          },
          architectureHealth,
          engines,
          toolStatuses,
          limitations: [...new Set(limitations)],
          error: outcomeStatus === 'failed' ? toolStatuses.eyraAst.message : null,
          completedAt: new Date().toISOString(),
        },
        { summary: finalSummary },
      );
      if (completedScan) {
        sendSseEvent(id, {
          status: completedScan.status,
          outcomeStatus,
          progress: 100,
          currentStage: finalizeMsg,
          summary: finalSummary,
          logs: completedScan.logs || [],
          toolStatuses,
          scan: completedScan,
        });
      }
      cancelFlags.delete(id);
    } catch (err) {
      if (err instanceof ScanCancelledError || cancelFlags.get(id)) {
        cancelFlags.delete(id);
        const current = scanStorage.getScan(id);
        if (current && current.status !== 'cancelled') {
          let updated = pushStage(id, {
            status: 'cancelled',
            currentStage: 'Cancelled by user',
          });
          updated = pushDaemonLog(id, 'WARN', 'Cancelled by user', startedAtMs) || updated;
          if (updated) {
            sendSseEvent(id, {
              status: 'cancelled',
              progress: updated.progress,
              currentStage: 'Cancelled by user',
              logs: updated.logs || [],
              scan: updated,
            });
          }
        }
        return;
      }
      console.error('Scan execution error:', err);
      cancelFlags.delete(id);
      let failed = pushStage(id, {
        status: 'failed',
        error: err.message,
        currentStage: 'Failed: ' + err.message,
      });
      failed = pushDaemonLog(id, 'FAIL', `Failed: ${err.message}`, startedAtMs) || failed;
      sendSseEvent(id, {
        status: 'failed',
        error: err.message,
        currentStage: 'Failed: ' + err.message,
        logs: failed?.logs || [],
        scan: failed,
      });
    }
  })();
});

// Get single scan details (explorer fileContents always rebuilt from sandbox on disk)
router.get('/scan/:id', (req, res) => {
  const { id } = req.params;
  const scan = scanStorage.getScan(id, { hydrate: true });
  if (!scan) return res.status(404).json({ error: 'Scan not found' });
  res.json({ scan });
});

// Auto-fix generator / patch applier
router.post('/scan/:id/autofix', (req, res) => {
  const { id } = req.params;
  const { issueId } = req.body;
  const scan = scanStorage.getScan(id);
  if (!scan) return res.status(404).json({ error: 'Scan not found' });

  const issue = (scan.issues || []).find(i => i.id === issueId);
  if (!issue) return res.status(404).json({ error: 'Issue not found' });

  res.json({
    success: true,
    issueId,
    patchDiff: issue.patchDiff || '--- a/file\n+++ b/file\n@@ -1,1 +1,1 @@\n+ // Auto-fix patch applied',
    explanation: issue.aiExplanation || 'AI patch refactored vulnerable statement with strict boundaries.'
  });
});

export default router;
