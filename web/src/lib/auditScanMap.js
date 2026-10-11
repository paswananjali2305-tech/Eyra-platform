/**
 * Map Eyraaaa scan payloads into AuditCodeWorkspace shapes.
 * Preserves mockRepo as fallback when scan data is absent.
 */

import { DEFAULT_OPEN_FOLDERS, FILE_CONTENTS, REPO_TREE } from '../data/mockRepo.js';

function extLang(path) {
  const ext = (path.split('.').pop() || '').toLowerCase();
  if (ext === 'py') return 'Python 3.11';
  if (ext === 'js' || ext === 'mjs' || ext === 'cjs') return 'JavaScript';
  if (ext === 'ts' || ext === 'tsx') return 'TypeScript';
  if (ext === 'json') return 'JSON';
  if (ext === 'md') return 'Markdown';
  if (ext === 'txt') return 'Text';
  return 'Text';
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
    impact: issue.description || issue.suggestion || issue.aiExplanation || '',
    patch: issue.patchDiff || '',
    severity: sev,
    ruleId: issue.ruleId,
    type: issue.type,
    snippet: issue.snippet || '',
    id: issue.id,
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

/**
 * Annotate tree file nodes with severity badges from findings.
 */
export function annotateTreeSeverity(tree, fileContents) {
  if (!tree || !fileContents) return tree;

  function walk(node) {
    if (node.type === 'file') {
      const f = fileContents[node.id];
      const sev = f?.finding?.severity;
      if (sev) {
        node.severity = String(sev).toLowerCase();
        const letter = String(sev)[0]?.toUpperCase() || 'I';
        node.badges = [{ label: `1${letter}`, tone: /critical/i.test(sev) ? 'error' : 'secondary' }];
      }
      return;
    }
    (node.children || []).forEach(walk);
  }
  const clone = JSON.parse(JSON.stringify(tree));
  walk(clone);
  return clone;
}

export function mapPartials(scan) {
  const list = scan?.partialFeatures || [];
  if (!list.length) return null;
  return list.map((p, i) => ({
    id: p.id || `pf-${i}`,
    file: (p.file || '').replace(/\\/g, '/'),
    line: p.line ?? 0,
    type: p.type || 'TODO',
    risk: p.risk || 'Medium',
    effort: p.estimatedEffortHours != null ? `${p.estimatedEffortHours}h` : p.effort || '?',
    description: p.featureDescription || p.description || p.type || 'Partial feature',
  }));
}

export function mapDependencies(scan) {
  const list = scan?.dependencies || [];
  if (!list.length) return null;
  return list.map((d, i) => ({
    path: d.package || d.file || `dependency-${i}`,
    line: 1,
    title: `${d.package || 'package'} ${d.cve || ''}`.trim(),
    cwe: d.cve || 'CVE',
    summary: `${d.severity || ''} · installed ${d.installedVersion || '?'} → patch ${d.patchedVersion || '?'}`,
    severity: d.severity,
    package: d.package,
  }));
}

export function mapTrendsFromScans(scans) {
  if (!scans?.length) return null;
  return scans.slice(0, 4).map((s, i) => {
    const sev = s.summary?.severity || {};
    return {
      label: i === 0 ? 'Latest' : s.projectName || s.createdAt || `Scan ${i + 1}`,
      critical: sev.Critical || 0,
      high: sev.High || 0,
      medium: sev.Medium || 0,
      score: s.summary?.healthScore ?? 0,
    };
  });
}

/**
 * Resolve workspace data: live scan preferred, mockRepo fallback.
 * @param {object|null} scan
 */
export function resolveAuditWorkspace(scan) {
  const liveFiles = buildFileContentsFromScan(scan);
  const usingLive = Boolean(liveFiles && Object.keys(liveFiles).length);

  if (!usingLive) {
    return {
      usingLive: false,
      fileContents: FILE_CONTENTS,
      repoTree: REPO_TREE,
      defaultFolders: DEFAULT_OPEN_FOLDERS,
      projectLabel: 'backend-api (demo fallback)',
      findings: Object.entries(FILE_CONTENTS)
        .filter(([, f]) => f?.finding)
        .map(([path, f]) => ({ path, ...f.finding, language: f.language })),
      partials: null,
      dependencies: null,
      summary: null,
    };
  }

  const paths = Object.keys(liveFiles);
  let tree = buildRepoTreeFromPaths(paths, scan.projectName || 'codebase');
  tree = annotateTreeSeverity(tree, liveFiles);

  const findings = Object.entries(liveFiles)
    .filter(([, f]) => f?.finding)
    .map(([path, f]) => ({ path, ...f.finding, language: f.language }));

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
    partials: mapPartials(scan),
    dependencies: mapDependencies(scan),
    summary: scan.summary || null,
  };
}
