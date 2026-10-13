/**
 * Derive Codebase Intelligence overview metrics from a live ZIP/GitHub scan.
 */

function sevBucket(sev) {
  const s = String(sev || '').toLowerCase();
  if (s.startsWith('crit')) return 'critical';
  if (s.startsWith('high')) return 'high';
  if (s.startsWith('med')) return 'medium';
  return 'low';
}

/**
 * @param {object|null|undefined} scan
 */
export function countSeverities(scan) {
  const fromSummary = scan?.summary?.severity;
  if (fromSummary && typeof fromSummary === 'object') {
    return {
      critical: Number(fromSummary.Critical || fromSummary.critical || 0),
      high: Number(fromSummary.High || fromSummary.high || 0),
      medium: Number(fromSummary.Medium || fromSummary.medium || 0),
      low: Number(fromSummary.Low || fromSummary.low || 0),
    };
  }
  const out = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const iss of Array.isArray(scan?.issues) ? scan.issues : []) {
    out[sevBucket(iss.severity)] += 1;
  }
  return out;
}

/** Matches AuditCodeWorkspace persistence so Apply fix updates this donut. */
const RESOLVED_STORAGE_PREFIX = 'eyra.auditResolvedFindings';

export function loadAppliedFixKeys(scanId) {
  try {
    const raw = sessionStorage.getItem(
      `${RESOLVED_STORAGE_PREFIX}:${String(scanId || 'demo')}`,
    );
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function issueKey(iss) {
  const path = (iss?.file || iss?.path || '').replace(/\\/g, '/');
  return `${path}:${iss?.line ?? ''}:${iss?.id || iss?.ruleId || iss?.title || ''}`;
}

/** True when the scan provides a real code change — not a stub / comment-only patch. */
function hasRealPatch(iss) {
  const patch = String(iss?.patchDiff || iss?.patch || '');
  if (patch.trim()) {
    if (
      /auto-?fix patch applied|verify boundary constraints|EYRA_AUTO_FIX|^\s*[+#/]*\s*FIX:/im.test(
        patch,
      )
    ) {
      return false;
    }
    if (/\.\.\.\s*\(\d+\s*lines/i.test(patch)) return false;
    const added = patch
      .split('\n')
      .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
      .map((l) => l.slice(1).trim())
      .filter(Boolean);
    if (added.some((l) => !/^(\/\/|#)/.test(l))) return true;
    if (
      !/^(\+\+\+|---|@@)/m.test(patch) &&
      patch.trim().length > 12 &&
      !/^(\/\/|#)/.test(patch.trim())
    ) {
      return true;
    }
  }
  const suggestion = String(iss?.suggestion || '').trim();
  return suggestion.length > 24 && /```/.test(suggestion);
}

/**
 * Mutually exclusive remediation stage for one finding.
 * @returns {'open'|'inReview'|'approved'|'verified'}
 */
function issueStage(iss, appliedKeys) {
  const key = issueKey(iss);
  const explicit = String(
    iss?.remediationStatus || iss?.fixStatus || iss?.verification || '',
  ).toLowerCase();

  if (
    explicit === 'verified' ||
    explicit === 'resolved' ||
    Boolean(iss?.verified) ||
    appliedKeys.has(key)
  ) {
    return 'verified';
  }
  if (explicit === 'approved' || explicit === 'accepted' || Boolean(iss?.approved)) {
    return 'approved';
  }
  if (explicit === 'in_review' || explicit === 'review' || hasRealPatch(iss)) {
    return 'inReview';
  }
  return 'open';
}

/**
 * Per-file risk density rows for Audited File Summary (live scan only).
 * @param {object|null|undefined} scan
 * @param {number} [limit]
 */
export function auditedFileRiskRows(scan, limit = 4) {
  const issues = Array.isArray(scan?.issues) ? scan.issues : [];
  const fileMeta = new Map();
  for (const f of Array.isArray(scan?.files) ? scan.files : []) {
    const path = String(f.path || f.file || f.name || '').replace(/\\/g, '/');
    if (!path) continue;
    fileMeta.set(path, {
      loc: Number(f.loc ?? f.lines ?? f.lineCount ?? f.totalLoc ?? 0) || 0,
    });
  }

  const byPath = new Map();
  for (const iss of issues) {
    const path = String(iss.file || iss.path || '').replace(/\\/g, '/');
    if (!path) continue;
    const prev = byPath.get(path) || {
      path,
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      loc: fileMeta.get(path)?.loc || 0,
    };
    prev[sevBucket(iss.severity)] += 1;
    byPath.set(path, prev);
  }

  // Include files with meta but no issues so empty audits still list modules
  for (const [path, meta] of fileMeta) {
    if (!byPath.has(path)) {
      byPath.set(path, {
        path,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        loc: meta.loc || 0,
      });
    }
  }

  const rows = [...byPath.values()].map((r) => {
    const score = Math.max(
      0,
      Math.min(100, Math.round(r.critical * 28 + r.high * 18 + r.medium * 8 + r.low * 3)),
    );
    let band = 'LOW';
    if (score >= 85 || r.critical > 0) band = 'CRITICAL';
    else if (score >= 65 || r.high > 0) band = 'HIGH';
    else if (score >= 40 || r.medium > 0) band = 'MEDIUM';
    return { ...r, score, band };
  });

  rows.sort(
    (a, b) =>
      b.score - a.score ||
      b.critical - a.critical ||
      b.high - a.high ||
      a.path.localeCompare(b.path),
  );

  return {
    totalFiles: Number(scan?.meta?.totalFilesCount ?? scan?.summary?.totalFiles ?? rows.length) || rows.length,
    rows: rows.slice(0, limit),
  };
}

/**
 * Top critical/high findings for the priority panel.
 * @param {object|null|undefined} scan
 * @param {number} [limit]
 */
export function topPriorityFindings(scan, limit = 2) {
  const issues = Array.isArray(scan?.issues) ? [...scan.issues] : [];
  const rank = (iss) => {
    const b = sevBucket(iss.severity);
    if (b === 'critical') return 0;
    if (b === 'high') return 1;
    if (b === 'medium') return 2;
    return 3;
  };
  issues.sort((a, b) => rank(a) - rank(b) || (a.line || 0) - (b.line || 0));
  return issues.slice(0, limit).map((iss) => {
    const path = String(iss.file || '').replace(/\\/g, '/');
    const line = iss.line != null ? `:${iss.line}` : '';
    return {
      id: iss.id || `${path}${line}:${iss.ruleId || iss.title}`,
      title: iss.title || iss.ruleId || 'Finding',
      loc: path ? `${path}${line}` : '—',
      severity: String(iss.severity || 'Medium'),
      badge: iss.ruleId || iss.type || iss.cwe || 'FINDING',
      cwe: iss.cwe || iss.ruleId || '',
      summary: iss.aiExplanation || iss.description || iss.suggestion || '',
    };
  });
}

/** Format scan wall-clock duration for KPI display. */
export function formatScanDuration(scan) {
  if (!scan) return { value: '—', detail: 'No scan' };
  const explicitMs = Number(
    scan.durationMs ?? scan.duration_ms ?? scan.summary?.durationMs ?? scan.meta?.durationMs,
  );
  let ms = Number.isFinite(explicitMs) && explicitMs > 0 ? explicitMs : null;
  if (ms == null) {
    const start = new Date(scan.startedAt || scan.createdAt || 0).getTime();
    const end = new Date(scan.completedAt || scan.updatedAt || Date.now()).getTime();
    if (Number.isFinite(start) && start > 0 && Number.isFinite(end) && end >= start) {
      ms = end - start;
    }
  }
  if (ms == null) {
    return {
      value: '—',
      detail: String(scan.status || 'idle'),
    };
  }
  const sec = ms / 1000;
  if (sec < 60) {
    return {
      value: `${sec < 10 ? sec.toFixed(1) : Math.round(sec)}s`,
      detail: scan.status === 'completed' ? 'Wall clock' : String(scan.status || 'running'),
    };
  }
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return {
    value: `${m}m ${s}s`,
    detail: scan.status === 'completed' ? 'Wall clock' : String(scan.status || 'running'),
  };
}

/**
 * KPI strip values for the overview hero metrics.
 * @param {object|null|undefined} scan
 */
export function overviewKpis(scan) {
  const sev = countSeverities(scan);
  const issues = Array.isArray(scan?.issues) ? scan.issues : [];
  const totalIssues =
    scan?.summary?.totalIssues != null ? Number(scan.summary.totalIssues) : issues.length;
  const files = Number(
    scan?.meta?.totalFilesCount ?? scan?.summary?.totalFiles ?? 0,
  );
  const loc = Number(scan?.summary?.totalLoc ?? scan?.meta?.totalLoc ?? 0);
  const filesWithIssues = new Set(
    issues
      .map((iss) => String(iss.file || iss.path || '').replace(/\\/g, '/').trim())
      .filter(Boolean),
  ).size;
  const duration = formatScanDuration(scan);
  const critHigh = sev.critical + sev.high;
  const health =
    scan?.summary?.healthScore != null
      ? Number(scan.summary.healthScore)
      : totalIssues === 0
        ? 100
        : Math.max(0, Math.min(100, Math.round(100 - critHigh * 4 - sev.medium * 1.5 - sev.low * 0.5)));

  return {
    health,
    totalIssues,
    critHigh,
    sev,
    files,
    loc,
    filesWithIssues,
    scanDuration: duration.value,
    scanDurationDetail: duration.detail,
    projectName: scan?.projectName || scan?.archiveName || 'codebase',
    status: scan?.status || 'idle',
    grade: scan?.summary?.grade || null,
  };
}

/**
 * Remediation funnel for the donut (replaces Groq AST panel).
 * Wired to scan.issues (+ optional summary counters) and Code Audit Apply keys.
 * @param {object|null|undefined} scan
 */
export function remediationProgress(scan) {
  const issues = Array.isArray(scan?.issues) ? scan.issues : [];
  const summary = scan?.summary || {};
  const appliedKeys = loadAppliedFixKeys(scan?.id);

  let open = 0;
  let inReview = 0;
  let approved = 0;
  let verified = 0;

  for (const iss of issues) {
    const stage = issueStage(iss, appliedKeys);
    if (stage === 'verified') verified += 1;
    else if (stage === 'approved') approved += 1;
    else if (stage === 'inReview') inReview += 1;
    else open += 1;
  }

  // Backend summary overrides when the audit engine reports explicit funnel counts
  if (summary.verifiedFixes != null) verified = Number(summary.verifiedFixes);
  if (summary.approvedFixes != null) approved = Number(summary.approvedFixes);
  if (summary.inReviewFixes != null) inReview = Number(summary.inReviewFixes);
  if (summary.openFindings != null) open = Number(summary.openFindings);

  const totalFindings =
    summary.totalIssues != null ? Number(summary.totalIssues) : issues.length;
  const total = open + inReview + approved + verified;
  // Keep funnel consistent with totalFindings when summary overrides drift
  if (totalFindings > 0 && total === 0) {
    open = totalFindings;
  }
  const resolvedUnits = approved + verified;
  const denom = Math.max(1, totalFindings || total);
  const resolvedPct = Math.round((resolvedUnits / denom) * 100);

  return {
    open,
    inReview,
    approved,
    verified,
    total: open + inReview + approved + verified,
    totalFindings: totalFindings || open + inReview + approved + verified,
    resolvedPct: Math.max(0, Math.min(100, resolvedPct)),
    appliedFromWorkspace: appliedKeys.size,
    segments: [
      { key: 'Open Findings', value: open, color: '#ff6b7a', hint: 'No real patch yet' },
      { key: 'In Review', value: inReview, color: '#f0a05a', hint: 'Patch proposed — not applied' },
      { key: 'Approved', value: approved, color: '#35d6f2', hint: 'Accepted for apply' },
      { key: 'Verified', value: verified, color: '#3dd68c', hint: 'Applied / re-checked clear' },
    ],
  };
}

/**
 * @param {object[]} scans
 * @param {number} [limit]
 */
export function recentAuditRows(scans, limit = 3) {
  const list = Array.isArray(scans) ? [...scans] : [];
  list.sort((a, b) => {
    const ta = new Date(a.completedAt || a.createdAt || 0).getTime();
    const tb = new Date(b.completedAt || b.createdAt || 0).getTime();
    return tb - ta;
  });
  return list.slice(0, limit).map((s) => {
    const issues =
      s.summary?.totalIssues != null
        ? Number(s.summary.totalIssues)
        : Array.isArray(s.issues)
          ? s.issues.length
          : 0;
    const sev = countSeverities(s);
    const score =
      s.summary?.healthScore != null
        ? Number(s.summary.healthScore)
        : Math.max(0, 100 - (sev.critical + sev.high) * 4);
    return {
      id: s.id,
      label: s.projectName || s.archiveName || shortId(s.id),
      ref: s.commit || s.branch || s.sourceType || s.status || 'scan',
      when: s.completedAt || s.createdAt,
      findings: issues,
      score,
      status: s.status,
    };
  });
}

function shortId(id) {
  const s = String(id || '');
  return s.length > 10 ? `#${s.slice(0, 8)}` : s || 'scan';
}
