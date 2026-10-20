/**
 * A patch is applicable only when its removed lines exist in the scanned source.
 * Template diffs that invent SQL, keys, or comments are not applicable.
 */
import crypto from 'crypto';

const TEMPLATE_MARKERS = [
  'AKIA12345EXAMPLEKEY',
  'SELECT * FROM accounts WHERE id',
  'def process_queue(items=[])',
  'Auto-generated safety guard',
  'Verify boundary constraints before proceeding',
  'if not condition or not valid',
];

export function fileTextFor(files, filePath) {
  if (!filePath) return '';
  const wanted = String(filePath).replace(/\\/g, '/');
  if (Array.isArray(files)) {
    const hit = files.find((file) => {
      const name = String(file?.path || file?.file || file?.name || '').replace(/\\/g, '/');
      return name === wanted || name.endsWith(`/${wanted}`);
    });
    return String(hit?.content || hit?.text || hit?.source || '');
  }
  if (files && typeof files === 'object') {
    if (typeof files[wanted] === 'string') return files[wanted];
    const key = Object.keys(files).find(
      (name) => name.replace(/\\/g, '/') === wanted || name.endsWith(`/${wanted}`),
    );
    return key ? String(files[key] || '') : '';
  }
  return '';
}

export function removedPatchLines(diff) {
  return String(diff || '')
    .split('\n')
    .filter((line) => line.startsWith('-') && !line.startsWith('---'))
    .map((line) => line.slice(1).trim())
    .filter(Boolean);
}

export function sourceHash(text) {
  return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

export function patchGroundedInSource(diff, source) {
  const lines = removedPatchLines(diff);
  if (!lines.length || !source) return false;
  if (TEMPLATE_MARKERS.some((marker) => diff.includes(marker) && !source.includes(marker))) {
    return false;
  }
  return lines.every((line) => source.includes(line));
}

/**
 * Keep the explanation. Drop a diff that does not match this file.
 * @param {object} issue
 * @param {Array|Record<string, string>} files
 */
export function applyPatchGrounding(issue, files = []) {
  const source = fileTextFor(files, issue.file || issue.path);
  const diff = String(issue.patchDiff || '');
  if (!diff.trim() || !patchGroundedInSource(diff, source)) {
    issue.patchDiff = '';
    issue.patchApplicable = false;
    issue.patchState = 'none';
    issue.patchProvenance = issue.aiExplanation ? 'unavailable' : (issue.patchProvenance || 'unavailable');
    issue.patchSourceHash = source ? sourceHash(source) : null;
    issue.appliedToDisk = false;
    issue.verification = 'not_run';
    return issue;
  }
  issue.patchApplicable = true;
  issue.patchState = 'suggested';
  issue.patchProvenance = issue.patchProvenance || 'ai_generated';
  issue.patchSourceHash = sourceHash(source);
  issue.appliedToDisk = false;
  issue.verification = 'not_run';
  return issue;
}
