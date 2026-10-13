import { languageLabelFromPath } from './auditLanguages.js';

/**
 * Map Eyraaaa scan payloads into AuditCodeWorkspace shapes.
 * No demo/mockRepo fallback — empty workspace when scan data is absent.
 */

function extLang(path) {
  const ext = (path.split('.').pop() || '').toLowerCase();
  if (ext === 'json') return 'JSON';
  if (ext === 'md') return 'Markdown';
  if (ext === 'txt' || ext === 'toml' || ext === 'ini' || ext === 'cfg') return 'Text';
  if (ext === 'yml' || ext === 'yaml') return 'YAML';
  if (ext === 'css' || ext === 'scss') return 'CSS';
  if (ext === 'html' || ext === 'htm') return 'HTML';
  if (ext === 'sql') return 'SQL';
  if (ext === 'sh' || ext === 'bash') return 'Shell';
  return languageLabelFromPath(path);
}

function textToLines(text, highlightLine) {
  const parts = String(text ?? '').length ? String(text).split('\n') : [''];
  return parts.map((t, i) => ({
    n: i + 1,
    text: t,
    crash: highlightLine != null && i + 1 === Number(highlightLine),
  }));
}

/**
 * @param {object} issue
 */
export function mapIssueToFinding(issue) {
  if (!issue) return null;
  const sev = issue.severity || 'Medium';
  return {
    title: issue.title || issue.ruleId || 'Finding',
    line: issue.line != null ? Number(issue.line) : null,
    column: issue.column != null ? Number(issue.column) : null,
    cwe: issue.ruleId || issue.type || sev,
    summary: issue.aiExplanation || issue.description || issue.suggestion || '',
    impact: issue.description || issue.aiExplanation || issue.suggestion || '',
    suggestion: issue.suggestion || issue.aiExplanation || '',
    patch: issue.patchDiff || issue.patch || '',
    severity: sev,
    ruleId: issue.ruleId,
    type: issue.type,
    snippet: issue.snippet || '',
    id: issue.id,
    file: issue.file || '',
  };
}

/**
 * Build FILE_CONTENTS-compatible map from a completed/partial scan.
 * @param {object} scan
 */
export function buildFileContentsFromScan(scan) {
  if (!scan) return null;
  const fileContents = scan.fileContents || {};
  const issues = Array.isArray(scan.issues) ? scan.issues : [];
  const byFile = new Map();

  for (const issue of issues) {
    const path = (issue.file || '').replace(/\\/g, '/');
    if (!path) continue;
    if (!byFile.has(path)) byFile.set(path, []);
    byFile.get(path).push(issue);
  }

  const paths = new Set([...Object.keys(fileContents), ...byFile.keys()]);
  if (!paths.size) return null;

  /** @type {Record<string, object>} */
  const out = {};
  for (const path of paths) {
    const fileIssues = (byFile.get(path) || []).slice().sort((a, b) => (a.line || 0) - (b.line || 0));
    const primary = fileIssues[0];
    const finding = mapIssueToFinding(primary);
    const text =
      fileContents[path] != null
        ? String(fileContents[path])
        : primary?.snippet
          ? String(primary.snippet)
          : '';
    const allFindings = fileIssues.map((iss) => ({
      path,
      ...mapIssueToFinding(iss),
    }));
    out[path] = {
      language: extLang(path),
      dirty: Boolean(finding),
      finding: finding ? { path, ...finding } : null,
      allFindings,
      lines: textToLines(text, finding?.line),
      text,
      _live: true,
      // Prefer full file body; snippet-only is labeled for honesty in the UI
      _snippetOnly: fileContents[path] == null && Boolean(primary?.snippet),
    };
  }
  return out;
}

/**
 * Build a REPO_TREE-like folder structure from file paths.
 * @param {string[]} paths
 * @param {string} [rootName]
 */
export function buildRepoTreeFromPaths(paths, rootName = 'codebase') {
  const root = { id: rootName, name: rootName, type: 'folder', children: [] };

  function ensureFolder(parent, name, id) {
    let folder = parent.children.find((c) => c.type === 'folder' && c.name === name);
    if (!folder) {
      folder = { id, name, type: 'folder', children: [] };
      parent.children.push(folder);
    }
    return folder;
  }

  const sorted = [...new Set(paths.map((p) => p.replace(/\\/g, '/')))].sort();
  for (const path of sorted) {
    const parts = path.split('/').filter(Boolean);
    let parent = root;
    let prefix = rootName;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const id = `${prefix}/${part}`;
      if (i === parts.length - 1) {
        parent.children.push({
          id: path,
          name: part,
          type: 'file',
          ext: part.includes('.') ? part.split('.').pop() : '',
          severity: null,
          badges: [],
        });
      } else {
        parent = ensureFolder(parent, part, id);
        prefix = id;
      }
    }
  }
  return root;
}

