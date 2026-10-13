/**
 * Shared empty / offline UI for Stitch-backed pages.
 * Prefer live data or an honest empty state — never leave demo HTML in place.
 */

import { qsa, replaceSubstring, setKpiByLabel, setText } from './hydrateStitch.js';

export function emptyStateHtml({
  icon = 'inventory_2',
  title = 'No data yet',
  detail = 'Connect the Brain and run a scan or investigation.',
  tone = 'outline',
} = {}) {
  const iconTone = tone === 'error' ? 'text-error' : 'text-outline';
  return `
<div data-eyra-empty="1" class="w-full p-space-lg rounded-xl bg-surface-container-low border border-outline-variant/20 flex flex-col items-center gap-space-sm text-center">
  <span class="material-symbols-outlined text-[28px] ${iconTone}">${icon}</span>
  <div class="font-headline-sm text-headline-sm text-on-surface font-semibold">${title}</div>
  <p class="font-body-sm text-body-sm text-on-surface-variant max-w-md">${detail}</p>
</div>`;
}

/** Zero common stitch KPI labels so demo numbers never linger. */
export function zeroStitchKpis(root, labels = []) {
  if (!root) return;
  for (const label of labels) {
    setKpiByLabel(root, label, '0');
  }
}

/** Hide elements whose text still looks like stitch demo content. */
export function hideMatchingNodes(root, predicate) {
  if (!root) return;
  qsa(root, 'div, li, article, section').forEach((el) => {
    if (predicate(el.textContent || '')) {
      el.style.display = 'none';
      el.setAttribute('data-eyra-demo-hidden', '1');
    }
  });
}

export function scrubCommonDemoLabels(root) {
  if (!root) return;
  replaceSubstring(root, 'backend-api', '—');
  replaceSubstring(root, 'ZeroDivisionError', '—');
  replaceSubstring(root, 'EYRA-SESSION-0142', '—');
  replaceSubstring(root, '#SC-088', '—');
  replaceSubstring(root, '#SC-089', '—');
  replaceSubstring(root, '342 Files', '0 Files');
  replaceSubstring(root, '42,180 total LOC', '0 total LOC');
  replaceSubstring(root, '4 Crit', '0 Crit');
  replaceSubstring(root, '9 High', '0 High');
  replaceSubstring(root, '11 Med', '0 Med');
  replaceSubstring(root, '4 Low', '0 Low');
  replaceSubstring(root, '89 verified', '0 verified');
  replaceSubstring(root, '3 active', '0 active');
}

/** Mount or update a fixed notice strip (optional). */
export function setPageNotice(host, message, { id = 'eyra-page-notice', error = false } = {}) {
  if (!host) return;
  let el = host.querySelector(`#${id}`);
  if (!message) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    el.className =
      'fixed bottom-6 left-1/2 z-[80] -translate-x-1/2 rounded px-space-md py-space-sm font-body-sm text-body-sm shadow-xl';
    host.appendChild(el);
  }
  el.className = error
    ? 'fixed bottom-6 left-1/2 z-[80] -translate-x-1/2 rounded bg-error/20 px-space-md py-space-sm font-body-sm text-body-sm text-error shadow-xl'
    : 'fixed bottom-6 left-1/2 z-[80] -translate-x-1/2 rounded bg-surface-container-highest/95 px-space-md py-space-sm font-body-sm text-body-sm text-on-surface-variant shadow-xl';
  setText(el, message);
}
