import { useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useEyra } from '../context/EyraContext';
import { useStitchGate } from '../hooks/useStitchGate.js';
import {
  qsa,
  relativeTime,
  setText,
} from '../lib/hydrateStitch.js';
import {
  buildMemoryInvestigationHtml,
  getSessionPatchText,
} from '../lib/investigationPanel.js';
import { scrubCommonDemoLabels } from '../lib/stitchEmpty.js';
import MemoryStitch from './stitch_raw/MemoryPage.jsx';

/**
 * Memory & Knowledge — content/data integrity over stitch layout.
 *
 * Real capabilities (SQLite sessions): error context, root cause, suggested fix,
 * verification status, timestamps, exact error_type relatedness.
 * NOT implemented: AST fingerprints, similarity %, remediation consensus,
 * verified fix templates without verification evidence.
 */

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Sequential list tags: #01, #02, … (not session-hash fragments). */
function seqTag(index) {
  return `#${String((index ?? 0) + 1).padStart(2, '0')}`;
}

function reasoningLabel(source) {
  const s = String(source || '').toLowerCase();
  if (s === 'groq') return 'AI provider (Groq)';
  if (s === 'local_heuristic') return 'Local heuristic';
  return source || 'Unknown source';
}

function memoryCardTargets(root) {
  const strip = root.querySelector('[data-eyra-memory-strip]');
  if (strip) {
    return Array.from(strip.querySelectorAll('[data-session-id], [id^="item-"], .eyra-memory-card'));
  }
  const cards = qsa(root, '.p-space-sm.rounded, [id^="item-"]');
  return cards.filter((c) => {
    const t = c.textContent || '';
    if (/#A-\d+|Unsanitized SQL|Incomplete Async|PATCH APPROVED|REVIEW PENDING/i.test(t)) {
      return false;
    }
    return /#\d{1,4}|ZeroDivision|Redis|KeyError|Error|SyntaxError|No memory|Brain offline|Session/i.test(
      t,
    );
  });
}

/**
 * Stack layout: horizontal investigation cards on top, detail pane full-width below.
 */
function applyStackedHorizontalLayout(root) {
  if (!root) return;

  const grid =
    root.querySelector('.lg\\:grid-cols-12') ||
    Array.from(root.querySelectorAll('div')).find((el) =>
      /\bgrid-cols-12\b/.test(el.className || ''),
    );
  if (grid) {
    grid.className = 'flex flex-col gap-space-md p-space-md w-full min-w-0';
    grid.style.display = 'flex';
    grid.style.flexDirection = 'column';
  }

  const left =
    root.querySelector('.lg\\:col-span-5') ||
    (grid &&
      Array.from(grid.children).find((el) => /\bcol-span-5\b/.test(el.className || '')));
  const right =
    root.querySelector('.lg\\:col-span-7') ||
    (grid &&
      Array.from(grid.children).find((el) => /\bcol-span-7\b/.test(el.className || '')));

  if (left) {
    left.className = 'w-full flex flex-col gap-space-sm min-w-0 order-1';
    left.style.width = '100%';
  }
  if (right) {
    right.className = 'w-full flex flex-col gap-space-sm min-w-0 order-2';
    right.style.width = '100%';
    right.style.display = '';
  }

  // Hide leftover SQLite status strip above the list (not the card strip)
  if (left) {
    Array.from(left.children).forEach((child) => {
      const t = child.textContent || '';
      if (/SQLite 3\.|4\.2 MB|WAL MODE/i.test(t) && t.length < 200) {
        child.style.display = 'none';
      }
    });
  }

  const existing = memoryCardTargets(root);
  if (!existing.length) return;

  let strip = root.querySelector('[data-eyra-memory-strip]');
  if (!strip) {
    const parent = existing[0].parentElement;
    strip = document.createElement('div');
    strip.setAttribute('data-eyra-memory-strip', '1');
    strip.className =
      'eyra-memory-strip flex flex-row flex-nowrap gap-space-sm overflow-x-auto eyra-terminal-scroll w-full pb-1';
    strip.style.scrollSnapType = 'x mandatory';
    if (parent) {
      parent.insertBefore(strip, existing[0]);
      existing.forEach((card) => strip.appendChild(card));
    }
  }

  Array.from(strip.children).forEach((card) => {
    styleHorizontalCard(card);
  });
}

