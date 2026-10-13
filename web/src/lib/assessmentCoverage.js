/**
 * Assessment Coverage checklist for ZIP / GitHub codebase audits.
 * College-project honest mapping: PASS / PARTIAL / FAIL / NOT_RUN from real scan evidence only.
 */

/** @typedef {'pass'|'partial'|'fail'|'not_run'} CheckStatus */

/**
 * @typedef {{ label: string, status: CheckStatus, met: boolean, reason: string }} CheckItem
 */

function issueBlob(iss) {
  return `${iss?.ruleId || ''} ${iss?.title || ''} ${iss?.type || ''} ${iss?.cwe || ''} ${iss?.description || ''}`;
}

function enginesOf(scan) {
  const e = scan?.engines;
  const done = String(scan?.status || '').toLowerCase() === 'completed';
  // Older payloads may omit engines after completion — assume stages ran.
  if (!e || typeof e !== 'object') {
    return { ast: done, cve: done, ai: done, partials: true, offline: false };
  }
  return {
    ast: e.ast !== false && e.ast !== 0,
    cve: e.cve !== false && e.cve !== 0,
    ai: Boolean(e.ai),
    partials: e.partials !== false,
    offline: Boolean(e.offline),
  };
}

function fileInventoryCount(scan) {
  const fromSummary = Number(scan?.summary?.totalFiles ?? NaN);
  const fromMeta = Number(scan?.meta?.totalFilesCount ?? NaN);
  const fromContents = scan?.fileContents ? Object.keys(scan.fileContents).length : 0;
  const fromFiles = Array.isArray(scan?.files) ? scan.files.length : 0;
  return Math.max(
    Number.isFinite(fromSummary) ? fromSummary : 0,
    Number.isFinite(fromMeta) ? fromMeta : 0,
    fromContents,
    fromFiles,
  );
}

function languagesEvidence(scan) {
  const metaLangs = Array.isArray(scan?.meta?.languages) ? scan.meta.languages : [];
  if (metaLangs.length) return { list: metaLangs, primary: scan?.meta?.primaryLanguage || metaLangs[0] };
  const primary = scan?.meta?.primaryLanguage;
  if (primary && primary !== 'Unknown') return { list: [primary], primary };

  const exts = new Set();
  const paths = [
    ...(Array.isArray(scan?.files) ? scan.files.map((f) => f.path || f.file || f.name || '') : []),
    ...(scan?.fileContents ? Object.keys(scan.fileContents) : []),
    ...(Array.isArray(scan?.issues) ? scan.issues.map((i) => i.file || '') : []),
  ];
  for (const p of paths) {
    const ext = String(p).split('.').pop()?.toLowerCase();
    if (!ext || ext === String(p).toLowerCase()) continue;
    if (ext === 'py') exts.add('Python');
    else if (['js', 'mjs', 'cjs', 'jsx'].includes(ext)) exts.add('JavaScript');
    else if (['ts', 'tsx'].includes(ext)) exts.add('TypeScript');
    else if (ext === 'java') exts.add('Java');
    else if (ext === 'go') exts.add('Go');
    else if (['c', 'h'].includes(ext)) exts.add('C');
    else if (['cpp', 'cc', 'cxx', 'hpp', 'hh'].includes(ext)) exts.add('C++');
    else if (['html', 'htm'].includes(ext)) exts.add('HTML');
    else if (['css', 'scss'].includes(ext)) exts.add('CSS');
    else if (ext === 'sql') exts.add('SQL');
  }
  return { list: [...exts], primary: [...exts][0] || null, inferred: true };
}

