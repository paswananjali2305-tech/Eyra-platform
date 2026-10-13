/**
 * Normalize + deduplicate findings from AST / Ruff / Radon / deps / AI.
 */

function normPath(p) {
  return String(p || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .toLowerCase();
}

function severityRank(s) {
  return { Critical: 4, High: 3, Medium: 2, Low: 1 }[s] || 0;
}

function maxSeverity(a, b) {
  return severityRank(a) >= severityRank(b) ? a : b;
}

/** Rough category family for cross-tool overlap (complexity, security, etc.). */
function categoryFamily(iss) {
  const blob = `${iss.ruleId || ''} ${iss.type || ''} ${iss.category || ''} ${iss.title || ''}`.toLowerCase();
  if (/secret|aws|token|password|credential/.test(blob)) return 'secret';
  if (/sqli|injection|xss|shell|exec|eval/.test(blob)) return 'injection';
  if (/complex|nesting|radon-cc|cognitive|maintainability|radon-mi/.test(blob)) return 'complexity';
  if (/partial|todo|stub|notimplemented/.test(blob)) return 'partial';
  if (/test.?gap|coverage/.test(blob)) return 'test-gap';
  if (/dep-|cve-|vulnerab/.test(blob)) return 'dependency';
  if (/ruff|lint|code smell/.test(blob)) return 'lint';
  return iss.ruleId || iss.type || 'other';
}

function dedupeKey(iss) {
  const file = normPath(iss.file || iss.path);
  const line = iss.line ?? iss.lineNumber ?? 0;
  const family = categoryFamily(iss);
  // Same file+line+family → likely same underlying issue across tools
  return `${file}|${line}|${family}`;
}

/**
 * @param {object[]} issues
 * @returns {{ issues: object[], severity: object, totalIssues: number, duplicatesRemoved: number }}
 */
export function normalizeAndDeduplicate(issues) {
  const list = Array.isArray(issues) ? issues : [];
  const normalized = list.map((iss, idx) => {
    const file = String(iss.file || iss.path || '').replace(/\\/g, '/');
    return {
      ...iss,
      id: iss.id || `FINDING-${idx}`,
      ruleId: iss.ruleId || iss.rule || 'UNKNOWN',
      sourceTool: iss.sourceTool || iss.engine || iss.source || 'eyra-ast',
      severity: iss.severity || 'Medium',
      file,
      path: file,
      line: iss.line ?? iss.lineNumber ?? 1,
      column: iss.column ?? 1,
      message: iss.description || iss.message || iss.title || '',
      title: iss.title || iss.message || iss.ruleId || 'Finding',
      category: iss.category || iss.type || 'General',
      type: iss.type || iss.category || 'General',
      confidence: iss.confidence ?? 0.8,
      contributingTools: iss.contributingTools || [iss.sourceTool || 'eyra-ast'],
    };
  });

  const byKey = new Map();
  let duplicatesRemoved = 0;

  for (const iss of normalized) {
    const key = dedupeKey(iss);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...iss, contributingTools: [...(iss.contributingTools || [])] });
      continue;
    }
    // Same exact rule+tool → true duplicate
    const sameRule =
      String(existing.ruleId) === String(iss.ruleId) &&
      String(existing.sourceTool) === String(iss.sourceTool);
    if (sameRule) {
      duplicatesRemoved += 1;
      continue;
    }
    // Overlap across tools — merge, keep strongest severity + both tools
    duplicatesRemoved += 1;
    existing.severity = maxSeverity(existing.severity, iss.severity);
    const tools = new Set([...(existing.contributingTools || []), ...(iss.contributingTools || []), iss.sourceTool]);
    existing.contributingTools = [...tools];
    existing.evidence = {
      ...(existing.evidence || {}),
      alsoReportedBy: [...tools].filter((t) => t !== existing.sourceTool),
      mergedFrom: [...(existing.evidence?.mergedFrom || []), iss.id],
    };
    if ((iss.confidence || 0) > (existing.confidence || 0)) {
      existing.confidence = iss.confidence;
    }
    // Prefer longer description
    if ((iss.description || '').length > (existing.description || '').length) {
      existing.description = iss.description;
      existing.message = iss.description;
    }
  }

  const issuesOut = [...byKey.values()];
  const severity = { Critical: 0, High: 0, Medium: 0, Low: 0 };
  for (const i of issuesOut) {
    if (severity[i.severity] != null) severity[i.severity] += 1;
  }

  return {
    issues: issuesOut,
    severity,
    totalIssues: issuesOut.length,
    duplicatesRemoved,
  };
}

export function recountSummary(summary, issues, extras = {}) {
  const base = summary && typeof summary === 'object' ? { ...summary } : {};
  const { severity, totalIssues } = normalizeAndDeduplicate(issues);
  // Use already-deduped issues for counts if passed post-dedupe
  const sev = { Critical: 0, High: 0, Medium: 0, Low: 0 };
  for (const i of issues) {
    if (sev[i.severity] != null) sev[i.severity] += 1;
  }
  return {
    ...base,
    totalIssues: issues.length,
    severity: sev,
    ...extras,
  };
}
