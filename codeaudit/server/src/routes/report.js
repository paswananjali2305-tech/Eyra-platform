import express from 'express';
import { scanStorage } from '../services/storage.js';

const router = express.Router();

function issueKey(iss) {
  const path = String(iss?.file || iss?.path || '').replace(/\\/g, '/');
  return `${path}:${iss?.line ?? ''}:${iss?.id || iss?.ruleId || iss?.title || ''}`;
}

function findingOrigin(iss) {
  const blob = `${iss?.source || ''} ${iss?.engine || ''} ${iss?.type || ''} ${iss?.ruleId || ''} ${iss?.origin || ''}`;
  if (/ai|groq|llm|gpt|semantic|assist/i.test(blob)) return 'AI';
  if (/live|rule|static|bandit|semgrep|cve|dep|security|syntax|metric/i.test(blob)) return 'Rule';
  if (iss?.ruleId) return 'Rule';
  return 'Review';
}

function parseResolvedKeys(raw) {
  if (!raw) return new Set();
  if (Array.isArray(raw)) return new Set(raw.map(String));
  try {
    const parsed = JSON.parse(String(raw));
    if (Array.isArray(parsed)) return new Set(parsed.map(String));
  } catch {
    /* comma-separated */
  }
  return new Set(
    String(raw)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

function csvEscape(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvRow(cells) {
  return cells.map(csvEscape).join(',');
}

function buildStructuredReport(scan, resolvedKeys = new Set()) {
  const summary = scan.summary || {};
  const severity = summary.severity || {};
  const issues = Array.isArray(scan.issues) ? scan.issues : [];
  const deps = Array.isArray(scan.dependencies) ? scan.dependencies : [];
  const partials = Array.isArray(scan.partialFeatures) ? scan.partialFeatures : [];

  const findings = issues.map((iss, idx) => {
    const key = issueKey(iss);
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
      file: String(iss.file || iss.path || '').replace(/\\/g, '/'),
      line: iss.line ?? iss.lineNumber ?? '',
      confidence:
        iss.confidence != null ? Math.round(Number(iss.confidence) * 100) / 100 : null,
      origin: findingOrigin(iss),
      status: resolvedKeys.has(key) ? 'solved' : 'open',
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

  const incompleteFeatures = partials.map((p, idx) => ({
    index: idx + 1,
    file: String(p.file || '').replace(/\\/g, '/'),
    line: p.line ?? '',
    type: p.type || '',
    risk: p.risk || '',
    estimatedEffortHours: p.estimatedEffortHours ?? '',
    description: p.featureDescription || p.description || '',
    status: 'open',
  }));

  const solved = findings.filter((f) => f.status === 'solved').length;

  return {
    reportType: 'eyra-codebase-audit',
    generatedAt: new Date().toISOString(),
    meta: {
      scanId: scan.id,
      projectName: scan.projectName || '',
      status: scan.status || '',
      sourceType: scan.sourceType || scan.meta?.sourceType || '',
      repoUrl: scan.meta?.repoUrl || '',
      primaryLanguage: scan.meta?.primaryLanguage || '',
      languages: scan.meta?.languages || [],
      createdAt: scan.createdAt || null,
      completedAt: scan.completedAt || null,
      engines: scan.engines || null,
    },
    summary: {
      healthScore: summary.healthScore ?? null,
      grade: summary.grade || '',
      totalFiles: summary.totalFiles ?? scan.meta?.totalFilesCount ?? 0,
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
        solved,
        open: findings.length - solved,
        total: findings.length,
      },
    },
    findings,
    dependencies,
    incompleteFeatures,
    logs: Array.isArray(scan.logs) ? scan.logs : [],
  };
}

function reportToCsv(report) {
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
  return `\uFEFF${lines.join('\r\n')}`;
}

function buildMarkdown(scan) {
  const summary = scan.summary || {};
  const issues = scan.issues || [];
  const partials = scan.partialFeatures || [];
  const deps = scan.dependencies || [];

  let md = `# CodeAudit AI - Security & Codebase Audit Report

**Project Name:** ${scan.projectName}  
**Scan ID:** \`${scan.id}\`  
**Scan Timestamp:** ${scan.completedAt || scan.createdAt}  
**Primary Language:** ${scan.meta?.primaryLanguage || 'Unknown'}  
**Overall Health Score:** **${summary.healthScore || 0}/100** (Grade: **${summary.grade || 'N/A'}**)

---

## Executive Summary

| Metric | Value |
| :--- | :--- |
| **Total Lines of Code (LOC)** | ${summary.totalLoc || 0} |
| **Files Scanned** | ${summary.totalFiles || 0} |
| **Total Issues Identified** | ${summary.totalIssues || 0} |
| **Critical Vulnerabilities** | ${summary.severity?.Critical || 0} |
| **High Severity Issues** | ${summary.severity?.High || 0} |
| **Medium Severity Issues** | ${summary.severity?.Medium || 0} |
| **Low Severity Issues** | ${summary.severity?.Low || 0} |
| **Incomplete Features / Stubs** | ${partials.length} (~${summary.totalEffortHours || 0}h work) |
| **Vulnerable Dependencies (CVE)** | ${deps.length} |

---

## Critical & High Severity Findings

`;

  const topIssues = issues.filter((i) => ['Critical', 'High'].includes(i.severity));
  if (topIssues.length === 0) {
    md += `*No Critical or High severity issues detected.*\n\n`;
  } else {
    for (const issue of topIssues) {
      md += `### [${issue.severity}] ${issue.title}\n`;
      md += `- **File:** \`${issue.file}:${issue.line}\`\n`;
      md += `- **Rule:** \`${issue.ruleId}\` (${issue.type})\n`;
      md += `- **Confidence:** ${Math.round((issue.confidence || 0.9) * 100)}%\n\n`;
      md += `**Description:**  \n${issue.description}\n\n`;
      if (issue.suggestion) {
        md += `**Suggested Remediation:** ${issue.suggestion}\n\n`;
      }
      md += `---\n\n`;
    }
  }

  md += `## Incomplete & Partial Feature Tracker\n\n`;
  if (partials.length === 0) {
    md += `*No unresolved TODOs, stubs, or NotImplementedErrors found.*\n\n`;
  } else {
    md += `| File & Line | Type | Risk | Remaining Effort | Description |\n`;
    md += `| :--- | :--- | :--- | :--- | :--- |\n`;
    for (const p of partials) {
      md += `| \`${p.file}:${p.line}\` | ${p.type} | ${p.risk} | ~${p.estimatedEffortHours}h | ${String(p.featureDescription || '').replace(/\|/g, '-')} |\n`;
    }
    md += `\n`;
  }

  md += `## Third-Party Dependency Vulnerabilities\n\n`;
  if (deps.length === 0) {
    md += `*No vulnerable packages matching known CVEs detected.*\n\n`;
  } else {
    md += `| Package | Installed | CVE | CVSS | Patched Version | Advisory |\n`;
    md += `| :--- | :--- | :--- | :--- | :--- | :--- |\n`;
    for (const d of deps) {
      md += `| **${d.package}** | \`${d.installedVersion}\` | [${d.cve}](${d.advisoryUrl}) | **${d.cvss}** (${d.severity}) | \`${d.patchedVersion}\` | [View Advisory](${d.advisoryUrl}) |\n`;
    }
    md += `\n`;
  }

  md += `\n*Generated by CodeAudit AI*\n`;
  return md;
}

router.get('/scan/:id/report', (req, res) => {
  const { id } = req.params;
  const format = String(req.query.format || 'markdown').toLowerCase();
  const resolvedKeys = parseResolvedKeys(req.query.resolvedKeys);

  const scan = scanStorage.getScan(id);
  if (!scan) return res.status(404).json({ error: 'Scan not found' });

  const structured = buildStructuredReport(scan, resolvedKeys);
  const safeName = String(scan.projectName || 'audit')
    .replace(/[^\w.-]+/g, '_')
    .slice(0, 40);

  if (format === 'json') {
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="eyra-audit-report-${safeName}-${scan.id.slice(0, 8)}.json"`,
    );
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.send(JSON.stringify(structured, null, 2));
  }

  if (format === 'csv') {
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="eyra-audit-report-${safeName}-${scan.id.slice(0, 8)}.csv"`,
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    return res.send(reportToCsv(structured));
  }

  // markdown (default)
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="codeaudit-report-${scan.id}.md"`,
  );
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  return res.send(buildMarkdown(scan));
});

export default router;