function styleHorizontalCard(card) {
  if (!card) return;
  card.classList.add('eyra-memory-card');
  card.style.flex = '0 0 300px';
  card.style.minWidth = '280px';
  card.style.maxWidth = '320px';
  card.style.width = '300px';
  card.style.scrollSnapAlign = 'start';
  card.style.cursor = 'pointer';
  if (getComputedStyle(card).position === 'static') card.style.position = 'relative';
}

/** Clone stitch card template so we can show more than the mock slots. */
function ensureCardSlots(root, count) {
  applyStackedHorizontalLayout(root);
  const strip = root.querySelector('[data-eyra-memory-strip]');
  if (!strip) return memoryCardTargets(root);

  const max = Math.min(Math.max(count, 1), 24);
  let cards = Array.from(strip.querySelectorAll('.eyra-memory-card, [id^="item-"]'));
  if (!cards.length) return [];

  const template = cards[0];
  while (cards.length < max) {
    const clone = template.cloneNode(true);
    clone.id = `item-eyra-${String(cards.length + 1).padStart(2, '0')}`;
    clone.removeAttribute('data-session-id');
    strip.appendChild(clone);
    styleHorizontalCard(clone);
    cards = Array.from(strip.querySelectorAll('.eyra-memory-card, [id^="item-"]'));
  }
  return cards;
}

/** Keep section markers 01 // / 02 // / 03 // intact after hydration. */
function restoreSectionMarkers(pane) {
  if (!pane) return;
  const map = [
    [/Current Error|Canonical Error/i, '01 //'],
    [/Root Cause/i, '02 //'],
    [/Suggested Fix|Verified Fix/i, '03 //'],
  ];
  pane.querySelectorAll('h2').forEach((h2) => {
    const title = (h2.textContent || '').trim();
    const hit = map.find(([re]) => re.test(title));
    if (!hit) return;
    const row = h2.parentElement;
    if (!row) return;
    const marker = row.querySelector('span.font-mono, span.font-label-sm');
    if (marker) setText(marker, hit[1]);
  });
}

function qsById(root, id) {
  return root.querySelector(`#${id}`);
}

function textBtn(root, label) {
  return Array.from(root.querySelectorAll('button')).find(
    (b) => (b.textContent || '').trim() === label,
  );
}

