import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import { useEyra } from '../../context/EyraContext';
import { useStitchGate } from '../../hooks/useStitchGate.js';
import { AUDIT_LANGUAGES } from '../../lib/auditLanguages.js';
import { replaceSubstring, setText } from '../../lib/hydrateStitch.js';
import AuditIngestStitch from '../stitch_raw/audit/AuditIngestPage.jsx';

const MAX_ZIP_BYTES = 50 * 1024 * 1024;
const PENDING_KEY = 'eyra.pendingIngest';
const PENDING_CLEARED_KEY = 'eyra.pendingCleared';
const LANG_KEY = 'eyra.selectedLanguages';

const TAB_ACTIVE =
  'flex items-center gap-space-xs px-space-md py-space-xs rounded-lg bg-primary-container text-on-primary-container font-headline-sm text-headline-sm shadow-sm transition-all';
const TAB_IDLE =
  'flex items-center gap-space-xs px-space-md py-space-xs rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all';

/** Platform-supported languages shown in the Language & Framework filter. */
const SUPPORTED_LANGUAGES = AUDIT_LANGUAGES;
function loadSelectedLanguages() {
  try {
    const raw = sessionStorage.getItem(LANG_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveSelectedLanguages(ids) {
  try {
    sessionStorage.setItem(LANG_KEY, JSON.stringify(ids));
  } catch {
    /* ignore */
  }
}

function languageSummaryLabel(ids) {
  if (!ids?.length) return null;
  return ids.join(' + ');
}

/** Locate the Language & Framework value span via tune row (not mock Python text). */
function findLanguageDisplaySpan(root) {
  if (!root) return null;
  const tagged = root.querySelector('[data-eyra-lang-display]');
  if (tagged) return tagged;

  const tuneIcon = [...root.querySelectorAll('.material-symbols-outlined')].find(
    (ic) => (ic.textContent || '').trim() === 'tune',
  );
  const row =
    tuneIcon?.closest('button')?.parentElement ||
    tuneIcon?.closest('.flex.items-center.justify-between') ||
    null;
  if (row) {
    const valueSpan = [...row.querySelectorAll(':scope > div span, :scope span')].find((s) => {
      if (s.classList.contains('material-symbols-outlined')) return false;
      if (s.classList.contains('w-2.5') || /rounded-full/.test(s.className || '')) return false;
      const t = (s.textContent || '').trim();
      return t.length > 0 && t.length < 160 && !/Auto-detected|Manual select|LANGUAGE/i.test(t);
    });
    if (valueSpan) {
      valueSpan.setAttribute('data-eyra-lang-display', '1');
      return valueSpan;
    }
  }
  return null;
}

function findAutoDetectBadge(root) {
  const langLabel = [...root.querySelectorAll('span')].find((el) => {
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    return t === 'LANGUAGE & FRAMEWORK' || /^LANGUAGE\s*&\s*FRAMEWORK$/i.test(t);
  });
  const row = langLabel?.closest('label') || langLabel?.parentElement;
  return (
    [...(row?.querySelectorAll('span') || [])].find(
      (el) =>
        el.querySelector?.('.material-symbols-outlined') &&
        /Auto-detected|Manual select/i.test(el.textContent || ''),
    ) || null
  );
}

function findStackDetectedSpan(root) {
  if (!root) return null;
  const tagged = root.querySelector('[data-eyra-stack-display]');
  if (tagged) return tagged;
  const label = [...root.querySelectorAll('span')].find(
    (el) => (el.textContent || '').trim() === 'Stack Detected',
  );
  const value =
    label?.parentElement?.querySelector('.font-headline-md, .text-headline-md, .font-mono') || null;
  if (value) value.setAttribute('data-eyra-stack-display', '1');
  return value;
}

/** Force-update Language & Framework row (+ archive Stack when a selection exists). */
function updateLanguageDisplay(root, langIds, { manual = true } = {}) {
  if (!root) return;
  const summary = langIds?.length ? languageSummaryLabel(langIds) : 'Auto-detect on ingest';

  const span = findLanguageDisplaySpan(root);
  if (span) {
    span.setAttribute('data-eyra-lang-display', '1');
    span.textContent = summary;
  }

  const stack = findStackDetectedSpan(root);
  if (stack) {
    stack.setAttribute('data-eyra-stack-display', '1');
    const archiveName = root.querySelector('[data-eyra-archive-name]')?.textContent || '';
    const idleArchive =
      !archiveName || /No file here|No repo indexed/i.test(archiveName.trim());
    const liveStack = stack.dataset.eyraStackLive === '1';
    // Stack Detected is ingest-only — Language & Framework filter must never rewrite it
    if (idleArchive && !liveStack) stack.textContent = '—';
  }

  const badge = findAutoDetectBadge(root);
  if (badge) {
    badge.innerHTML = `<span class="material-symbols-outlined text-[12px]">auto_awesome</span> ${
      manual && langIds?.length ? 'Manual select' : 'Auto-detected'
    }`;
  }
}

function LanguagePicker({ open, selected, onToggle, onApply, onClose, onReset }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-space-md">
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-surface-container-low shadow-xl"
        role="dialog"
        aria-label="Supported languages"
      >
        <div className="flex items-center justify-between border-b border-outline-variant/20 px-space-lg py-space-md">
          <div>
            <h2 className="font-headline-md text-headline-md font-semibold text-on-surface">
              Language &amp; Framework filter
            </h2>
            <p className="mt-space-2xs font-body-sm text-body-sm text-on-surface-variant">
              Check only the languages you want (e.g. Java alone). Core: Python, Java, JavaScript.
            </p>
          </div>
          <button
            type="button"
            className="rounded p-1 text-outline hover:bg-surface-container hover:text-on-surface"
            onClick={onClose}
            aria-label="Close"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>
        <div className="flex-1 space-y-space-xs overflow-y-auto p-space-md">
          {SUPPORTED_LANGUAGES.map((lang) => {
            const checked = selected.includes(lang.id);
            return (
              <label
                key={lang.id}
                className={`flex cursor-pointer items-start gap-space-md rounded-lg border p-space-md transition-colors ${
                  checked
                    ? 'border-primary/40 bg-primary/5'
                    : 'border-outline-variant/20 bg-surface-container-lowest hover:border-outline-variant/40'
                }`}
              >
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 accent-primary"
                  checked={checked}
                  onChange={() => onToggle(lang.id)}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-space-xs">
                    <span className="font-body-md text-body-md font-semibold text-on-surface">{lang.label}</span>
                    {lang.core ? (
                      <span className="rounded bg-primary-container/30 px-space-xs py-px font-label-sm text-label-sm text-primary">
                        CORE
                      </span>
                    ) : (
                      <span className="rounded bg-surface-container px-space-xs py-px font-label-sm text-label-sm text-on-surface-variant">
                        SUPPORTED
                      </span>
                    )}
                    <span className="font-code-compact text-code-compact text-outline">{lang.extensions}</span>
                  </div>
                  <p className="mt-space-2xs font-code-compact text-code-compact text-on-surface-variant">
                    Syntax: {lang.syntax}
                  </p>
                  <p className="mt-px font-body-sm text-body-sm text-on-surface-variant">
                    {lang.features}
                  </p>
                </div>
              </label>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-space-sm border-t border-outline-variant/20 px-space-lg py-space-md">
          <button
            type="button"
            className="font-body-sm text-body-sm text-on-surface-variant hover:text-on-surface"
            onClick={onReset}
          >
            Use auto-detect
          </button>
          <div className="flex gap-space-sm">
            <button
              type="button"
              className="rounded px-space-md py-space-2xs font-body-sm text-body-sm text-on-surface-variant hover:bg-surface-container"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rounded bg-primary-container px-space-md py-space-2xs font-body-sm font-semibold text-on-primary-container"
              onClick={onApply}
            >
              Apply ({selected.length})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function findGithubPanel(host) {
  const tagged = host.querySelector('[data-eyra-github-panel]');
  if (tagged) return tagged;

  // Prefer unique internals — never the tab button labeled "GitHub Repository"
  const bySelect = host
    .querySelector('select[data-eyra-gh-branch]')
    ?.closest('.rounded-xl, [class*="rounded"]');
  if (bySelect && !bySelect.id?.startsWith('tab-')) {
    bySelect.setAttribute('data-eyra-github-panel', '1');
    return bySelect;
  }

  const title = [...host.querySelectorAll('span, h2, h3')].find((el) => {
    const t = el.textContent || '';
    if (/Remote Ingestion Alternative/i.test(t)) return true;
    // Laid-out title only (not the nav tab)
    if (/^GitHub Repository$/i.test(t.trim()) && !el.closest('#tab-btn-github, button')) {
      return true;
    }
    return false;
  });
  const card = title?.closest('.rounded-xl, [class*="rounded"]') || null;
  if (card && !card.closest('#tab-btn-github')) {
    card.setAttribute('data-eyra-github-panel', '1');
    return card;
  }
  return null;
}

/** ZIP drop + side preview grid inside #tab-content-upload (not Scan Configuration). */
function findZipDropGrid(host) {
  const panel = host.querySelector('#tab-content-upload');
  if (!panel) return null;
  return (
    panel.querySelector(':scope > .grid') ||
    panel.querySelector('.grid.grid-cols-1.lg\\:grid-cols-12') ||
    null
  );
}

/** Drop-zone column only (keep archive preview visible on GitHub tab). */
function findZipDropColumn(host) {
  const tagged = host.querySelector('[data-eyra-zip-drop]');
  if (tagged) {
    return tagged.closest('.lg\\:col-span-7, [class*="col-span-7"]') || tagged;
  }
  const input = host.querySelector('#file-upload-input');
  return input?.closest('.lg\\:col-span-7, [class*="col-span-7"]') || input?.closest('.rounded-xl') || null;
}

function findArchivePreviewCard(host) {
  return host.querySelector('[data-eyra-archive-preview]');
}

/** Optional “never compiled / air-gapped” blurb above Scan Configuration. */
function findZipInfoBlurb(host) {
  const el = [...host.querySelectorAll('p, span')].find((node) =>
    /never compiled, linked, executed/i.test(node.textContent || ''),
  );
  return el?.closest('.rounded-xl, [class*="rounded"]') || null;
}

/** Prepare GitHub URL field for full links (hide https://github.com/ prefix). */
function prepareGithubInput(host) {
  const input =
    host.querySelector('input[placeholder*="organization/repository"]') ||
    host.querySelector('input[placeholder*="github.com"]') ||
    host.querySelector('input[placeholder*="Paste"]');
  if (!input) return null;
  input.removeAttribute('readonly');
  input.classList.remove('cursor-pointer');
  input.placeholder = 'https://github.com/org/repo';
  if (!input.value || input.value === 'organization/repository') {
    input.value = '';
  }
  // Stitch shows a fixed "https://github.com/" prefix — hide it for full-URL paste
  const prefix = [...(input.parentElement?.querySelectorAll('span') || [])].find((el) =>
    /https?:\/\/github\.com\//i.test((el.textContent || '').trim()),
  );
  if (prefix) prefix.style.display = 'none';
  return input;
}

/**
 * Restack GitHub card: URL → branch → Configure (fills left column like ZIP drop).
 * Stitch ships a cramped 12-col row with empty vertical space.
 */
/** Short label for long agent/CI branch names (keep full value for clone). */
function branchDisplayName(name) {
  const raw = String(name || '').trim();
  if (!raw) return 'main';
  // cursor/fix-foo-1a33 → fix-foo
  const cursor = raw.match(/^cursor\/([a-z0-9-]+?)(?:-[a-f0-9]{4,})?$/i);
  if (cursor) return cursor[1].replace(/-/g, ' ');
  if (raw.length > 36) return `${raw.slice(0, 18)}…${raw.slice(-10)}`;
  return raw;
}

/**
 * Custom dark-theme branch picker (native <select> option lists are often
 * white-on-white / unreadable in this app theme).
 */
function ensureGithubBranchSelect(branchCol) {
  if (!branchCol) return null;
  branchCol.setAttribute('data-eyra-gh-branch-wrap', '1');
  branchCol.style.position = 'relative';

  let select = branchCol.querySelector('select[data-eyra-gh-branch]');
  let btn = branchCol.querySelector('[data-eyra-gh-branch-btn]');
  let menu = branchCol.querySelector('[data-eyra-gh-branch-menu]');
  const oldInput = branchCol.querySelector('input:not([type="hidden"])');

  if (!select) {
    select = document.createElement('select');
    select.dataset.eyraGhBranch = '1';
    select.setAttribute('aria-hidden', 'true');
    select.tabIndex = -1;
    select.style.cssText =
      'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);border:0;';
    const opt = document.createElement('option');
    opt.value = 'main';
    opt.textContent = 'main';
    select.appendChild(opt);
  }

  if (!btn) {
    btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.eyraGhBranchBtn = '1';
    btn.className =
      'flex min-w-0 flex-1 items-center gap-2 bg-transparent font-code-body text-code-body text-on-surface outline-none';
    btn.innerHTML =
      '<span class="material-symbols-outlined text-[16px] text-outline shrink-0">fork_right</span>' +
      '<span data-eyra-gh-branch-label class="min-w-0 flex-1 truncate text-left">main</span>' +
      '<span class="material-symbols-outlined text-[16px] text-outline shrink-0">expand_more</span>';
  }

  if (!menu) {
    menu = document.createElement('ul');
    menu.dataset.eyraGhBranchMenu = '1';
    menu.className =
      'absolute left-0 right-0 top-[calc(100%+4px)] z-50 hidden max-h-56 overflow-auto rounded-lg border border-outline-variant/40 bg-surface-container-high py-1 shadow-xl';
    menu.setAttribute('role', 'listbox');
  }

  // Rebuild column content once
  if (branchCol.dataset.eyraGhPicker !== '1' || !branchCol.contains(btn)) {
    branchCol.dataset.eyraGhPicker = '1';
    if (oldInput) oldInput.remove();
    [...branchCol.children].forEach((el) => {
      if (
        el.matches?.(
          'select[data-eyra-gh-branch], [data-eyra-gh-branch-btn], [data-eyra-gh-branch-menu], input, .material-symbols-outlined',
        )
      ) {
        el.remove();
      }
    });
    branchCol.appendChild(btn);
    branchCol.appendChild(select);
    branchCol.appendChild(menu);
  }

  if (!branchCol.parentElement?.querySelector('[data-eyra-gh-branch-status]')) {
    const status = document.createElement('span');
    status.dataset.eyraGhBranchStatus = '1';
    status.className = 'font-code-compact text-code-compact text-outline block mt-space-2xs';
    status.textContent = 'Branches auto-detect when you paste a repo URL';
    branchCol.after(status);
  }

  const syncLabel = () => {
    const label = btn.querySelector('[data-eyra-gh-branch-label]');
    const name = select.value || 'main';
    const isDefault = select.selectedOptions?.[0]?.dataset?.default === '1';
    if (label) {
      label.textContent = isDefault ? `${branchDisplayName(name)} · default` : branchDisplayName(name);
      label.title = name;
    }
  };

  const closeMenu = () => {
    menu.classList.add('hidden');
    btn.setAttribute('aria-expanded', 'false');
  };

  const openMenu = () => {
    menu.classList.remove('hidden');
    btn.setAttribute('aria-expanded', 'true');
  };

  if (btn.dataset.eyraWired !== '1') {
    btn.dataset.eyraWired = '1';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (menu.classList.contains('hidden')) openMenu();
      else closeMenu();
    });
    document.addEventListener('click', (e) => {
      if (!branchCol.contains(e.target)) closeMenu();
    });
  }

  select._eyraSyncBranchUi = syncLabel;
  select._eyraCloseBranchMenu = closeMenu;
  syncLabel();
  return select;
}

function layoutGithubPanel(panel) {
  if (!panel) return;
  const already = panel.dataset.eyraGithubLayout === '1';
  if (!already) panel.dataset.eyraGithubLayout = '1';

  // Shorten verbose stitch title
  const title = [...panel.querySelectorAll('span')].find((el) =>
    /Remote Ingestion Alternative/i.test(el.textContent || ''),
  );
  if (title && /Remote Ingestion/i.test(title.textContent || '')) {
    title.textContent = 'GitHub Repository';
    title.setAttribute('data-eyra-github-title', '1');
  }
  panel.setAttribute('data-eyra-github-panel', '1');

  const formGrid =
    panel.querySelector('[data-eyra-gh-form]') ||
    [...panel.querySelectorAll('.grid, [class*="grid-cols"], .flex.flex-col')].find((g) =>
      g.querySelector('input[type="text"], select[data-eyra-gh-branch]'),
    );
  if (!formGrid) return;
  formGrid.dataset.eyraGhForm = '1';

  Object.assign(panel.style, {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'flex-start',
    gap: '1.25rem',
    minHeight: '22rem',
    height: '100%',
    padding: '1.5rem',
  });
  if (!already) {
    formGrid.className = 'flex flex-col gap-space-md w-full flex-1';
    formGrid.style.opacity = '1';
  }

  const cols = [...formGrid.children];
  const urlCol = cols.find((c) =>
    c.querySelector(
      'input[placeholder*="github"], input[placeholder*="organization"], input[placeholder*="Paste"]',
    ),
  );
  const branchCol =
    formGrid.querySelector('[data-eyra-gh-branch-wrap]') ||
    cols.find((c) => {
      if (c.querySelector('select[data-eyra-gh-branch]')) return true;
      const inp = c.querySelector('input[type="text"]');
      return (
        inp &&
        inp !== urlCol?.querySelector('input') &&
        (inp.value === 'main' || /fork_right/i.test(c.textContent || ''))
      );
    });
  const btnCol = cols.find((c) => c.querySelector('button'));

  const styleField = (el, { grow = false } = {}) => {
    if (!el) return;
    el.className =
      'flex w-full items-center rounded-lg bg-surface-container-lowest px-space-md py-space-sm';
    el.style.width = '100%';
    el.style.minHeight = grow ? '3.25rem' : '2.75rem';
  };

  const ensureLabel = (beforeEl, text) => {
    if (!beforeEl || beforeEl.previousElementSibling?.dataset?.eyraGhLabel === text) return;
    const lab = document.createElement('span');
    lab.dataset.eyraGhLabel = text;
    lab.className =
      'font-label-sm text-label-sm uppercase tracking-wider text-outline mb-space-2xs block';
    lab.textContent = text;
    beforeEl.parentElement?.insertBefore(lab, beforeEl);
  };

  if (urlCol) {
    styleField(urlCol, { grow: true });
    ensureLabel(urlCol, 'Repository URL');
    const urlInput = urlCol.querySelector('input');
    if (urlInput) {
      urlInput.classList.add('w-full', 'text-on-surface');
      urlInput.style.fontSize = '0.95rem';
    }
  }

  if (branchCol) {
    styleField(branchCol);
    ensureLabel(branchCol, 'Branch');
    ensureGithubBranchSelect(branchCol);
  }

  if (btnCol) {
    btnCol.className = 'flex w-full mt-space-xs';
    btnCol.style.width = '100%';
    const btn = btnCol.querySelector('button');
    if (btn) {
      btn.className =
        'w-full flex items-center justify-center gap-space-xs py-space-sm px-space-md rounded-lg bg-primary-container text-on-primary-container font-headline-sm text-headline-sm font-semibold hover:brightness-110 active:scale-[0.98] transition-all shadow-sm';
      btn.style.minHeight = '2.75rem';
      if (!btn.querySelector('.material-symbols-outlined')) {
        const ic = document.createElement('span');
        ic.className = 'material-symbols-outlined text-[18px]';
        ic.textContent = 'cloud_download';
        btn.prepend(ic);
      }
      btn.setAttribute('data-eyra-gh-configure', '1');
      if (!btn.querySelector('[data-eyra-gh-cta]')) {
        [...btn.childNodes]
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .forEach((n) => {
            n.textContent = '';
          });
        const textSpan = document.createElement('span');
        textSpan.dataset.eyraGhCta = '1';
        textSpan.textContent = 'Configure & Index Repository';
        btn.appendChild(textSpan);
      }
    }
  }

  if (!already) {
    const frag = document.createDocumentFragment();
    const urlLab =
      urlCol?.previousElementSibling?.dataset?.eyraGhLabel === 'Repository URL'
        ? urlCol.previousElementSibling
        : null;
    const branchLab =
      branchCol?.previousElementSibling?.dataset?.eyraGhLabel === 'Branch'
        ? branchCol.previousElementSibling
        : null;
    if (urlLab) frag.appendChild(urlLab);
    if (urlCol) frag.appendChild(urlCol);
    if (branchLab) frag.appendChild(branchLab);
    if (branchCol) frag.appendChild(branchCol);
    const statusEl = formGrid.querySelector('[data-eyra-gh-branch-status]');
    if (statusEl) frag.appendChild(statusEl);
    if (btnCol) frag.appendChild(btnCol);
    formGrid.appendChild(frag);
  }

  if (!panel.querySelector('[data-eyra-gh-hint]')) {
    const hint = document.createElement('p');
    hint.dataset.eyraGhHint = '1';
    hint.className = 'font-body-sm text-body-sm text-on-surface-variant mt-auto pt-space-md';
    hint.textContent =
      'Paste a public repo URL — branches load automatically. Pick one if there are several, then Configure.';
    panel.appendChild(hint);
  }
}

/** Parse owner/repo from a GitHub URL or shorthand. */
function parseGithubOwnerRepo(raw) {
  let s = String(raw || '').trim();
  if (!s || s === 'organization/repository') return null;
  s = s.replace(/^https?:\/\/github\.com\/https?:\/\/github\.com\//i, 'https://github.com/');
  s = s.replace(/^https?:\/\/(www\.)?github\.com\//i, '');
  s = s.replace(/^github\.com\//i, '');
  s = s.replace(/\.git$/i, '').replace(/\/+$/, '');
  const parts = s.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0];
  const repo = parts[1];
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) return null;
  return { owner, repo };
}

/**
 * Wire URL → GitHub branch dropdown (auto-detect; multi-branch select).
 * @param {HTMLElement} panel
 * @param {(msg: string, kind?: string) => void} [showToast]
 */
function wireGithubBranchDetection(panel, showToast) {
  if (!panel || panel.dataset.eyraGhBranchWired === '1') return;
  panel.dataset.eyraGhBranchWired = '1';

  const urlInput =
    panel.querySelector('input[placeholder*="github"]') ||
    panel.querySelector('input[placeholder*="organization"]') ||
    panel.querySelector('input[placeholder*="Paste"]');
  const select = panel.querySelector('select[data-eyra-gh-branch]');
  const statusEl = panel.querySelector('[data-eyra-gh-branch-status]');
  if (!urlInput || !select) return;

  let timer = 0;
  let lastKey = '';
  let seq = 0;

  const setStatus = (text, tone = 'muted') => {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.className =
      tone === 'error'
        ? 'font-code-compact text-code-compact text-error block mt-space-2xs'
        : tone === 'ok'
          ? 'font-code-compact text-code-compact text-tertiary block mt-space-2xs'
          : 'font-code-compact text-code-compact text-outline block mt-space-2xs';
  };

  const fillBranches = (branches, defaultBranch) => {
    const prev = select.value;
    const menu = panel.querySelector('[data-eyra-gh-branch-menu]');
    const list = branches.length ? branches : [defaultBranch || 'main'];
    select.replaceChildren();
    if (menu) menu.replaceChildren();

    const pickBranch = (name) => {
      select.value = name;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      select._eyraSyncBranchUi?.();
      select._eyraCloseBranchMenu?.();
      // Highlight selected row
      menu?.querySelectorAll('[data-eyra-gh-branch-item]').forEach((li) => {
        const on = li.dataset.value === name;
        li.className = on
          ? 'flex cursor-pointer items-center justify-between gap-2 px-3 py-2 font-code-compact text-code-compact bg-primary-container/25 text-on-surface'
          : 'flex cursor-pointer items-center justify-between gap-2 px-3 py-2 font-code-compact text-code-compact text-on-surface hover:bg-surface-container';
      });
    };

    for (const name of list) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      if (defaultBranch && name === defaultBranch) opt.dataset.default = '1';
      select.appendChild(opt);

      if (menu) {
        const li = document.createElement('li');
        li.dataset.eyraGhBranchItem = '1';
        li.dataset.value = name;
        li.setAttribute('role', 'option');
        li.title = name;
        const isDefault = Boolean(defaultBranch && name === defaultBranch);
        li.innerHTML =
          `<span class="min-w-0 truncate">${branchDisplayName(name)}</span>` +
          (isDefault
            ? '<span class="shrink-0 rounded bg-primary/20 px-1.5 py-px font-label-sm text-[10px] text-primary">default</span>'
            : `<span class="shrink-0 font-label-sm text-[10px] text-outline truncate max-w-[40%]" title="${name}">${name.includes('/') ? name.split('/').slice(0, 1).join('/') + '/…' : ''}</span>`);
        li.className =
          'flex cursor-pointer items-center justify-between gap-2 px-3 py-2 font-code-compact text-code-compact text-on-surface hover:bg-surface-container';
        li.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          pickBranch(name);
        });
        menu.appendChild(li);
      }
    }

    const pick =
      (prev && list.includes(prev) && prev) ||
      (defaultBranch && list.includes(defaultBranch) && defaultBranch) ||
      list[0];
    select.disabled = false;
    pickBranch(pick);
    if (list.length > 1) {
      setStatus(`${list.length} branches — tap to switch`, 'ok');
    } else {
      setStatus(`Branch: ${branchDisplayName(pick)}`, 'ok');
    }
  };

  const detect = async () => {
    const parsed = parseGithubOwnerRepo(urlInput.value);
    if (!parsed) {
      setStatus('Paste a repo URL to detect branches');
      fillBranches(['main'], 'main');
      return;
    }
    const key = `${parsed.owner}/${parsed.repo}`;
    if (key === lastKey && select.options.length > 1) return;
    const mySeq = ++seq;
    setStatus('Detecting branches…');
    select.disabled = true;
    try {
      const { branches, defaultBranch } = await api.listGithubBranches(
        parsed.owner,
        parsed.repo,
      );
      if (mySeq !== seq) return;
      lastKey = key;
      fillBranches(branches, defaultBranch);
    } catch (err) {
      if (mySeq !== seq) return;
      lastKey = '';
      fillBranches(['main', 'master'], 'main');
      setStatus(err?.message || 'Could not list branches — pick main/master', 'error');
      // Toast only for hard failures (404 / rate limit), not transient network blips
      if (err?.status === 404 || err?.status === 403) {
        showToast?.(err.message, 'error');
      }
    }
  };

  const schedule = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(detect, 550);
  };

  urlInput.addEventListener('input', schedule);
  urlInput.addEventListener('change', schedule);
  urlInput.addEventListener('blur', () => {
    window.clearTimeout(timer);
    detect();
  });
  urlInput.addEventListener('paste', () => {
    window.setTimeout(detect, 50);
  });

  // If URL already filled (hydrate), detect once
  if (parseGithubOwnerRepo(urlInput.value)) {
    detect();
  }
}

function readGithubBranch(host) {
  const select = host?.querySelector?.('select[data-eyra-gh-branch]');
  const v = (select?.value || '').trim();
  return v || 'main';
}

/** Pin stitch CTA bar to viewport bottom (sticky scrolls away inside long page). */
function pinIngestActionBar(host) {
  if (!host) return;
  const cta = host.querySelector('#start-audit-cta');
  if (!cta) return;
  let bar =
    cta.closest('[data-eyra-ingest-footer]') ||
    cta.closest('.sticky') ||
    [...[cta.parentElement, cta.parentElement?.parentElement]].find(
      (el) => el && /ESTIMATED SCAN DURATION|SCAN DURATION/i.test(el.textContent || ''),
    );
  if (!bar) return;

  bar.setAttribute('data-eyra-ingest-footer', '1');
  bar.classList.remove('sticky', 'bottom-4');
  // Keep flex alignment so Cancel / Start stay vertically centered
  bar.classList.add('flex', 'items-center', 'justify-between');
  Object.assign(bar.style, {
    position: 'fixed',
    left: '15rem', // AppShell sidebar pl-60
    right: '0',
    bottom: '0',
    zIndex: '45',
    margin: '0',
    borderRadius: '0',
    paddingLeft: '1.5rem',
    paddingRight: '1.5rem',
    paddingTop: '0.85rem',
    paddingBottom: '0.85rem',
    minHeight: '3.75rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    boxSizing: 'border-box',
    boxShadow: '0 -8px 24px rgba(0,0,0,0.25)',
  });
  bar.dataset.eyraPinned = '1';

  const shell =
    host.querySelector('.stitch-screen > .flex.flex-col') ||
    host.querySelector('.stitch-screen > div') ||
    host.querySelector('.flex.flex-col.w-full') ||
    host;
  if (shell) {
    shell.dataset.eyraFooterPad = '1';
    shell.style.paddingBottom = '6.5rem';
  }
}

/**
 * Stitch markup calls window.switchTab(...) via inline onclick.
 * ZIP ↔ GitHub: same 7+5 grid — left source panel, right archive preview.
 */
function installSwitchTab(host, setSource, getInitialTab = () => 'upload', showToast) {
  const samplesBtn = host.querySelector('#tab-btn-samples');
  if (samplesBtn) samplesBtn.style.display = 'none';

  const apply = (tab) => {
    const next = tab === 'github' ? 'github' : 'upload';
    setSource(next);

    const uploadBtn = host.querySelector('#tab-btn-upload');
    const githubBtn = host.querySelector('#tab-btn-github');
    if (uploadBtn) uploadBtn.className = next === 'upload' ? TAB_ACTIVE : TAB_IDLE;
    if (githubBtn) githubBtn.className = next === 'github' ? TAB_ACTIVE : TAB_IDLE;

    const uploadPanel = host.querySelector('#tab-content-upload');
    if (uploadPanel) uploadPanel.style.display = '';

    const zipGrid = findZipDropGrid(host);
    const dropCol = findZipDropColumn(host);
    const preview = findArchivePreviewCard(host);
    const zipBlurb = findZipInfoBlurb(host);
    const githubPanel = findGithubPanel(host);

    if (zipGrid) zipGrid.style.display = '';
    if (zipBlurb) zipBlurb.style.display = next === 'upload' ? '' : 'none';

    if (preview) {
      preview.style.display = '';
      preview.classList.remove('lg:col-span-12');
      if (![...preview.classList].some((c) => /col-span-5/.test(c))) {
        preview.classList.add('lg:col-span-5');
      }
    }

    if (next === 'github') {
      if (dropCol) dropCol.style.display = 'none';
      if (githubPanel && zipGrid) {
        githubPanel.setAttribute('data-eyra-github-panel', '1');
        githubPanel.style.display = 'flex';
        githubPanel.classList.add('lg:col-span-7', 'h-full');
        if (githubPanel.parentElement !== zipGrid) {
          zipGrid.insertBefore(githubPanel, preview || null);
        } else if (preview && githubPanel.nextElementSibling !== preview) {
          zipGrid.insertBefore(githubPanel, preview);
        }
        layoutGithubPanel(githubPanel);
        wireGithubBranchDetection(githubPanel, showToast);
      }
      const input = prepareGithubInput(host);
      try {
        input?.focus();
      } catch {
        /* ignore */
      }
    } else {
      if (dropCol) dropCol.style.display = '';
      // Always hide GitHub card on ZIP tab (tag survives title rename)
      const gh =
        githubPanel ||
        host.querySelector('[data-eyra-github-panel]') ||
        host.querySelector('select[data-eyra-gh-branch]')?.closest('.rounded-xl, [class*="rounded"]');
      if (gh) {
        gh.setAttribute('data-eyra-github-panel', '1');
        gh.style.display = 'none';
      }
    }

    pinIngestActionBar(host);

    // Idle preview copy follows the active tab (ZIP vs GitHub)
    const nameEl = preview?.querySelector?.('[data-eyra-archive-name]');
    const idle =
      !nameEl ||
      /No file here|No repo indexed/i.test((nameEl.textContent || '').trim());
    if (idle && preview) {
      paintArchivePreview(host.querySelector('.stitch-screen') || host, null, next);
    }
  };

  // Restore last tab (don't force ZIP every hydrate)
  apply(getInitialTab() === 'github' ? 'github' : 'upload');

  window.switchTab = apply;
  return () => {
    if (window.switchTab === apply) delete window.switchTab;
  };
}

/** Rebuild side-card preview from session pending or active scan. */
function previewFromScan(scan) {
  if (!scan?.id) return null;
  const st = String(scan.status || '').toLowerCase();
  if (!['pending', 'analyzing', 'completed', 'cancelled', 'failed'].includes(st)) return null;
  const name = scan.projectName || 'Uploaded Codebase';
  return {
    scanId: scan.id,
    projectName: name,
    archiveName:
      scan.archiveName ||
      (scan.sourceType === 'github' ? name : `${name}.zip`),
    meta: scan.meta || {},
    sizeBytes: scan.sizeBytes,
    status: scan.status,
    sourceType: scan.sourceType || 'zip',
    sourceLabel: scan.sourceLabel || null,
  };
}

function enableEngineCheckboxes(host) {
  const boxes = host.querySelectorAll('input[type="checkbox"]');
  boxes.forEach((box) => {
    box.removeAttribute('readonly');
    box.removeAttribute('disabled');
    // Stitch marks them readonly; allow toggling
    if (box.hasAttribute('onclick')) box.removeAttribute('onclick');
  });
}

function readEngineOptions(host) {
  const labels = [...host.querySelectorAll('label')];
  const findBox = (re) => {
    const lab = labels.find((l) => re.test(l.textContent || ''));
    const box = lab?.querySelector('input[type="checkbox"]');
    return box ? Boolean(box.checked) : true;
  };
  const offline = findBox(/offline|ZERO-EGRESS|zero-egress/i);
  return {
    ast: findBox(/Static AST|AST Bug|AST &|Code Quality/i),
    cve: findBox(/CVE|Dependency Vulnerability|Dependency Analysis/i),
    partials: findBox(/Incomplete Feature|TODO Marker|Incomplete Code/i),
    security: findBox(/Security Vulnerability|CVE &/i),
    ai: findBox(/AI-Assisted|Architecture Review|GROQ/i),
    offline,
  };
}

/** Merge ingest UI checkboxes with saved Config page engine flags (config wins when present). */
function mergeEnginesWithConfig(uiEngines, config) {
  const base = {
    ast: true,
    cve: true,
    partials: true,
    security: true,
    ai: true,
    offline: false,
    ...uiEngines,
  };
  if (!config) return base;
  return {
    ...base,
    ast: config.engine_ast !== false,
    security: config.engine_security !== false,
    partials: config.engine_todos !== false,
    cve: config.engine_deps !== false,
  };
}

function formatBytes(n) {
  if (n == null || Number.isNaN(n)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function archivePreviewCard(root) {
  return root?.querySelector?.('[data-eyra-archive-preview]') || null;
}

/** Idle hint on the right preview card — ZIP vs GitHub tab. */
function idleIndexHint(sourceMode) {
  return sourceMode === 'github'
    ? 'Paste a public GitHub URL to index'
    : 'Upload a ZIP to index';
}

/** Keep the side card visible; idle = empty placeholders, ingest = real meta. */
function paintArchivePreview(root, preview, sourceMode = 'upload') {
  if (!root) return;
  const card = archivePreviewCard(root);
  if (!card) return;
  card.style.display = '';

  const set = (sel, value) => {
    const el = card.querySelector(sel);
    if (el) el.textContent = value;
  };

  if (!preview) {
    set('[data-eyra-archive-name]', 'No repo indexed');
    set(
      '[data-eyra-archive-status]',
      sourceMode === 'github' ? 'No GitHub repo linked' : 'No archive uploaded',
    );
    set('[data-eyra-archive-status-icon]', sourceMode === 'github' ? 'hub' : 'upload_file');
    set('[data-eyra-archive-size]', '—');
    set('[data-eyra-archive-files]', '—');
    set('[data-eyra-archive-submodules]', idleIndexHint(sourceMode));
    set('[data-eyra-stack-display]', '—');
    const idleStack = card.querySelector('[data-eyra-stack-display]');
    if (idleStack) delete idleStack.dataset.eyraStackLive;
    set('[data-eyra-archive-frameworks]', '—');
    set('[data-eyra-archive-digest]', '—');
    set('[data-eyra-archive-ast]', '—');
    return;
  }

  const name = preview.projectName || 'Uploaded Codebase';
  const isGithub = preview.sourceType === 'github';
  const displayLabel = isGithub
    ? preview.archiveName || preview.sourceLabel || name
    : preview.archiveName || `${name}.zip`;
  const meta = preview.meta || {};
  const files = meta.totalFilesCount ?? meta.totalFiles;
  const sizeLabel =
    preview.sizeBytes != null
      ? formatBytes(preview.sizeBytes)
      : isGithub
        ? 'GitHub'
        : '—';
  const frameworks = Array.isArray(meta.frameworks)
    ? meta.frameworks.join(' · ')
    : meta.frameworks || '—';
  // Prefer server-detected language; ignore Language-filter overrides for Stack Detected
  const stack =
    meta.detectedPrimaryLanguage ||
    (Array.isArray(meta.detectedLanguages) ? meta.detectedLanguages[0] : null) ||
    (!meta.languageManual
      ? meta.primaryLanguage ||
        (Array.isArray(meta.languages) ? meta.languages[0] : null)
      : null) ||
    '—';
  const digest =
    meta.contentHash || meta.digest || meta.sha256
      ? String(meta.contentHash || meta.digest || meta.sha256).slice(0, 7) +
        '…' +
        String(meta.contentHash || meta.digest || meta.sha256).slice(-6)
      : preview.scanId
        ? `${String(preview.scanId).slice(0, 8)}…`
        : '—';

  set('[data-eyra-archive-name]', displayLabel);
  set('[data-eyra-archive-status]', isGithub ? 'GitHub linked' : 'SHA-256 Validated');
  set('[data-eyra-archive-status-icon]', isGithub ? 'hub' : 'verified');
  set('[data-eyra-archive-size]', sizeLabel || '—');
  set('[data-eyra-archive-files]', files != null ? `${files} Files` : '—');
  set(
    '[data-eyra-archive-submodules]',
    meta.submodulesCount != null ? `${meta.submodulesCount} Submodules` : 'Indexed',
  );
  set('[data-eyra-stack-display]', stack);
  const stackEl = card.querySelector('[data-eyra-stack-display]');
  if (stackEl) {
    if (stack && stack !== '—') stackEl.dataset.eyraStackLive = '1';
    else delete stackEl.dataset.eyraStackLive;
  }
  set('[data-eyra-archive-frameworks]', frameworks || '—');
  set('[data-eyra-archive-digest]', digest);
  set(
    '[data-eyra-archive-ast]',
    meta.astCompliance != null ? `${meta.astCompliance}% Parsing Readiness` : 'Ready to scan',
  );
}

/**
 * Fill Stitch ingest preview with real upload meta — stay on this page until Start.
 */
function hydrateIngestPreview(root, preview) {
  if (!root || !preview) return;
  const name = preview.projectName || 'Uploaded Codebase';
  const isGithub = preview.sourceType === 'github';
  const meta = preview.meta || {};
  const langs = Array.isArray(meta.languages)
    ? meta.languages.join(', ')
    : meta.languages || meta.primaryLanguage || 'Auto-detected';
  const frameworks = Array.isArray(meta.frameworks)
    ? meta.frameworks.join(', ')
    : meta.frameworks || '';
  const files = meta.totalFilesCount ?? meta.totalFiles;
  const sizeLabel = preview.sizeBytes != null ? formatBytes(preview.sizeBytes) : '';

  paintArchivePreview(root, preview);

  const projectInput =
    [...root.querySelectorAll('input[type="text"]')].find((inp) =>
      /backend-api|project|namespace|No file|Uploaded/i.test(inp.value || inp.placeholder || ''),
    ) || null;
  if (projectInput) {
    projectInput.value = name;
    projectInput.removeAttribute('readonly');
  }

  replaceSubstring(root, 'backend-api', name);

  const manual = Boolean(meta.languageManual);
  const langIds = Array.isArray(meta.languages) ? meta.languages : [];
  if (langIds.length || meta.primaryLanguage) {
    updateLanguageDisplay(
      root,
      langIds.length ? langIds : [meta.primaryLanguage],
      { manual },
    );
  }

  replaceSubstring(root, 'READY', 'INGESTED');
  replaceSubstring(root, 'SANDBOX-ARMED', 'READY TO SCAN');

  const stackHint = [
    isGithub ? 'GitHub' : 'ZIP',
    meta.primaryLanguage || langs,
    frameworks || null,
    files != null ? `${files} files indexed` : null,
    sizeLabel || null,
    preview.scanId ? `scan ${String(preview.scanId).slice(0, 8)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const stackEl = [...root.querySelectorAll('p, span, div')].find((el) =>
    /EPHEMERAL RAM|AST token|never compiled|Payload size|Indexed:/i.test(el.textContent || ''),
  );
  if (stackEl && stackHint && (stackEl.textContent || '').length < 280) {
    setText(stackEl, `Indexed: ${stackHint}`);
  }

  if (isGithub) {
    const uploadPanel = root.querySelector('#tab-content-upload');
    if (uploadPanel) uploadPanel.style.display = '';
  }

  // Replace stitch mock "~14.2s" with a light estimate from indexed files
  const filesN = Number(meta.totalFilesCount ?? meta.totalFiles);
  if (Number.isFinite(filesN) && filesN > 0) {
    const secs = Math.max(4, Math.min(120, Math.round(filesN * 0.08 * 10) / 10));
    const etaEl = [...root.querySelectorAll('span')].find((el) =>
      /^~\d+(\.\d+)?s$/.test((el.textContent || '').trim()),
    );
    if (etaEl) etaEl.textContent = `~${secs}s`;
  }
}

function loadPending() {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function savePending(preview) {
  try {
    if (preview) {
      sessionStorage.setItem(PENDING_KEY, JSON.stringify(preview));
      sessionStorage.removeItem(PENDING_CLEARED_KEY);
    } else {
      sessionStorage.removeItem(PENDING_KEY);
    }
  } catch {
    /* ignore */
  }
}

function markPendingCleared(scanId) {
  try {
    sessionStorage.setItem(PENDING_CLEARED_KEY, String(scanId || '1'));
  } catch {
    /* ignore */
  }
}

function wasPendingCleared(scanId) {
  try {
    const v = sessionStorage.getItem(PENDING_CLEARED_KEY);
    if (!v) return false;
    if (!scanId) return true;
    return v === String(scanId) || v === '1';
  } catch {
    return false;
  }
}

function scrubIngestDemo(root) {
  if (!root) return;
  replaceSubstring(root, 'backend-api', '—');
  replaceSubstring(root, '~14.2s', '—');
  replaceSubstring(root, '14.2s', '—');
  replaceSubstring(root, 'NovaPay', '—');
}

export function AuditIngestPage() {
  const { setAuditView, showToast, adoptScan, activeScan } = useEyra();
  const fileRef = useRef(null);
  const hostRef = useRef(null);
  const busyRef = useRef(false);
  const ingestZipFileRef = useRef(null);
  const [uploadPct, setUploadPct] = useState(null);
  const [source, setSource] = useState('upload');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(() => loadPending());
  const [langPickerOpen, setLangPickerOpen] = useState(false);
  const [selectedLangs, setSelectedLangs] = useState(() => loadSelectedLanguages());
  const [draftLangs, setDraftLangs] = useState(() => loadSelectedLanguages());
  const scrubIdle = useCallback((root) => scrubIngestDemo(root), []);
  const { reveal, hold, gateClassName, gateProps } = useStitchGate(hostRef, {
    scrub: scrubIdle,
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    hold();

    // Restore last ingest card from session OR active scan (survives Start / tab nav)
    let preview = pending;
    if (!preview && !wasPendingCleared(activeScan?.id)) {
      const fromScan = previewFromScan(activeScan);
      if (fromScan) {
        preview = fromScan;
        setPending(fromScan);
        savePending(fromScan);
      }
    }

    const cleanupTab = installSwitchTab(
      host,
      setSource,
      () => {
        if (source === 'github') return 'github';
        if (preview?.sourceType === 'github') return 'github';
        return 'upload';
      },
      showToast,
    );
    enableEngineCheckboxes(host);
    pinIngestActionBar(host);
    const root = host.querySelector('.stitch-screen') || host;
    if (preview) {
      try {
        // Only re-apply Language filter onto pending when the user explicitly set it on this ingest
        const pendingWithLangs =
          selectedLangs.length > 0 && preview.meta?.languageManual
            ? {
                ...preview,
                meta: {
                  ...(preview.meta || {}),
                  languages: selectedLangs,
                  // Keep Stack Detected on server-detected language
                  detectedPrimaryLanguage:
                    preview.meta?.detectedPrimaryLanguage || preview.meta?.primaryLanguage,
                  primaryLanguage: selectedLangs[0],
                  languageManual: true,
                },
              }
            : preview;
        hydrateIngestPreview(root, pendingWithLangs);
        // Re-apply tab so GitHub/ZIP left panel + side preview stay paired
        if (window.switchTab) {
          window.switchTab(
            source === 'github' || preview.sourceType === 'github' ? 'github' : 'upload',
          );
        }
      } catch (err) {
        console.warn('Ingest hydrate skipped:', err);
      }
    } else {
      paintArchivePreview(root, null, source === 'github' ? 'github' : 'upload');
      scrubIngestDemo(root);
    }
    if (selectedLangs.length) {
      updateLanguageDisplay(root, selectedLangs, { manual: true });
    } else if (!preview) {
      updateLanguageDisplay(root, [], { manual: false });
    }

    const stitchInput = host.querySelector('#file-upload-input');
    let onStitchFile = null;
    if (stitchInput) {
      stitchInput.accept = '.zip,application/zip';
      stitchInput.removeAttribute('disabled');
      stitchInput.classList.add('hidden');
      onStitchFile = (e) => {
        const file = e.target?.files?.[0];
        if (file) ingestZipFileRef.current?.(file);
        e.target.value = '';
      };
      stitchInput.addEventListener('change', onStitchFile);
      const dropCard = stitchInput.closest('.rounded-xl, [class*="rounded"]');
      if (dropCard) dropCard.setAttribute('data-eyra-zip-drop', '1');
    }

    reveal();

    return () => {
      cleanupTab?.();
      if (stitchInput && onStitchFile) {
        stitchInput.removeEventListener('change', onStitchFile);
      }
    };
    // source intentionally omitted — tab switch must not remount/rehydrate and wipe DOM
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, selectedLangs, activeScan?.id, activeScan?.status, activeScan?.archiveName]);

  function openLanguagePicker() {
    // Start from what's already applied — do not pre-check all cores (that left "Python" first after Apply).
    setDraftLangs([...selectedLangs]);
    setLangPickerOpen(true);
  }

  function toggleDraftLang(id) {
    setDraftLangs((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function applyLanguagePicker() {
    const next = [...draftLangs];
    setSelectedLangs(next);
    saveSelectedLanguages(next);
    setLangPickerOpen(false);

    const paint = () => {
      const root = hostRef.current?.querySelector('.stitch-screen') || hostRef.current;
      updateLanguageDisplay(root, next, { manual: next.length > 0 });
    };
    // Immediate + post-paint (survives any stitch remount from setState)
    paint();
    requestAnimationFrame(paint);

    setPending((prev) => {
      if (!prev) return prev;
      const updated = {
        ...prev,
        meta: {
          ...(prev.meta || {}),
          detectedPrimaryLanguage:
            prev.meta?.detectedPrimaryLanguage || prev.meta?.primaryLanguage,
          languages: next,
          primaryLanguage: next[0] || prev.meta?.primaryLanguage,
          languageManual: next.length > 0,
        },
      };
      savePending(updated);
      return updated;
    });

    if (activeScan?.id) {
      adoptScan({
        ...activeScan,
        meta: {
          ...(activeScan.meta || {}),
          detectedPrimaryLanguage:
            activeScan.meta?.detectedPrimaryLanguage || activeScan.meta?.primaryLanguage,
          languages: next,
          primaryLanguage: next[0] || activeScan.meta?.primaryLanguage,
          languageManual: next.length > 0,
        },
      });
    }

    showToast?.(
      next.length
        ? `Languages set: ${next.join(', ')}`
        : 'Language filter cleared — using auto-detect',
      'info',
    );
  }

  function resetLanguagePicker() {
    setDraftLangs([]);
    setSelectedLangs([]);
    saveSelectedLanguages([]);
    setLangPickerOpen(false);
    const root = hostRef.current?.querySelector('.stitch-screen') || hostRef.current;
    updateLanguageDisplay(root, [], { manual: false });
    setPending((prev) => {
      if (!prev) return prev;
      const meta = { ...(prev.meta || {}) };
      delete meta.languageManual;
      delete meta.languages;
      const updated = { ...prev, meta };
      savePending(updated);
      return updated;
    });
    showToast?.('Using auto-detected languages', 'info');
  }

  async function withBusy(fn) {
    if (busyRef.current) {
      showToast?.('Please wait — operation already running…', 'info');
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      await fn();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  /** Upload / sample only — do NOT start scan yet. @returns {object} pending preview */
  async function ingestOnly(result, extras = {}) {
    const scanId = result?.scanId || result?.scan?.id;
    if (!scanId) throw new Error('Upload succeeded but no scanId was returned');
    const projectName = result.projectName || extras.projectName || 'Uploaded Codebase';
    const baseMeta = { ...(result.meta || {}), ...(extras.meta || {}) };
    const detectedPrimary =
      baseMeta.detectedPrimaryLanguage || baseMeta.primaryLanguage || null;
    const detectedLanguages = Array.isArray(baseMeta.detectedLanguages)
      ? baseMeta.detectedLanguages
      : Array.isArray(baseMeta.languages)
        ? baseMeta.languages
        : detectedPrimary
          ? [detectedPrimary]
          : [];
    const meta =
      selectedLangs.length > 0
        ? {
            ...baseMeta,
            detectedPrimaryLanguage: detectedPrimary,
            detectedLanguages,
            languages: selectedLangs,
            primaryLanguage: selectedLangs[0],
            languageManual: true,
          }
        : {
            ...baseMeta,
            detectedPrimaryLanguage: detectedPrimary,
            detectedLanguages,
          };
    const preview = {
      scanId,
      projectName,
      archiveName: extras.archiveName || `${projectName}.zip`,
      meta,
      sizeBytes: extras.sizeBytes,
      status: 'pending',
      sourceType: extras.sourceType || 'zip',
      sourceLabel: extras.sourceLabel || null,
    };
    adoptScan({
      id: scanId,
      projectName,
      status: 'pending',
      progress: 0,
      currentStage: 'Ingested — configure engines, then Start',
      meta,
      sourceType: extras.sourceType || 'zip',
      archiveName: extras.archiveName || `${projectName}.zip`,
      sourceLabel: extras.sourceLabel || null,
    });
    setPending(preview);
    savePending(preview);
    const host = hostRef.current;
    if (host) {
      enableEngineCheckboxes(host);
      const tab = extras.sourceType === 'github' ? 'github' : 'upload';
      window.switchTab?.(tab);
      hydrateIngestPreview(host.querySelector('.stitch-screen') || host, preview);
      window.switchTab?.(tab);
      pinIngestActionBar(host);
    }
    const label = extras.sourceType === 'github' ? projectName : preview.archiveName;
    const n = Number(
      preview.meta?.totalFilesCount ?? result?.fileInventory?.listed ?? 0,
    );
    showToast?.(
      `Ingested ${label} · ${n || '?'} files in explorer — review options, then Start Codebase Audit`,
      'info',
    );
    if (extras.sourceType === 'github' && n > 0 && n < 8) {
      showToast?.(
        `GitHub clone indexed ${n} files. If that looks too small, confirm the URL/branch (public repos only).`,
        'info',
      );
    }
    return preview;
  }

  function normalizeGithubCompareUrl(url) {
    return String(url || '')
      .trim()
      .replace(/\.git$/i, '')
      .replace(/\/$/, '')
      .toLowerCase();
  }

  async function startPendingScan(scanIdOverride = null, pendingOverride = null) {
    const host = hostRef.current;
    const uiEngines = host
      ? readEngineOptions(host)
      : { ast: true, cve: true, partials: true, security: true, ai: true, offline: false };
    let savedConfig = null;
    try {
      savedConfig = await api.config();
    } catch {
      /* optional — fall back to ingest checkboxes */
    }
    const engines = mergeEnginesWithConfig(uiEngines, savedConfig);
    const fromPending = pendingOverride || pending;
    const scanId = scanIdOverride || fromPending?.scanId || activeScan?.id;
    if (!scanId) {
      showToast?.('Upload a ZIP or Configure & Index a GitHub repo first, then Start', 'error');
      return;
    }

    // Prefer project name from the identifier input if user edited it
    const projectInput = host?.querySelector('input[type="text"]');
    const editedName = (projectInput?.value || '').trim();
    const basePending = fromPending || pending;

    await withBusy(async () => {
      try {
        if (editedName && editedName !== basePending?.projectName) {
          adoptScan({
            id: scanId,
            projectName: editedName,
            status: 'pending',
            meta: basePending?.meta,
          });
        }
        showToast?.(
          `Starting audit · AST ${engines.ast ? 'on' : 'off'} · SEC ${engines.security ? 'on' : 'off'} · DEPS ${engines.cve ? 'on' : 'off'} · AI ${engines.ai && !engines.offline ? 'on' : 'off'}`,
          'info',
        );
        await api.startScan(scanId, { engines });
        const startedMeta = {
          id: scanId,
          projectName: editedName || basePending?.projectName || activeScan?.projectName,
          status: 'analyzing',
          progress: 5,
          currentStage: 'Scan processing started',
          meta: basePending?.meta || activeScan?.meta,
          archiveName: basePending?.archiveName || activeScan?.archiveName,
          sourceType: basePending?.sourceType || activeScan?.sourceType,
          sourceLabel: basePending?.sourceLabel || activeScan?.sourceLabel,
          sizeBytes: basePending?.sizeBytes || activeScan?.sizeBytes,
          engines,
        };
        adoptScan(startedMeta, { notify: true, title: 'Audit started' });
        // Keep pending so returning to Ingest still shows the archive preview
        const keepPreview = previewFromScan({
          ...(activeScan || {}),
          ...(basePending || {}),
          ...startedMeta,
          id: scanId,
        });
        if (keepPreview) {
          setPending(keepPreview);
          savePending(keepPreview);
        }
        setAuditView('progress');
      } catch (err) {
        showToast?.(err.message || 'Failed to start scan', 'error');
      }
    });
  }

  async function ingestZipFile(file) {
    if (!file) return;
    if (!/\.zip$/i.test(file.name || '')) {
      showToast?.('Only .zip archives are supported (max 50 MB)', 'error');
      return;
    }
    if (file.size > MAX_ZIP_BYTES) {
      showToast?.('ZIP exceeds 50 MB backend limit', 'error');
      return;
    }
    await withBusy(async () => {
      try {
        setUploadPct(0);
        showToast?.(`Uploading ${file.name}…`, 'info');
        const result = await api.uploadZip(file, {
          onProgress: (pct) => setUploadPct(pct),
        });
        setUploadPct(null);
        await ingestOnly(result, {
          archiveName: file.name,
          projectName: file.name.replace(/\.zip$/i, ''),
          sizeBytes: file.size,
          sourceType: 'zip',
          sourceLabel: `Source: ZIP Archive (${file.name})`,
        });
      } catch (err) {
        setUploadPct(null);
        showToast?.(err.message || 'ZIP upload failed', 'error');
      }
    });
  }
  ingestZipFileRef.current = ingestZipFile;

  function openZipPicker() {
    const stitchInput = hostRef.current?.querySelector('#file-upload-input');
    (stitchInput || fileRef.current)?.click();
  }

  /** Accept full https://github.com/... links or org/repo shorthand. */
  function readGithubRepoUrl() {
    const host = hostRef.current;
    const input =
      host?.querySelector('input[placeholder*="github.com"]') ||
      host?.querySelector('input[placeholder*="organization/repository"]') ||
      host?.querySelector('input[placeholder*="Paste"]');
    let raw = (input?.value || '').trim();
    if (!raw || raw === 'organization/repository') {
      showToast?.('Paste a full GitHub URL, e.g. https://github.com/org/repo', 'error');
      return null;
    }
    // Allow accidental double-prefix if Stitch prefix was still visible
    raw = raw.replace(/^https?:\/\/github\.com\/https?:\/\/github\.com\//i, 'https://github.com/');
    if (/^https?:\/\/(www\.)?github\.com\//i.test(raw)) {
      return raw.replace(/\.git$/i, '').replace(/\/$/, '');
    }
    if (/^github\.com\//i.test(raw)) {
      return `https://${raw.replace(/\.git$/i, '').replace(/\/$/, '')}`;
    }
    // org/repo shorthand
    const short = raw.replace(/^\/+/, '').replace(/\.git$/i, '');
    if (/^[\w.-]+\/[\w.-]+/.test(short)) {
      return `https://github.com/${short.split('/').slice(0, 2).join('/')}`;
    }
    showToast?.('Enter a valid GitHub URL (https://github.com/org/repo)', 'error');
    return null;
  }

  async function ingestGithubRepo({ alsoStart = false } = {}) {
    let preview = null;
    await withBusy(async () => {
      const repoUrl = readGithubRepoUrl();
      if (!repoUrl) return;
      const branch = readGithubBranch(hostRef.current);
      try {
        showToast?.(
          `Cloning ${repoUrl.replace(/^https?:\/\/(www\.)?github\.com\//i, '')}@${branch}…`,
          'info',
        );
        const result = await api.uploadGithub(repoUrl, { branch });
        const short = repoUrl.replace(/^https?:\/\/(www\.)?github\.com\//i, '');
        const usedBranch = result.meta?.branch || branch;
        preview = await ingestOnly(result, {
          archiveName: `${short}@${usedBranch}`,
          projectName: result.projectName || short.split('/')[1] || short,
          sourceType: 'github',
          sourceLabel: `Source: GitHub (${short} · ${usedBranch})`,
          meta: { ...(result.meta || {}), branch: usedBranch, repoUrl },
        });
      } catch (err) {
        showToast?.(err.message || 'GitHub clone/ingest failed', 'error');
      }
    });
    if (alsoStart && preview?.scanId) {
      await startPendingScan(preview.scanId, preview);
    }
    return preview;
  }

  async function startFromPrimaryAction() {
    if (activeScan?.status === 'analyzing') {
      setAuditView('progress');
      return;
    }
    if (activeScan?.status === 'completed' && !pending?.scanId) {
      setAuditView('code');
      showToast?.('Scan already completed — opening Code Audit', 'info');
      return;
    }

    // GitHub tab: never start a stale ZIP/sample scan when a repo URL is present
    if (source === 'github') {
      const repoUrl = readGithubRepoUrl();
      if (!repoUrl) return;
      const want = normalizeGithubCompareUrl(repoUrl);
      const have = normalizeGithubCompareUrl(pending?.meta?.repoUrl);
      const pendingIsThisRepo =
        Boolean(pending?.scanId) &&
        pending?.sourceType === 'github' &&
        have &&
        (have === want || have.includes(want.replace(/^https?:\/\/(www\.)?github\.com\//, '')));

      if (!pendingIsThisRepo) {
        // Clone this URL first, then start — fixes MusicVibesHub showing NovaPay sample files
        await ingestGithubRepo({ alsoStart: true });
        return;
      }
      await startPendingScan();
      return;
    }

    // Already ingested ZIP → start that scan
    if (pending?.scanId || (activeScan?.id && activeScan?.status === 'pending')) {
      await startPendingScan();
      return;
    }
    // File selected in picker but not yet uploaded
    const pendingFile = fileRef.current?.files?.[0];
    if (pendingFile) {
      await ingestZipFile(pendingFile);
      return;
    }
    showToast?.('Drop a ZIP or switch to GitHub and paste a repo URL, then Start', 'error');
  }

  function clearPending() {
    markPendingCleared(pending?.scanId || activeScan?.id);
    setPending(null);
    savePending(null);
    const root = hostRef.current?.querySelector('.stitch-screen') || hostRef.current;
    paintArchivePreview(root, null, source === 'github' ? 'github' : 'upload');
    showToast?.('Cleared ingested archive — upload again when ready', 'info');
  }

  return (
    <div
      ref={hostRef}
      className={gateClassName}
      {...gateProps}
      onClick={(e) => {
        // Native <label for="file-upload-input"> — let it open the stitch input (wired above)
        if (e.target.closest('label[for="file-upload-input"]')) {
          return;
        }

        // Click anywhere on the ZIP drop card (not a button) → open picker
        const dropCard =
          e.target.closest('[data-eyra-zip-drop]') ||
          e.target.closest('#file-upload-input')?.closest('.rounded-xl');
        const el = e.target.closest('button, a, [role="button"]');
        if (dropCard && !el && !e.target.closest('input, select, textarea, label')) {
          e.preventDefault();
          openZipPicker();
          return;
        }

        if (!el) return;
        // Let checkbox labels toggle freely
        if (el.closest('label') && el.closest('label')?.querySelector('input[type="checkbox"]')) {
          return;
        }
        const text = (el.textContent || '').trim();
        const id = el.id || '';

        if (
          id === 'tab-btn-github' ||
          id === 'tab-btn-upload' ||
          text === 'GitHub Repository' ||
          text.includes('Upload ZIP Archive')
        ) {
          e.preventDefault();
          const tab = id.includes('github') || text.includes('GitHub') ? 'github' : 'upload';
          window.switchTab?.(tab);
          return;
        }

        // Samples removed — ignore Sample Projects / NovaPay / PyCrypto UI leftovers
        if (
          id === 'tab-btn-samples' ||
          text.includes('Sample Projects') ||
          text.includes('NovaPay') ||
          text.includes('PyCrypto')
        ) {
          e.preventDefault();
          showToast?.(
            'Built-in samples were removed. Use ZIP upload or GitHub Configure & Index.',
            'info',
          );
          return;
        }

        if (
          el.closest?.('[data-eyra-gh-configure]') ||
          el.hasAttribute?.('data-eyra-gh-configure') ||
          text.includes('Configure & Index') ||
          text.includes('Configure Remote')
        ) {
          e.preventDefault();
          ingestGithubRepo();
          return;
        }

        // Language & Framework filter (tune icon)
        const iconText = (
          el.querySelector?.('.material-symbols-outlined')?.textContent || text
        ).trim();
        if (iconText === 'tune' || (el.closest?.('button') && iconText.includes('tune'))) {
          e.preventDefault();
          openLanguagePicker();
          return;
        }

        if (text.includes('Start Codebase Audit') || text.includes('Start Audit')) {
          e.preventDefault();
          startFromPrimaryAction();
        } else if (text.includes('Replace Archive') || text.includes('Replace')) {
          e.preventDefault();
          openZipPicker();
        } else if (text.includes('Remove') && !text.includes('Remote')) {
          e.preventDefault();
          clearPending();
        } else if (
          text.includes('Browse') ||
          (text.includes('Upload') && !text.includes('Upload ZIP')) ||
          text.includes('Drop') ||
          text.includes('Choose') ||
          text.includes('Drag and drop')
        ) {
          e.preventDefault();
          openZipPicker();
        } else if (text.includes('Cancel')) {
          e.preventDefault();
          setAuditView('overview');
        } else if (text.includes('Codebase Audit') && !text.includes('Start')) {
          e.preventDefault();
          setAuditView('overview');
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer?.files?.[0];
        if (file) ingestZipFile(file);
      }}
    >
      <input
        ref={fileRef}
        type="file"
        accept=".zip,application/zip"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) ingestZipFile(file);
          e.target.value = '';
        }}
      />
      <AuditIngestStitch />
      <LanguagePicker
        open={langPickerOpen}
        selected={draftLangs}
        onToggle={toggleDraftLang}
        onApply={applyLanguagePicker}
        onClose={() => setLangPickerOpen(false)}
        onReset={resetLanguagePicker}
      />
      {uploadPct != null ? (
        <div className="fixed bottom-16 right-6 z-[90] rounded bg-surface-container-highest px-space-md py-space-sm font-body-sm text-body-sm text-on-surface shadow-xl">
          Uploading ZIP… {uploadPct}%
        </div>
      ) : null}
      {busy && uploadPct == null ? (
        <div className="fixed bottom-16 left-1/2 z-[90] -translate-x-1/2 rounded bg-surface-container-highest px-space-md py-space-sm font-body-sm text-body-sm text-on-surface shadow-xl">
          Working…
        </div>
      ) : null}
    </div>
  );
}