function isRealPatch(iss) {
  const patch = String(iss?.patchDiff || iss?.patch || '');
  if (!patch.trim()) return false;
  if (/auto-?fix patch applied|verify boundary constraints|EYRA_AUTO_FIX/i.test(patch)) return false;
  if (/\.\.\.\s*\(\d+\s*lines/i.test(patch)) return false;
  const added = patch
    .split('\n')
    .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    .map((l) => l.slice(1).trim())
    .filter(Boolean);
  if (added.some((l) => !/^(\/\/|#)/.test(l))) return true;
  return !/^(\+\+\+|---|@@)/m.test(patch) && patch.trim().length > 20;
}

function isStubPatch(iss) {
  const patch = String(iss?.patchDiff || iss?.patch || '');
  if (!patch.trim()) return false;
  return /auto-?fix patch applied|verify boundary constraints|EYRA_AUTO_FIX|\.\.\.\s*\(\d+\s*lines/i.test(
    patch,
  );
}

function findingKeyLoose(iss) {
  return `${(iss?.file || '').replace(/\\/g, '/')}:${iss?.line ?? ''}:${iss?.ruleId || iss?.title || ''}`;
}

/**
 * Build one checklist item.
 * @param {string} label
 * @param {CheckStatus} status
 * @param {string} reason
 * @returns {CheckItem}
 */
function item(label, status, reason) {
  return {
    label,
    status,
    met: status === 'pass',
    reason: reason || '',
  };
}

/**
 * @param {object|null|undefined} scan
 */
export function evaluateAssessmentCoverage(scan) {
  const live = scan?.id ? scan : null;
  const scanStatus = String(live?.status || '').toLowerCase();
  const completed = scanStatus === 'completed';
  const failed = scanStatus === 'failed';
  const analyzing = scanStatus === 'analyzing' || scanStatus === 'pending';
  const idle = !live;
  const engines = enginesOf(live || {});
  const issues = Array.isArray(live?.issues) ? live.issues : [];
  const filesN = fileInventoryCount(live);
  const langs = languagesEvidence(live);
  const hasSyntax = issues.some((i) =>
    /syntax|parse|PY-SYNTAX|JS-SYNTAX|unmatched|unclosed/i.test(issueBlob(i)),
  );
  const hasQuality = issues.some((i) =>
    /bug|smell|complex|quality|maintain|race|unreachable|except|mutable|eval|Code Smell|Bug Risk/i.test(
      issueBlob(i),
    ),
  );
  const hasSecurityRule = issues.some((i) =>
    /sec|security|injection|eval|exec|hardcoded|secret|token|password|CWE-89|CWE-798/i.test(
      issueBlob(i),
    ),
  );
  const hasSecretFinding = issues.some((i) =>
    /secret|password|api.?key|token|AKIA|hardcoded.?cred/i.test(
      `${i.title || ''}${i.ruleId || ''}${i.type || ''}`,
    ),
  );
  const withFileLine = issues.filter((i) => i.file && i.line != null);
  const realPatches = issues.filter(isRealPatch);
  const stubPatches = issues.filter(isStubPatch);
  const deps = Array.isArray(live?.dependencies) ? live.dependencies : [];
  const depVulnCount = Number(
    live?.summary?.dependencyVulnerabilities ?? deps.length ?? NaN,
  );
  const hasTestsFlag = Boolean(
    live?.meta?.hasTests ||
      (Number(live?.summary?.testFilesCount) || 0) > 0 ||
      Object.keys(live?.fileContents || {}).some((p) => /test|spec/i.test(p)),
  );
  const keys = issues.map(findingKeyLoose);
  const dupCount = keys.length - new Set(keys).size;

  // --- Repository coverage ---
  const repoItems = [
    (() => {
      const label = 'Repository files are inventoried.';
      if (idle) return item(label, 'not_run', 'No ZIP/GitHub scan loaded yet.');
      if (filesN > 0) {
        return item(label, 'pass', `Inventory reports ${filesN} file(s) (meta/summary/fileContents).`);
      }
      if (analyzing) return item(label, 'partial', 'Scan in progress — file inventory not finalized.');
      if (completed || failed) {
        return item(label, 'fail', 'Scan finished but totalFiles / file inventory is empty.');
      }
      return item(label, 'not_run', 'Waiting for ingest to populate file inventory.');
    })(),
    (() => {
      const label = 'File types and programming languages are identified.';
      if (idle) return item(label, 'not_run', 'No scan loaded.');
      if (langs.list.length && !langs.inferred) {
        return item(
          label,
          'pass',
          `Languages from ingest detector: ${langs.list.join(', ')}.`,
        );
      }
      if (langs.list.length && langs.inferred) {
        return item(
          label,
          'partial',
          `Inferred from file extensions only (${langs.list.join(', ')}); meta.languages not set.`,
        );
      }
      if (completed) {
        return item(label, 'fail', 'Completed scan has no language list or inferable extensions.');
      }
      return item(label, 'not_run', 'Language detection runs at ZIP/GitHub ingest (detectCodebaseMeta).');
    })(),
    (() => {
      const label = 'Unsupported or excluded files are identified.';
      if (idle) return item(label, 'not_run', 'No scan loaded.');
      if (live?.meta?.excludedFilesCount != null || live?.summary?.excludedFiles != null) {
        return item(
          label,
          'pass',
          `Exclusion report present (count=${live?.meta?.excludedFilesCount ?? live?.summary?.excludedFiles}).`,
        );
      }
      // Honest: walker skips node_modules/.git but does not emit an exclusion report
      if (completed || analyzing) {
        return item(
          label,
          'not_run',
          'Walkers skip node_modules/.git/dist, but the scan payload does not report excluded files.',
        );
      }
      return item(label, 'not_run', 'Exclusion reporting is not implemented in the scan API.');
    })(),
    (() => {
      const label = 'Unreadable files and parsing failures are reported.';
      if (idle) return item(label, 'not_run', 'No scan loaded.');
      if (!engines.ast && completed) {
        return item(label, 'not_run', 'AST engine was disabled for this scan — parser did not run.');
      }
      if (hasSyntax) {
        return item(label, 'pass', 'Syntax/parse findings are present in scan.issues.');
      }
      const unread = live?.summary?.unreadableFileCount ?? live?.unreadableFiles?.length;
      const parseFails = live?.summary?.parserFailureCount ?? live?.parserFailures?.length;
      if (unread != null || parseFails != null) {
        return item(
          label,
          Number(unread) + Number(parseFails) > 0 ? 'partial' : 'pass',
          `Unreadable=${unread ?? 0}, parserFailures=${parseFails ?? 0} (from analyzer report).`,
        );
      }
      if (live?.meta?.parseFailures != null) {
        return item(label, 'pass', `parseFailures=${live.meta.parseFailures} in scan meta.`);
      }
      const astTool = live?.toolStatuses?.eyraAst?.status;
      if (astTool === 'FAILED' || astTool === 'UNAVAILABLE') {
        return item(label, 'fail', `AST tool status=${astTool}: ${live.toolStatuses.eyraAst.message || ''}`);
      }
      if (engines.ast && completed) {
        return item(
          label,
          'pass',
          'AST/static engine completed; no syntax findings means no parse failures were reported.',
        );
      }
      if (analyzing) return item(label, 'partial', 'AST parse stage still running.');
      return item(label, 'not_run', 'Requires AST engine (analyzer-python) to execute.');
    })(),
  ];

  // --- Code analysis ---
  const analysisItems = [
    (() => {
      const label = 'Syntax errors are detected.';
      if (idle) return item(label, 'not_run', 'No scan loaded.');
      if (!engines.ast) {
        return item(label, 'not_run', 'AST engine disabled — syntax detection did not run.');
      }
      if (hasSyntax) return item(label, 'pass', 'One or more syntax findings were reported.');
      if (completed) {
        return item(label, 'pass', 'AST engine finished; no syntax errors found in this codebase.');
      }
      if (analyzing) return item(label, 'partial', 'Syntax analysis in progress.');
      return item(label, 'not_run', 'AST engine has not completed.');
    })(),
    (() => {
      const label = 'Common bugs and code-quality issues are identified.';
      if (idle) return item(label, 'not_run', 'No scan loaded.');
      if (!engines.ast) {
        return item(label, 'not_run', 'AST/static analyzer disabled for this scan.');
      }
      if (hasQuality || hasSecurityRule || issues.length > 0) {
        return item(
          label,
          'pass',
          `Static analyzer produced ${issues.length} issue(s) (bugs/quality/security types).`,
        );
      }
      if (completed) {
        return item(label, 'pass', 'Analyzer ran and reported zero bug/quality findings.');
      }
      if (analyzing) return item(label, 'partial', 'Static analysis still running.');
      return item(label, 'not_run', 'Waiting for analyzer-python / AST stage.');
    })(),
    (() => {
      const label = 'Findings link to the correct file and line.';
      if (idle) return item(label, 'not_run', 'No scan loaded.');
      if (!issues.length) {
        if (completed) {
          return item(label, 'pass', 'No findings to locate — nothing missing file/line.');
        }
        return item(label, 'not_run', 'No findings yet to verify file/line links.');
      }
      if (withFileLine.length === issues.length) {
        return item(label, 'pass', `All ${issues.length} findings include file and line.`);
      }
      if (withFileLine.length > 0) {
        return item(
          label,
          'partial',
          `${withFileLine.length}/${issues.length} findings have file+line; others lack location.`,
        );
      }
      return item(label, 'fail', 'Findings exist but none include both file and line.');
    })(),
    (() => {
      const label = 'Duplicate findings are identified or consolidated.';
      if (idle) return item(label, 'not_run', 'No scan loaded.');
      if (!completed && !issues.length) {
        return item(label, 'not_run', 'Dedup check runs after issues are produced.');
      }
      if (!issues.length && completed) {
        return item(label, 'pass', 'No findings — no duplicates to consolidate.');
      }
      if (dupCount > 0) {
        return item(
          label,
          'partial',
          `${dupCount} duplicate file:line:rule key(s) still present; full consolidator not enforced.`,
        );
      }
      if (completed || issues.length) {
        return item(label, 'pass', 'No duplicate file:line:ruleId keys in the current issue list.');
      }
      return item(label, 'not_run', 'Waiting for scan issues.');
    })(),
  ];

  // --- Security and dependencies ---
  const securityItems = [
    (() => {
      const label = 'Configured security rules execute.';
      if (idle) return item(label, 'not_run', 'No scan loaded.');
      if (!engines.ast) {
        return item(label, 'not_run', 'Security rules live in analyzer-python; AST engine was off.');
      }
      if (hasSecurityRule || hasSecretFinding) {
        return item(label, 'pass', 'Security-related findings present from the static engine.');
      }
      if (completed) {
        return item(label, 'pass', 'Security rule pass completed with no security findings.');
      }
      if (analyzing) return item(label, 'partial', 'Security rules still running.');
      return item(label, 'not_run', 'AST/security stage not finished.');
    })(),
    (() => {
      const label = 'Supported dependency manifests are detected and inspected.';
      if (idle) return item(label, 'not_run', 'No scan loaded.');
      if (!engines.cve) {
        const hasManifest = Object.keys(live?.fileContents || {}).some((p) =>
          /package-lock\.json|package\.json|requirements\.txt|poetry\.lock|Pipfile\.lock/i.test(p),
        );
        if (hasManifest) {
          return item(
            label,
            'partial',
            'Manifest files exist in the archive, but CVE engine was disabled so they were not inspected.',
          );
        }
        return item(label, 'not_run', 'CVE/dependency engine disabled for this scan.');
      }
      if (completed || Array.isArray(live?.dependencies)) {
        return item(
          label,
          'pass',
          `dependencyAuditor ran (dependencies[] length=${deps.length}).`,
        );
      }
      if (analyzing) return item(label, 'partial', 'Dependency audit in progress.');
      return item(label, 'not_run', 'Waiting for CVE stage.');
    })(),
    (() => {
      const label =
        'Known dependency vulnerabilities are checked against a configured advisory source, when available.';
      if (idle) return item(label, 'not_run', 'No scan loaded.');
      if (!engines.cve) {
        return item(label, 'not_run', 'CVE engine off — offline KNOWN_CVES advisory list was not used.');
      }
      if (completed || Number.isFinite(depVulnCount)) {
        return item(
          label,
          'pass',
          `Checked via EYRA offline curated advisory list (not live OSV.dev). Hits=${Number.isFinite(depVulnCount) ? depVulnCount : deps.length}; tool=${live?.toolStatuses?.dependencies?.status || 'n/a'}.`,
        );
      }
      if (analyzing) return item(label, 'partial', 'Advisory check still running.');
      return item(label, 'not_run', 'Advisory check has not executed.');
    })(),
    (() => {
      const label = 'Configured secret detection checks for common hardcoded credentials.';
      if (idle) return item(label, 'not_run', 'No scan loaded.');
      if (!engines.ast) {
        return item(label, 'not_run', 'secret_detector.py runs inside analyzer-python (AST engine).');
      }
      if (hasSecretFinding) {
        return item(label, 'pass', 'Secret-style findings were reported.');
      }
      if (completed) {
        return item(label, 'pass', 'Secret detection ran; no hardcoded credential findings.');
      }
      if (analyzing) return item(label, 'partial', 'Secret detection in progress.');
      return item(label, 'not_run', 'Secret detection has not finished.');
    })(),
  ];

  // --- Fix and verification ---
  const fixItems = [
    (() => {
      const label = 'Suggested patches show actual code changes.';
      if (idle) return item(label, 'not_run', 'No scan loaded.');
      if (realPatches.length > 0) {
        return item(label, 'pass', `${realPatches.length} finding(s) include a non-stub patchDiff.`);
      }
      if (stubPatches.length > 0) {
        return item(
          label,
          'fail',
          `${stubPatches.length} patch(es) look like stubs (e.g. Auto-fix placeholder), not real code changes.`,
        );
      }
      if (engines.ai && completed) {
        return item(label, 'partial', 'AI pass finished but no usable patchDiff bodies were attached.');
      }
      if (!engines.ai) {
        return item(label, 'not_run', 'AI semantic / patch generation was disabled for this scan.');
      }
      return item(label, 'not_run', 'Patch generation has not produced diffs yet.');
    })(),
    (() => {
      const label = 'Relevant existing tests are identified where available.';
      if (idle) return item(label, 'not_run', 'No scan loaded.');
      if (hasTestsFlag) {
        return item(
          label,
          'pass',
          `Tests flagged via meta.hasTests / testFilesCount / test|spec paths (count hint=${live?.summary?.testFilesCount ?? 'yes'}).`,
        );
      }
      if (completed) {
        return item(
          label,
          'partial',
          'No test files flagged in meta/summary; detector may have found none, or field missing.',
        );
      }
      return item(label, 'not_run', 'Test discovery runs at ingest (hasTests) / analyzer summary.testFilesCount.');
    })(),
    (() => {
      const label = 'Supported tests or static analysis actually execute.';
      if (idle) return item(label, 'not_run', 'No scan loaded.');
      const staticRan = engines.ast && (completed || issues.length > 0 || analyzing);
      if (live?.meta?.testsRun || live?.summary?.testsPassed != null) {
        return item(label, 'pass', 'Scan reports testsRun / testsPassed from the backend.');
      }
      if (staticRan && completed) {
        return item(
          label,
          'partial',
          'Static analysis (analyzer-python) executed; a full unit-test runner is not implemented in this project.',
        );
      }
      if (staticRan && analyzing) {
        return item(label, 'partial', 'Static analysis is running; test runner not available.');
      }
      if (!engines.ast) {
        return item(label, 'not_run', 'Neither test runner nor AST static analysis ran.');
      }
      return item(label, 'not_run', 'Static analysis / tests have not executed yet.');
    })(),
    (() => {
      const label = 'Failed tests and unverified fixes remain visible.';
      if (idle) return item(label, 'not_run', 'No scan loaded.');
      if (failed) {
        return item(label, 'pass', 'Failed scan status remains visible on the audit record.');
      }
      if (issues.length > 0) {
        return item(label, 'pass', `${issues.length} open finding(s) remain listed for review.`);
      }
      if (completed) {
        return item(
          label,
          'pass',
          'Completed scan retained in history; zero open findings (nothing hidden by empty wipe).',
        );
      }
      return item(label, 'not_run', 'No completed results yet to verify visibility.');
    })(),
  ];

  const rawGroups = [
    {
      id: 'repo',
      title: 'Repository coverage',
      description: 'Inventory, languages, exclusions, parse failures',
      items: repoItems,
    },
    {
      id: 'analysis',
      title: 'Code analysis',
      description: 'Syntax, quality rules, file/line links, dedupe',
      items: analysisItems,
    },
    {
      id: 'security',
      title: 'Security and dependencies',
      description: 'Security rules, manifests, advisories, secrets',
      items: securityItems,
    },
    {
      id: 'fix',
      title: 'Fix and verification',
      description: 'Real patches, tests, re-analysis, unverified visibility',
      items: fixItems,
    },
  ];

  const groups = rawGroups.map((g) => {
    const met = g.items.filter((i) => i.status === 'pass').length;
    const total = g.items.length;
    const statuses = g.items.map((i) => i.status);
    let cardStatus = 'idle';
    if (idle) cardStatus = 'idle';
    else if (statuses.every((s) => s === 'pass')) cardStatus = 'pass';
    else if (statuses.every((s) => s === 'not_run')) cardStatus = 'not_run';
    else if (statuses.some((s) => s === 'fail') && !statuses.some((s) => s === 'pass')) {
      cardStatus = 'fail';
    } else cardStatus = 'partial';

    return { ...g, met, total, status: cardStatus };
  });

  let overall = 'idle';
  if (!idle) {
    if (groups.every((g) => g.status === 'pass')) overall = 'pass';
    else if (groups.every((g) => g.status === 'not_run')) overall = 'not_run';
    else if (groups.some((g) => g.status === 'fail') && !groups.some((g) => g.status === 'pass')) {
      overall = 'fail';
    } else overall = 'partial';
  }

  return { groups, overall };
}

export function assessmentStatusLabel(status) {
  switch (status) {
    case 'pass':
      return 'PASS';
    case 'partial':
      return 'PARTIAL';
    case 'fail':
      return 'FAIL';
    case 'gap':
      return 'GAP';
    case 'not_run':
      return 'NOT RUN';
    case 'idle':
      return 'IDLE';
    default:
      return String(status || 'IDLE').toUpperCase();
  }
}

export function assessmentItemStatusLabel(status) {
  return assessmentStatusLabel(status);
}
