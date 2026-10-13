/**
 * Full debugging audit report builder — JSON + Excel-friendly CSV.
 * Includes findings, packages/CVEs, partials, and open/solved status.
 */

import { loadAppliedFixKeys } from './overviewMetrics.js';

function issueKey(iss) {
  const path = (iss?.file || iss?.path || '').replace(/\\/g, '/');
  return `${path}:${iss?.line ?? ''}:${iss?.id || iss?.ruleId || iss?.title || ''}`;
}

function findingOrigin(iss) {
  const blob = `${iss?.source || ''} ${iss?.engine || ''} ${iss?.type || ''} ${iss?.ruleId || ''} ${iss?.origin || ''}`;
  if (/ai|groq|llm|gpt|semantic|assist/i.test(blob)) return 'AI';
  if (/live|rule|static|bandit|semgrep|cve|dep|security|syntax|metric/i.test(blob)) return 'Rule';
  if (iss?.ruleId) return 'Rule';
  return 'Review';
}

function csvEscape(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvRow(cells) {
  return cells.map(csvEscape).join(',');
}

/**
 * Build a structured debugging report for one scan.
 * @param {object} scan
 * @param {Set<string>|string[]} [resolvedKeys]
 */
export function buildAuditReport(scan, resolvedKeys) {
  const resolved =
    resolvedKeys instanceof Set
      ? resolvedKeys
      : new Set(Array.isArray(resolvedKeys) ? resolvedKeys : []);
  const fromStorage = scan?.id ? loadAppliedFixKeys(scan.id) : new Set();
  for (const k of fromStorage) resolved.add(k);

  const summary = scan?.summary || {};
  const severity = summary.severity || {};
  const issues = Array.isArray(scan?.issues) ? scan.issues : [];
  const deps = Array.isArray(scan?.dependencies) ? scan.dependencies : [];
  const partials = Array.isArray(scan?.partialFeatures) ? scan.partialFeatures : [];

  const findings = issues.map((iss, idx) => {
    const key = issueKey(iss);
    const solved = resolved.has(key);
    return {
      index: idx + 1,
      key,
      id: iss.id || iss.ruleId || `finding-${idx + 1}`,
      ruleId: iss.ruleId || '',
      type: iss.type || '',
      severity: iss.severity || 'Unknown',
      title: iss.title || iss.message || '',
      description: iss.description || '',
      suggestion: iss.suggestion || '',
      file: (iss.file || iss.path || '').replace(/\\/g, '/'),
      line: iss.line ?? iss.lineNumber ?? '',
      confidence:
        iss.confidence != null ? Math.round(Number(iss.confidence) * 100) / 100 : null,
      origin: findingOrigin(iss),
      status: solved ? 'solved' : 'open',
      hasPatch: Boolean(iss.patchDiff || iss.patch),
      aiExplanation: iss.aiExplanation || '',
      snippet: iss.snippet || '',
    };
  });

  const dependencies = deps.map((d, idx) => ({
    index: idx + 1,
    package: d.package || '',
    installedVersion: d.installedVersion || d.currentCleanVersion || '',
    ecosystem: d.ecosystem || '',
    cve: d.cve || '',
    cvss: d.cvss ?? '',
    severity: d.severity || '',
    title: d.title || '',
    patchedVersion: d.patchedVersion || '',
    advisoryUrl: d.advisoryUrl || '',
    status: 'open',
  }));

  const incomplete = partials.map((p, idx) => ({
    index: idx + 1,
    file: (p.file || '').replace(/\\/g, '/'),
    line: p.line ?? '',
    type: p.type || '',
    risk: p.risk || '',
    estimatedEffortHours: p.estimatedEffortHours ?? '',
    description: p.featureDescription || p.description || '',
    status: 'open',
  }));

  const solvedCount = findings.filter((f) => f.status === 'solved').length;
  const openCount = findings.length - solvedCount;

  return {
    reportType: 'eyra-codebase-audit',
    generatedAt: new Date().toISOString(),
    meta: {
      scanId: scan?.id || '',
      projectName: scan?.projectName || '',
      status: scan?.status || '',
      sourceType: scan?.sourceType || scan?.meta?.sourceType || '',
      repoUrl: scan?.meta?.repoUrl || '',
      primaryLanguage: scan?.meta?.primaryLanguage || '',
      languages: scan?.meta?.languages || [],
      createdAt: scan?.createdAt || null,
      completedAt: scan?.completedAt || null,
      engines: scan?.engines || null,
    },
    summary: {
      healthScore: summary.healthScore ?? null,
      grade: summary.grade || '',
      totalFiles: summary.totalFiles ?? scan?.meta?.totalFilesCount ?? 0,
      totalLoc: summary.totalLoc ?? 0,
      totalIssues: summary.totalIssues ?? findings.length,
      severity: {
        Critical: severity.Critical ?? 0,
        High: severity.High ?? 0,
        Medium: severity.Medium ?? 0,
        Low: severity.Low ?? 0,
      },
      dependencyVulnerabilities: summary.dependencyVulnerabilities ?? deps.length,
      partialFeatures: partials.length,
      remediation: {
        solved: solvedCount,
        open: openCount,
        total: findings.length,
      },
    },
    findings,
    dependencies,
    incompleteFeatures: incomplete,
    logs: Array.isArray(scan?.logs) ? scan.logs : [],
  };
}

/** Excel-friendly CSV (UTF-8 BOM) with sectioned tables. */
export function reportToCsv(report) {
  const lines = [];
  lines.push('EYRA Codebase Audit Report');
  lines.push(csvRow(['Generated At', report.generatedAt]));
  lines.push('');

  lines.push('META');
  lines.push(
    csvRow([
      'Scan ID',
      'Project',
      'Status',
      'Source',
      'Repo URL',
      'Primary Language',
      'Created At',
      'Completed At',
    ]),
  );
  lines.push(
    csvRow([
      report.meta.scanId,
      report.meta.projectName,
      report.meta.status,
      report.meta.sourceType,
      report.meta.repoUrl,
      report.meta.primaryLanguage,
      report.meta.createdAt,
      report.meta.completedAt,
    ]),
  );
  lines.push('');

  lines.push('SUMMARY');
  lines.push(
    csvRow([
      'Health Score',
      'Grade',
      'Files',
      'LOC',
      'Total Issues',
      'Critical',
      'High',
      'Medium',
      'Low',
      'CVE Packages',
      'Partials',
      'Solved',
      'Open',
    ]),
  );
  const s = report.summary;
  lines.push(
    csvRow([
      s.healthScore,
      s.grade,
      s.totalFiles,
      s.totalLoc,
      s.totalIssues,
      s.severity.Critical,
      s.severity.High,
      s.severity.Medium,
      s.severity.Low,
      s.dependencyVulnerabilities,
      s.partialFeatures,
      s.remediation.solved,
      s.remediation.open,
    ]),
  );
  lines.push('');

  lines.push('FINDINGS');
  lines.push(
    csvRow([
      'Status',
      'Severity',
      'Origin',
      'Rule ID',
      'Type',
      'File',
      'Line',
      'Title',
      'Description',
      'Suggestion',
      'Confidence',
      'Has Patch',
      'Finding Key',
    ]),
  );
  for (const f of report.findings) {
    lines.push(
      csvRow([
        f.status,
        f.severity,
        f.origin,
        f.ruleId,
        f.type,
        f.file,
        f.line,
        f.title,
        f.description,
        f.suggestion,
        f.confidence,
        f.hasPatch ? 'yes' : 'no',
        f.key,
      ]),
    );
  }
  lines.push('');

  lines.push('DEPENDENCIES');
  lines.push(
    csvRow([
      'Status',
      'Package',
      'Installed Version',
      'Ecosystem',
      'CVE',
      'CVSS',
      'Severity',
      'Title',
      'Patched Version',
      'Advisory URL',
    ]),
  );
  for (const d of report.dependencies) {
    lines.push(
      csvRow([
        d.status,
        d.package,
        d.installedVersion,
        d.ecosystem,
        d.cve,
        d.cvss,
        d.severity,
        d.title,
        d.patchedVersion,
        d.advisoryUrl,
      ]),
    );
  }
  lines.push('');

  lines.push('INCOMPLETE_FEATURES');
  lines.push(
    csvRow(['Status', 'File', 'Line', 'Type', 'Risk', 'Effort Hours', 'Description']),
  );
  for (const p of report.incompleteFeatures) {
    lines.push(
      csvRow([
        p.status,
        p.file,
        p.line,
        p.type,
        p.risk,
        p.estimatedEffortHours,
        p.description,
      ]),
    );
  }

  // UTF-8 BOM so Excel recognizes encoding
  return `\uFEFF${lines.join('\r\n')}`;
}

export function reportToJson(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function downloadTextFile(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Build + download one scan report.
 * @param {object} scan
 * @param {'csv'|'json'} format
 */
export function downloadScanReport(scan, format) {
  const report = buildAuditReport(scan);
  const idShort = String(scan?.id || 'scan').slice(0, 8);
  const project = String(scan?.projectName || 'audit')
    .replace(/[^\w.-]+/g, '_')
    .slice(0, 40);
  if (format === 'csv') {
    downloadTextFile(
      `eyra-audit-report-${project}-${idShort}.csv`,
      reportToCsv(report),
      'text/csv;charset=utf-8',
    );
    return report;
  }
  downloadTextFile(
    `eyra-audit-report-${project}-${idShort}.json`,
    reportToJson(report),
    'application/json;charset=utf-8',
  );
  return report;
}

/**
 * Normalize a Brain session (list row or detail) for history export.
 * @param {object} session
 */
export function buildRuntimeSessionReport(session) {
  if (!session) return null;
  const verification =
    session.verification && typeof session.verification === 'object'
      ? session.verification
      : {
          status: session.verification_status || session.verification || 'not_run',
        };
  const correction =
    session.suggested_correction && typeof session.suggested_correction === 'object'
      ? session.suggested_correction
      : null;
  return {
    sessionId: session.session_id || session.sessionId || session.id || '',
    projectName: session.project_name || session.project || 'default',
    fileName: session.file_name || session.fileName || '',
    language: session.language || '',
    status: session.status || '',
    errorType: session.error_type || session.errorType || '',
    errorSummary: session.error_summary || session.errorSummary || '',
    rootCause: session.root_cause || session.rootCause || '',
    explanation: session.explanation || '',
    verificationStatus: verification.status || 'not_run',
    verificationDetail: verification.detail || verification.message || '',
    reasoningSource: session.reasoning_source || session.reasoningSource || '',
    reasoningNote: session.reasoning_note || session.reasoningNote || '',
    confidence:
      session.confidence != null && !Number.isNaN(Number(session.confidence))
        ? Number(session.confidence)
        : null,
    createdAt: session.created_at || session.createdAt || session.when || '',
    stackTrace: session.stack_trace || session.stackTrace || '',
    terminalOutput: session.terminal_output || session.terminalOutput || '',
    suggestedFix: correction?.fixed_code || correction?.code || correction?.summary || '',
    evidence: Array.isArray(session.evidence) ? session.evidence : [],
  };
}

/**
 * History export: index + full reports for completed scans and/or runtime sessions.
 * @param {{ historyItems: object[], scans?: object[], sessions?: object[], format: 'csv'|'json' }} opts
 */
export function downloadHistoryExport({ historyItems, scans, sessions, format }) {
  const reports = (scans || [])
    .filter((s) => s && (s.status === 'completed' || Array.isArray(s.issues)))
    .map((s) => buildAuditReport(s));

  const sessionReports = (sessions || [])
    .map((s) => buildRuntimeSessionReport(s))
    .filter(Boolean);

  const bundle = {
    reportType: 'eyra-investigation-history',
    generatedAt: new Date().toISOString(),
    historyCount: (historyItems || []).length,
    reportCount: reports.length,
    sessionCount: sessionReports.length,
    history: historyItems || [],
    reports,
    sessions: sessionReports,
  };

  if (format === 'json') {
    downloadTextFile(
      `eyra-history-report-${Date.now()}.json`,
      reportToJson(bundle),
      'application/json;charset=utf-8',
    );
    return bundle;
  }

  // CSV: history index + runtime sessions + each scan's findings/deps stacked
  const lines = [];
  lines.push('EYRA Investigation History Export');
  lines.push(csvRow(['Generated At', bundle.generatedAt]));
  lines.push(csvRow(['History Rows', bundle.historyCount]));
  lines.push(csvRow(['Runtime Sessions', bundle.sessionCount]));
  lines.push(csvRow(['Audit Reports', bundle.reportCount]));
  lines.push('');

  lines.push('HISTORY_INDEX');
  lines.push(
    csvRow([
      'Type',
      'ID',
      'Project',
      'Scope',
      'Language',
      'Status',
      'Severity',
      'Verification',
      'Confidence',
      'Title',
      'Subtitle',
      'Created At',
    ]),
  );
  for (const item of historyItems || []) {
    lines.push(
      csvRow([
        item.kind || item.type || '',
        item.id || item.sessionId || item.scanId || '',
        item.project || item.projectName || '',
        item.scope || '',
        item.language || '',
        item.status || '',
        item.severity || '',
        item.verification || '',
        item.latency || '',
        item.title || item.summary || '',
        item.subtitle || '',
        item.when || item.createdAt || item.time || '',
      ]),
    );
  }
  lines.push('');

  if (sessionReports.length) {
    lines.push('RUNTIME_SESSIONS');
    lines.push(
      csvRow([
        'Session_ID',
        'Project',
        'File',
        'Language',
        'Status',
        'Error_Type',
        'Error_Summary',
        'Root_Cause',
        'Verification',
        'Confidence',
        'Reasoning_Source',
        'Suggested_Fix',
        'Created_At',
      ]),
    );
    for (const s of sessionReports) {
      lines.push(
        csvRow([
          s.sessionId,
          s.projectName,
          s.fileName,
          s.language,
          s.status,
          s.errorType,
          s.errorSummary,
          s.rootCause,
          s.verificationStatus,
          s.confidence != null ? Math.round(s.confidence * 100) + '%' : '',
          s.reasoningSource,
          s.suggestedFix,
          s.createdAt,
        ]),
      );
    }
    lines.push('');
  }

  for (const report of reports) {
    lines.push(`REPORT_SCAN_${report.meta.scanId}`);
    lines.push(
      csvRow([
        'Project',
        report.meta.projectName,
        'Status',
        report.meta.status,
        'Health',
        report.summary.healthScore,
        'Solved',
        report.summary.remediation.solved,
        'Open',
        report.summary.remediation.open,
      ]),
    );
    lines.push(
      csvRow([
        'Section',
        'Status',
        'Severity',
        'Origin',
        'Package_or_Rule',
        'File',
        'Line',
        'Title',
        'Detail',
        'CVE_or_Key',
      ]),
    );
    for (const f of report.findings) {
      lines.push(
        csvRow([
          'finding',
          f.status,
          f.severity,
          f.origin,
          f.ruleId || f.id,
          f.file,
          f.line,
          f.title,
          f.description,
          f.key,
        ]),
      );
    }
    for (const d of report.dependencies) {
      lines.push(
        csvRow([
          'dependency',
          d.status,
          d.severity,
          d.ecosystem,
          d.package,
          '',
          '',
          d.title,
          `Installed ${d.installedVersion}; patch ${d.patchedVersion}`,
          d.cve,
        ]),
      );
    }
    for (const p of report.incompleteFeatures) {
      lines.push(
        csvRow([
          'partial',
          p.status,
          p.risk,
          p.type,
          '',
          p.file,
          p.line,
          p.description,
          `Effort ~${p.estimatedEffortHours}h`,
          '',
        ]),
      );
    }
    lines.push('');
  }

  downloadTextFile(
    `eyra-history-report-${Date.now()}.csv`,
    `\uFEFF${lines.join('\r\n')}`,
    'text/csv;charset=utf-8',
  );
  return bundle;
}