function hideMemoryMocks(root) {
  if (!root) return;
  const hide = (el) => {
    if (el) el.style.display = 'none';
  };

  qsa(root, 'div').forEach((el) => {
    const t = el.textContent || '';
    if (
      /Runtime Memory/i.test(t) &&
      /Audit Knowledge/i.test(t) &&
      /142 patterns|312 rules/i.test(t) &&
      t.length < 350 &&
      !el.querySelector('h1')
    ) {
      hide(el);
    }
  });

  const filterInput = root.querySelector('input[placeholder*="Filter AST"]');
  const allPill = qsById(root, 'pill-all') || textBtn(root, 'All Records');
  const filterAnchor = filterInput || allPill;
  if (filterAnchor) {
    let node = filterAnchor.parentElement;
    for (let i = 0; i < 6 && node; i += 1) {
      const t = node.textContent || '';
      if (
        (/Filter AST|Project:|Lang:/i.test(t) ||
          /All Records.*Audit Patterns|Security Rules/i.test(t)) &&
        !node.querySelector('h1') &&
        t.length < 900
      ) {
        hide(node);
        break;
      }
      node = node.parentElement;
    }
  }

  qsa(root, 'div').forEach((el) => {
    const t = el.textContent || '';
    if (/WAL MODE/i.test(t) && /CACHE HIT/i.test(t) && t.length < 200) hide(el);
  });

  const auditHeader = Array.from(root.querySelectorAll('span')).find((el) =>
    /Codebase Audit Patterns/i.test(el.textContent || ''),
  );
  if (auditHeader) {
    const blockStart = auditHeader.closest('.flex.items-center.justify-between');
    hide(blockStart);
    let sib = blockStart?.nextElementSibling;
    while (sib) {
      const t = sib.textContent || '';
      if (/SQLite Storage Engine|Runtime Asts|P95 Lookup/i.test(t)) break;
      if (
        /#A-\d+|PATCH APPROVED|REVIEW PENDING|PY-SEC|PY-CODE/i.test(t) ||
        sib.classList.contains('p-space-sm')
      ) {
        const next = sib.nextElementSibling;
        hide(sib);
        sib = next;
        continue;
      }
      break;
    }
  }

  qsa(root, 'div').forEach((el) => {
    const t = el.textContent || '';
    if (
      /SQLite Storage Engine/i.test(t) &&
      /Runtime Asts/i.test(t) &&
      /P95 Lookup/i.test(t) &&
      t.length < 500
    ) {
      hide(el);
    }
  });

  const xref = Array.from(root.querySelectorAll('h2')).find((el) =>
    /Connected Cross-References/i.test(el.textContent || ''),
  );
  if (xref) hide(xref.closest('.flex.flex-col.gap-space-xs'));

  qsa(root, 'div').forEach((el) => {
    const t = el.textContent || '';
    if (
      /Retrieval Engine Transparency/i.test(t) &&
      /Deterministic AST Active|Vector Roadmapped/i.test(t) &&
      t.length < 800
    ) {
      hide(el);
    }
  });
}

/** Rename section titles in-place (layout unchanged). */
function applyHonestLabels(root) {
  if (!root) return;

  const renameExact = (selector, from, to) => {
    qsa(root, selector).forEach((el) => {
      if ((el.textContent || '').trim() === from) setText(el, to);
    });
  };

  renameExact('span', 'Runtime Debugging Patterns', 'Similar Past Investigations');
  renameExact('h2', 'Canonical Error Signature & AST Token Match', 'Current Error & Evidence');
  // HTML entity form may already be decoded in DOM
  qsa(root, 'h2').forEach((el) => {
    const t = (el.textContent || '').trim();
    if (/Canonical Error Signature/i.test(t)) setText(el, 'Current Error & Evidence');
    if (/Stored Root Cause Knowledge/i.test(t)) setText(el, 'Root Cause & Reasoning');
    if (/Verified Fix Template/i.test(t)) setText(el, 'Suggested Fix & Verification');
  });

  // Subtitle: drop audit claim
  const sub = root.querySelector('p.font-body-sm');
  if (sub && /codebase audit/i.test(sub.textContent || '')) {
    setText(
      sub,
      'Persistent runtime intelligence — saved debugging sessions, error context, root-cause notes, and suggested fixes from SQLite.',
    );
  }

  // Relabel mock fingerprint panel title
  qsa(root, 'span').forEach((el) => {
    const t = (el.textContent || '').trim();
    if (/Normalized Exception Fingerprint/i.test(t)) setText(el, 'Error summary');
    if (/SQLite AST Fingerprint Hashes/i.test(t)) setText(el, 'Session evidence');
    if (/Engine Remediation Consensus/i.test(t)) setText(el, 'Suggestion source');
    // Confidence score removed from Memory UI
    if (/Confidence/i.test(t)) el.style.display = 'none';
  });

  // Align section number + title rows
  root.querySelectorAll('h2').forEach((h2) => {
    const row = h2.parentElement;
    if (!row) return;
    if (!/Current Error|Root Cause|Suggested Fix|Verified Fix|Canonical/i.test(h2.textContent || '')) {
      return;
    }
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '0.375rem';
  });
}

