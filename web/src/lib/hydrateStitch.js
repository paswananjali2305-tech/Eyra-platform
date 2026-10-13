/**
 * In-place DOM hydration for frozen Stitch HTML.
 * Never removes nodes or rebuilds layout — only updates text / attributes.
 */

/** @param {ParentNode | null} root @param {string} selector */
export function qs(root, selector) {
  return root?.querySelector?.(selector) ?? null;
}

/** @param {ParentNode | null} root @param {string} selector */
export function qsa(root, selector) {
  return root ? Array.from(root.querySelectorAll(selector)) : [];
}

/**
 * Set textContent only when value is non-empty string/number.
 * @param {Element | null} el
 * @param {string | number | null | undefined} value
 */
export function setText(el, value) {
  if (!el || value === undefined || value === null || value === '') return;
  el.textContent = String(value);
}

/**
 * Replace exact whole-node text when it matches `from`.
 * @param {Element | null} root
 * @param {string} from
 * @param {string} to
 */
export function replaceExactText(root, from, to) {
  if (!root || !from || to === undefined || to === null) return;
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walk.nextNode();
  while (node) {
    if ((node.textContent || '').trim() === from) {
      node.textContent = String(to);
    }
    node = walk.nextNode();
  }
}

/**
 * Replace first occurrence of substring inside a text node under root.
 * @param {Element | null} root
 * @param {string} from
 * @param {string} to
 */
export function replaceSubstring(root, from, to) {
  if (!root || !from || to === undefined || to === null) return false;
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walk.nextNode();
  while (node) {
    const t = node.textContent || '';
    if (t.includes(from)) {
      node.textContent = t.replace(from, String(to));
      return true;
    }
    node = walk.nextNode();
  }
  return false;
}

/**
 * Find ancestor card whose label span matches labelText, then update
 * the first .font-display-lg number inside that card.
 * @param {Element | null} root
 * @param {string} labelText
 * @param {string | number} value
 */
export function setKpiByLabel(root, labelText, value) {
  if (!root) return;
  const labels = qsa(root, 'span, div, p');
  for (const lab of labels) {
    if ((lab.textContent || '').trim() !== labelText) continue;
    const card = lab.closest('.rounded-xl, .rounded-lg, [class*="rounded"]') || lab.parentElement;
    const num = card?.querySelector?.('.font-display-lg, .text-display-lg');
    if (num) {
      setText(num, value);
      return;
    }
  }
}

/**
 * Format relative time for history rows.
 * @param {string | Date} iso
 */
export function relativeTime(iso) {
  try {
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return '';
    const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
    if (sec < 60) return `${sec}s ago`;
    if (sec < 3600) return `${Math.floor(sec / 60)} mins ago`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
    return `${Math.floor(sec / 86400)}d ago`;
  } catch {
    return '';
  }
}

/**
 * Humanize session status for Stitch badges.
 * @param {string} status
 */
export function formatStatus(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'needs_review') return 'Needs Review';
  if (s === 'verified') return 'Verified';
  if (s === 'hypothesis') return 'Hypothesis';
  if (s === 'unverified') return 'Unverified';
  if (s === 'failed') return 'Failed';
  return status || 'Unknown';
}

/**
 * Short session badge like #0142 from uuid or id.
 * @param {string} sessionId
 * @param {number} index
 */
export function shortSessionTag(sessionId, index = 0) {
  if (!sessionId) return `#${String(index + 1).padStart(4, '0')}`;
  const raw = String(sessionId).trim();
  // EYRA-F1B3237685E4 → #F1B3 (skip shared EYRA prefix so rows stay unique)
  const withoutPrefix = raw.replace(/^EYRA[-_]?/i, '');
  const compact = withoutPrefix.replace(/[^a-zA-Z0-9]/g, '');
  if (compact.length >= 4) return `#${compact.slice(0, 4).toUpperCase()}`;
  const fallback = raw.replace(/[^a-zA-Z0-9]/g, '');
  if (fallback.length >= 4) return `#${fallback.slice(-4).toUpperCase()}`;
  return `#${String(index + 1).padStart(4, '0')}`;
}