function sevBucket(severity) {
  const s = String(severity || '').toLowerCase();
  if (s.startsWith('crit')) return 'critical';
  if (s.startsWith('high')) return 'high';
  if (s.startsWith('med')) return 'medium';
  if (s.startsWith('low') || s.startsWith('info')) return 'low';
  return 'medium';
}

/** Color tones for tree badges — critical red, high orange, medium amber, low blue. */
function badgeFromCounts(counts) {
  const badges = [];
  if (counts.critical > 0) {
    badges.push({ label: String(counts.critical), tone: 'critical', title: `${counts.critical} critical` });
  }
  if (counts.high > 0) {
    badges.push({ label: String(counts.high), tone: 'high', title: `${counts.high} high` });
  }
  if (counts.medium > 0) {
    badges.push({ label: String(counts.medium), tone: 'medium', title: `${counts.medium} medium` });
  }
  if (counts.low > 0) {
    badges.push({ label: String(counts.low), tone: 'low', title: `${counts.low} low` });
  }
  return badges;
}

function emptyCounts() {
  return { critical: 0, high: 0, medium: 0, low: 0 };
}

function addCounts(a, b) {
  return {
    critical: a.critical + b.critical,
    high: a.high + b.high,
    medium: a.medium + b.medium,
    low: a.low + b.low,
  };
}

function worstSeverity(counts) {
  if (counts.critical > 0) return 'critical';
  if (counts.high > 0) return 'high';
  if (counts.medium > 0) return 'medium';
  if (counts.low > 0) return 'low';
  return null;
}

/**
 * Annotate tree file + folder nodes with color-coded issue counts.
 * e.g. red "2" = 2 critical, amber "3" = 3 medium (folders roll up children).
 */
export function annotateTreeSeverity(tree, fileContents) {
  if (!tree || !fileContents) return tree;

  function fileCounts(path) {
    const f = fileContents[path];
    const counts = emptyCounts();
    const list =
      Array.isArray(f?.allFindings) && f.allFindings.length
        ? f.allFindings
        : f?.finding
          ? [f.finding]
          : [];
    for (const iss of list) {
      counts[sevBucket(iss.severity)] += 1;
    }
    return counts;
  }

  function walk(node) {
    if (!node?.type) return emptyCounts();
    if (node.type === 'file') {
      const counts = fileCounts(node.id);
      node.issueCounts = counts;
      node.severity = worstSeverity(counts);
      node.badges = badgeFromCounts(counts);
      return counts;
    }
    let total = emptyCounts();
    for (const child of node.children || []) {
      total = addCounts(total, walk(child));
    }
    node.issueCounts = total;
    node.severity = worstSeverity(total);
    node.badges = badgeFromCounts(total);
    return total;
  }

  const clone = JSON.parse(JSON.stringify(tree));
  walk(clone);
  return clone;
}

/**
 * Resolve workspace data from a live scan only (no mockRepo).
 * @param {object|null} scan
 */
export function resolveAuditWorkspace(scan) {
  const liveFiles = buildFileContentsFromScan(scan);
  const usingLive = Boolean(liveFiles && Object.keys(liveFiles).length);

  if (!usingLive) {
    return {
      usingLive: false,
      fileContents: {},
      repoTree: null,
      defaultFolders: [],
      projectLabel: scan?.id
        ? `${scan.projectName || 'codebase'} · no files yet`
        : 'No active scan',
      findings: [],
      summary: scan?.summary || null,
    };
  }

  const paths = Object.keys(liveFiles);
  let tree = buildRepoTreeFromPaths(paths, scan.projectName || 'codebase');
  tree = annotateTreeSeverity(tree, liveFiles);

  // Flatten every finding (not just the primary per file)
  const findings = [];
  for (const [path, f] of Object.entries(liveFiles)) {
    const list =
      Array.isArray(f?.allFindings) && f.allFindings.length
        ? f.allFindings
        : f?.finding
          ? [{ path, ...f.finding }]
          : [];
    for (const iss of list) {
      findings.push({ ...iss, language: f.language, path: iss.path || path });
    }
  }

  const folders = [];
  (function walk(node) {
    if (!node) return;
    if (node.type === 'folder') {
      folders.push(node.id);
      (node.children || []).forEach(walk);
    }
  })(tree);

  return {
    usingLive: true,
    fileContents: liveFiles,
    repoTree: tree,
    defaultFolders: folders,
    projectLabel: `${scan.projectName || 'codebase'} · ${String(scan.id || '').slice(0, 8)}`,
    findings,
    summary: scan.summary || null,
  };
}