function showEmptyInCards(root, message) {
  const targets = memoryCardTargets(root);
  if (!targets.length) return;
  targets.forEach((c, i) => {
    if (i === 0) {
      c.style.display = '';
      c.innerHTML = `
<div class="flex flex-col items-center gap-2 py-space-md text-center w-full">
  <span class="material-symbols-outlined text-[24px] text-outline">inbox</span>
  <div class="font-headline-sm text-headline-sm text-on-surface font-semibold">${esc(message)}</div>
  <p class="font-body-sm text-body-sm text-on-surface-variant">Run an investigation in Debugging Workspace to store a session here.</p>
</div>`;
    } else {
      c.style.display = 'none';
    }
  });
}

function markSelectedCard(root, sessionId) {
  memoryCardTargets(root).forEach((card) => {
    if (card.style.display === 'none') return;
    const selected = card.dataset.sessionId === sessionId;
    card.classList.toggle('bg-surface-container-high', selected);
    card.classList.toggle('shadow-md', selected);
    card.classList.toggle('ring-1', selected);
    card.classList.toggle('ring-primary/40', selected);
    card.classList.toggle('bg-surface-container', !selected);
    if (getComputedStyle(card).position === 'static') card.style.position = 'relative';
    let bar = card.querySelector('[data-eyra-sel-bar]');
    if (!bar) {
      bar = document.createElement('div');
      bar.setAttribute('data-eyra-sel-bar', '1');
      card.prepend(bar);
    }
    bar.className = selected
      ? 'absolute left-0 top-0 bottom-0 w-1 bg-primary-container rounded-l'
      : 'absolute left-0 top-0 bottom-0 w-1 bg-transparent rounded-l';
  });
}

function hydrateDetailPane(root, detail, index = 0) {
  if (!root || !detail) return;
  const pane =
    root.querySelector('.lg\\:col-span-7') ||
    Array.from(root.querySelectorAll('div')).find((el) =>
      /Current Error & Evidence|Canonical Error Signature/i.test(el.textContent || ''),
    );
  if (!pane) return;

  const tag = seqTag(index);
  pane.dataset.sessionId = detail.session_id || '';
  pane.dataset.errorType = detail.error_type || '';
  pane.dataset.listIndex = String(index);

  const title = pane.querySelector('.font-headline-md');
  if (title) setText(title, detail.error_type || 'Investigation');

  // Status chip: VERIFIED (no HYPOTHESIS / CANONICAL labels)
  const statusBadge = Array.from(pane.querySelectorAll('span')).find((el) =>
    /CANONICAL|HYPOTHESIS|VERIFIED|NEEDS|SUGGESTED|UNVERIFIED/i.test((el.textContent || '').trim()),
  );
  if (statusBadge) setText(statusBadge, 'VERIFIED');

  const metaLine = title?.parentElement?.parentElement?.querySelector('.font-code-compact');
  if (metaLine) {
    setText(
      metaLine,
      `${tag} · ${detail.file_name || 'snippet'} · ${detail.language || 'code'} · ${detail.project_name || 'default'}`,
    );
  }

  const avatar = pane.querySelector('.w-8.h-8.rounded.bg-primary-container');
  if (avatar) setText(avatar, tag.replace(/^#/, ''));

  // Hide confidence score entirely
  Array.from(pane.querySelectorAll('span')).forEach((el) => {
    if (!/Confidence/i.test(el.textContent || '')) return;
    el.style.display = 'none';
  });

  // Error summary (must match this session's error_type)
  const errBox = pane.querySelector(
    '.text-error.font-medium, .bg-surface-container-lowest.text-error',
  );
  if (errBox) {
    setText(
      errBox,
      detail.error_summary ||
        detail.error_type ||
        'No error summary stored for this investigation.',
    );
  }

  // Evidence panel — stack / terminal (not fake sha256 AST hash)
  const evidenceBoxes = pane.querySelectorAll(
    '.p-space-sm.rounded.bg-surface-container .bg-surface-container-lowest',
  );
  if (evidenceBoxes[1]) {
    const stack = (detail.stack_trace || detail.terminal_output || '').trim();
    setText(
      evidenceBoxes[1],
      stack
        ? stack.slice(0, 280)
        : `${tag} · no stack/terminal stored`,
    );
    evidenceBoxes[1].classList.remove('text-secondary');
    evidenceBoxes[1].classList.add('text-on-surface-variant', 'whitespace-pre-wrap');
  }

  const callsite = Array.from(pane.querySelectorAll('span')).find((el) =>
    /Callsite Node:|File:/i.test(el.textContent || ''),
  );
  if (callsite) {
    callsite.innerHTML = `File: <code class="text-on-surface font-mono">${esc(detail.file_name || '—')}</code>`;
  }
  const scope = Array.from(pane.querySelectorAll('span')).find((el) =>
    /Scope:|Lang:/i.test(el.textContent || ''),
  );
  if (scope) {
    scope.innerHTML = `Lang: <code class="text-on-surface font-mono">${esc(detail.language || '—')}</code>`;
  }
  const tokens = Array.from(pane.querySelectorAll('span')).find((el) =>
    /Normalized Tokens:|Lines:/i.test(el.textContent || ''),
  );
  if (tokens) {
    const n = String(detail.code_snippet || '')
      .split(/\n/)
      .filter((l) => l.trim()).length;
    tokens.innerHTML = `Code lines: <span class="text-primary font-mono">${n || '—'}</span>`;
  }
  const structure = Array.from(pane.querySelectorAll('span')).find((el) =>
    /Structure:|Source:/i.test(el.textContent || ''),
  );
  if (structure) {
    structure.innerHTML = `Reasoning: <span class="text-on-surface font-mono">${esc(reasoningLabel(detail.reasoning_source))}</span>`;
  }

  // Root cause — plain text, no HYPOTHESIS wording
  const rootCauseH = Array.from(pane.querySelectorAll('h2')).find((el) =>
    /Root Cause & Reasoning|Stored Root Cause/i.test(el.textContent || ''),
  );
  const rootBlock = rootCauseH?.closest('.flex.flex-col.gap-space-xs');
  const rootP = rootBlock?.querySelector('p');
  if (rootP) {
    setText(rootP, detail.root_cause || detail.explanation || 'No root-cause text stored.');
  }
  const remTitle = Array.from(pane.querySelectorAll('span')).find((el) =>
    /Suggestion source|Engine Remediation/i.test(el.textContent || ''),
  );
  const remDetail = remTitle?.parentElement?.querySelector('.text-on-surface-variant, span:last-child');
  if (remDetail && remTitle?.parentElement) {
    const note =
      detail.reasoning_note ||
      detail.suggested_correction?.summary ||
      `${reasoningLabel(detail.reasoning_source)}`;
    setText(remDetail, note);
  }

  const fixSection = Array.from(pane.querySelectorAll('h2')).find((el) =>
    /Suggested Fix|Verified Fix/i.test(el.textContent || ''),
  );
  const fixWrap = fixSection?.closest('.flex.flex-col.gap-space-xs');

  // File chip beside section title — never overwrite "03 //"
  restoreSectionMarkers(pane);
  if (fixWrap) {
    const fileChip = Array.from(fixWrap.querySelectorAll('span')).find((el) => {
      const t = (el.textContent || '').trim();
      if (/^\d{2}\s*\/\//.test(t)) return false;
      return /guard_template|untitled|buffer|\.py$|\.js$|\.ts$|\.jsx$|\.tsx$/i.test(t);
    });
    if (fileChip) setText(fileChip, detail.file_name || 'buffer');
  }

  const langLabel = fixWrap?.querySelector('.font-label-sm.text-tertiary');
  if (langLabel) setText(langLabel, `${detail.language || 'code'} · Verified`);

  // Editor chrome path
  Array.from(fixWrap?.querySelectorAll('span') || []).forEach((el) => {
    const t = (el.textContent || '').trim();
    if (/services\/pipeline|guard_template|Editor buffer/i.test(t)) {
      setText(el, detail.file_name || 'untitled');
    }
  });

  const pre = pane.querySelector('pre');
  const patch =
    detail.suggested_correction?.corrected_code ||
    detail.suggested_correction?.diff_unified ||
    '';
  if (pre) {
    const header = `# source: ${reasoningLabel(detail.reasoning_source)}\n\n`;
    pre.textContent = patch
      ? header + patch
      : `${header}# No suggested fix stored for this investigation.`;
    pre.className =
      'p-space-md font-code-body text-code-body text-on-surface overflow-x-auto leading-relaxed select-text whitespace-pre-wrap';
  }

  restoreSectionMarkers(pane);

  // Analysis-style live panels (fault banner, timeline, RCA, diff)
  mountLiveInvestigationPanel(pane, detail);
}

/**
 * Inject banner + timeline + root-cause + patch into the Memory detail column.
 * Hides the old stitch 01/02/03 body so the Analysis cards are primary.
 */
function mountLiveInvestigationPanel(pane, detail) {
  if (!pane) return;

  // Hide original numbered sections (kept in DOM for layout shell / header)
  pane.querySelectorAll('h2').forEach((h2) => {
    const t = (h2.textContent || '').trim();
    if (!/Current Error|Root Cause|Suggested Fix|Verified Fix|Canonical|Stored Root/i.test(t)) {
      return;
    }
    const block = h2.closest('.flex.flex-col.gap-space-xs, .flex.flex-col.gap-space-sm');
    if (block) block.style.display = 'none';
  });

  let host = pane.querySelector('[data-eyra-memory-live]');
  if (!host) {
    host = document.createElement('div');
    host.setAttribute('data-eyra-memory-live', '1');
    host.className = 'flex flex-col gap-space-sm mt-space-sm';
    // Prefer after the compact header card
    const headerCard = pane.querySelector('.bg-surface-container-lowest.rounded.p-space-lg');
    if (headerCard) {
      headerCard.after(host);
      // Keep header, hide remaining stitch body inside the big card
      Array.from(headerCard.children).forEach((child, i) => {
        if (i === 0) return; // keep title/actions row
        child.style.display = 'none';
      });
    } else {
      pane.appendChild(host);
    }
  }
  host.innerHTML = buildMemoryInvestigationHtml(detail);
}

function hydrateMemoryCards(root, items) {
  if (!root) return;
  hideMemoryMocks(root);
  applyHonestLabels(root);
  applyStackedHorizontalLayout(root);

  const patternsHeader = Array.from(root.querySelectorAll('span')).find((el) =>
    /Similar Past Investigations|Runtime Debugging Patterns/i.test(el.textContent || ''),
  );
  const countBadge = patternsHeader
    ?.closest('.flex.items-center.justify-between')
    ?.querySelector('.font-code-compact');
  if (countBadge) setText(countBadge, String(items?.length || 0));

  if (!items?.length) {
    showEmptyInCards(root, 'No saved investigations yet');
    return;
  }

  const targets = ensureCardSlots(root, items.length);

  items.forEach((item, i) => {
    const card = targets[i];
    if (!card) return;
    card.style.display = '';
    styleHorizontalCard(card);
    card.dataset.sessionId = item.session_id;
    card.dataset.errorType = item.error_type || '';
    card.dataset.listIndex = String(i);

    // Rebuild card body as a compact horizontal card
    card.innerHTML = `
<div data-eyra-sel-bar class="absolute left-0 top-0 bottom-0 w-1 bg-transparent rounded-l"></div>
<div class="flex flex-col gap-2 w-full min-w-0 pl-1">
  <div class="flex items-start justify-between gap-2">
    <div class="flex flex-col gap-0.5 min-w-0">
      <span class="font-code-compact text-code-compact text-primary font-semibold">${esc(seqTag(i))}</span>
      <span class="font-headline-sm text-headline-sm font-semibold text-on-surface truncate">${esc(item.error_type || 'Session')}</span>
    </div>
    <span class="shrink-0 font-label-sm text-label-sm px-2 py-0.5 rounded bg-tertiary-container/20 text-tertiary font-semibold uppercase">VERIFIED</span>
  </div>
  <p class="font-body-sm text-body-sm text-on-surface-variant line-clamp-2">${esc(item.error_summary || item.root_cause || 'No summary stored.')}</p>
  <div class="flex items-center justify-between gap-2 mt-1">
    <div class="flex items-center gap-2 flex-wrap min-w-0 font-code-compact text-code-compact">
      ${item.created_at ? `<span class="text-on-surface-variant font-mono">${esc(relativeTime(item.created_at))}</span>` : ''}
      ${item.same_error_count != null ? `<span class="text-primary font-mono">${esc(item.same_error_count)} same error type</span>` : ''}
      ${item.reasoning_source ? `<span class="text-outline">${esc(reasoningLabel(item.reasoning_source))}</span>` : ''}
    </div>
    <span class="font-code-compact text-code-compact text-on-surface-variant shrink-0">${esc(item.project_name || item.file_name || '—')}</span>
  </div>
</div>`;
  });

  for (let i = items.length; i < targets.length; i += 1) {
    targets[i].style.display = 'none';
  }
}

function paintMemoryIdle(root) {
  if (!root) return;
  scrubCommonDemoLabels(root);
  applyHonestLabels(root);
  showEmptyInCards(root, 'Loading memory…');
}

export function MemoryPage() {
  const navigate = useNavigate();
  const { adoptResult, showToast } = useEyra();
  const hostRef = useRef(null);
  const itemsRef = useRef([]);
  const selectedRef = useRef(null);
  const detailCache = useRef(new Map());
  const scrubIdle = useCallback((root) => paintMemoryIdle(root), []);
  const { reveal, hold, gateClassName, gateProps } = useStitchGate(hostRef, {
    scrub: scrubIdle,
  });

  async function selectSession(sessionId, { toast = true } = {}) {
    const root = hostRef.current?.querySelector('.stitch-screen') || hostRef.current;
    if (!root || !sessionId) return;
    try {
      let detail = detailCache.current.get(sessionId);
      if (!detail) {
        detail = await api.historyDetail(sessionId);
        detailCache.current.set(sessionId, detail);
      }

      const listIndex = Math.max(
        0,
        itemsRef.current.findIndex((x) => x.session_id === sessionId),
      );
      const listItem = itemsRef.current[listIndex];
      if (
        listItem?.error_type &&
        detail.error_type &&
        listItem.error_type !== detail.error_type
      ) {
        showToast?.(
          `Inconsistent record flagged: list=${listItem.error_type} detail=${detail.error_type}`,
          'error',
        );
      }

      selectedRef.current = sessionId;
      markSelectedCard(root, sessionId);
      applyHonestLabels(root);
      hydrateDetailPane(root, detail, listIndex);
      adoptResult?.(detail);
      if (toast) showToast?.(`Showing ${seqTag(listIndex)}`, 'info');
    } catch (err) {
      showToast?.(err.message || 'Load failed', 'error');
    }
  }

  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    let timer = 0;
    hold();

    const apply = async (items) => {
      const root = hostRef.current?.querySelector('.stitch-screen') || hostRef.current;
      if (!root) {
        if (tries >= 40) {
          if (!cancelled) reveal();
          return;
        }
        tries += 1;
        timer = window.setTimeout(() => apply(items), 50);
        return;
      }
      hydrateMemoryCards(root, items);
      if (items?.[0]?.session_id) {
        await selectSession(items[0].session_id, { toast: false });
      }
      if (!cancelled) reveal();
    };

    (async () => {
      try {
        const data = await api.memory({ limit: 50 });
        if (cancelled) return;
        itemsRef.current = data.items || [];
        await apply(itemsRef.current);
      } catch {
        if (cancelled) return;
        await apply([]);
        const root = hostRef.current?.querySelector('.stitch-screen') || hostRef.current;
        if (root) showEmptyInCards(root, 'Brain offline');
        if (!cancelled) reveal();
      }
    })();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hold, reveal]);

  return (
    <div
      ref={hostRef}
      className={gateClassName}
      {...gateProps}
      onClick={async (e) => {
        const openWs = e.target.closest('[data-eyra-open-workspace]');
        if (openWs) {
          e.preventDefault();
          e.stopPropagation();
          const sid = selectedRef.current;
          const detail = sid ? detailCache.current.get(sid) : null;
          if (detail) adoptResult?.(detail);
          navigate('/workspace');
          return;
        }

        const copyPatch = e.target.closest('[data-eyra-copy-patch]');
        const applyPatch = e.target.closest('[data-eyra-apply-patch]');
        if (copyPatch || applyPatch) {
          e.preventDefault();
          e.stopPropagation();
          const sid =
            selectedRef.current ||
            hostRef.current?.querySelector('.lg\\:col-span-7')?.dataset?.sessionId;
          try {
            let detail = sid ? detailCache.current.get(sid) : null;
            if (!detail && sid) {
              detail = await api.historyDetail(sid);
              detailCache.current.set(sid, detail);
            }
            const patch = getSessionPatchText(detail);
            if (!patch) {
              showToast?.('No suggested patch stored for this session', 'error');
              return;
            }
            if (copyPatch) {
              await navigator.clipboard.writeText(patch);
              showToast?.('Patch copied (not applied to repo)', 'info');
              return;
            }
            // Apply → adopt into context and open workspace for review/copy
            adoptResult?.(detail);
            await navigator.clipboard.writeText(
              detail?.suggested_correction?.corrected_code || patch,
            );
            showToast?.('Patch ready — opened Debugging Workspace', 'info');
            navigate('/workspace');
          } catch {
            showToast?.('Could not prepare patch', 'error');
          }
          return;
        }

        const el = e.target.closest('button, a, [data-session-id]');
        if (!el) return;
        const text = (el.textContent || '').trim();

        if (text.includes('Copy Fix') || el.id === 'copy-solution-btn') {
          e.preventDefault();
          e.stopPropagation();
          const sid =
            selectedRef.current ||
            hostRef.current?.querySelector('.lg\\:col-span-7')?.dataset?.sessionId ||
            itemsRef.current[0]?.session_id;
          try {
            let detail = sid ? detailCache.current.get(sid) : null;
            if (!detail && sid) {
              detail = await api.historyDetail(sid);
              detailCache.current.set(sid, detail);
            }
            const patch = getSessionPatchText(detail);
            if (!patch) {
              showToast?.('No suggested fix stored for this session', 'error');
              return;
            }
            await navigator.clipboard.writeText(patch);
            showToast?.('Suggested fix copied (not applied to repo)', 'info');
          } catch {
            showToast?.('Clipboard blocked', 'error');
          }
          return;
        }

        const card = e.target.closest('[data-session-id]');
        if (card?.dataset?.sessionId && !e.target.closest('button')) {
          e.preventDefault();
          await selectSession(card.dataset.sessionId);
        }
      }}
    >
      <MemoryStitch />
    </div>
  );
}
