/**
 * Shared Analysis-style investigation panels (fault banner, timeline, RCA, diff).
 * Used by Memory & Knowledge when a saved session is selected.
 */

import { normalizeDisplayedCode } from './codeText.js';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pickEvidence(result) {
  const list = Array.isArray(result?.evidence) ? [...result.evidence] : [];
  const byKind = (k) => list.find((e) => String(e.kind || '').toLowerCase().includes(k));
  const exception =
    byKind('exception') ||
    byKind('error') ||
    byKind('stack') ||
    (result?.error_type
      ? {
          kind: 'exception',
          detail: result.error_summary || result.error_type,
          location: result.file_name,
        }
      : null);
  const context =
    byKind('context') ||
    byKind('source') ||
    byKind('terminal') ||
    {
      kind: 'context',
      detail:
        [result?.terminal_output, result?.stack_trace].filter(Boolean).join('\n').slice(0, 600) ||
        result?.explanation ||
        'No terminal/stack context stored for this investigation.',
      location: result?.file_name
        ? `line ${guessLine(result) || '—'}`
        : '—',
    };
  return { exception, context };
}

function guessLine(result) {
  const blob = `${result?.stack_trace || ''}\n${result?.terminal_output || ''}`;
  const m = blob.match(/line\s+(\d+)/i);
  return m ? m[1] : null;
}

function buildTimelineSteps(result) {
  const api = Array.isArray(result?.execution_timeline) ? result.execution_timeline : [];
  if (api.length) {
    return api.map((ev, i) => {
      const st = String(ev.status || 'done');
      const failed =
        st === 'skipped' && /fault|error|fail/i.test(`${ev.step} ${ev.detail}`)
          ? true
          : i === api.length - 1 &&
            result?.error_type &&
            /error|fault|fail/i.test(String(ev.step));
      return {
        label: ev.step || `Step ${i + 1}`,
        detail: ev.detail || '',
        tone: st === 'active' ? 'active' : failed || st === 'skipped' ? 'fault' : 'ok',
        t: `T+${(i * 0.4).toFixed(2)}ms`,
      };
    });
  }
  // Default 5-step deferential timeline matching Analysis mock
  const hasFault = Boolean(result?.error_type);
  return [
    { label: 'Observe', detail: 'Buffer accepted', tone: 'ok', t: 'T+0.00ms' },
    { label: 'Investigate', detail: result?.file_name || 'Inspect', tone: 'ok', t: 'T+0.40ms' },
    {
      label: 'Reason',
      detail: result?.reasoning_source || 'brain',
      tone: 'ok',
      t: 'T+0.80ms',
    },
    {
      label: 'Verify',
      detail: result?.verification?.status || 'not_run',
      tone: hasFault ? 'ok' : 'ok',
      t: 'T+1.20ms',
    },
    {
      label: 'Respond',
      detail: result?.error_type || 'done',
      tone: hasFault ? 'fault' : 'ok',
      t: 'T+1.60ms',
    },
  ];
}

function renderTimelineTrack(steps) {
  return steps
    .map((s) => {
      const ball =
        s.tone === 'fault'
          ? 'bg-error text-on-error'
          : s.tone === 'active'
            ? 'bg-secondary text-on-secondary'
            : 'bg-tertiary text-on-tertiary';
      const mark = s.tone === 'fault' ? '!' : s.tone === 'active' ? 'ℹ' : '✓';
      const labelCls =
        s.tone === 'fault'
          ? 'text-error bg-error-container/30 font-semibold'
          : s.tone === 'active'
            ? 'text-secondary bg-surface-container'
            : 'text-on-surface bg-surface-container';
      return `<div class="relative z-10 flex flex-col items-center group cursor-default max-w-[9rem]">
<div class="w-4 h-4 rounded-full ${ball} flex items-center justify-center text-[9px] font-bold shadow-sm">${mark}</div>
<span class="font-code-compact text-code-compact ${s.tone === 'fault' ? 'text-error font-bold' : 'text-outline-variant'} mt-1 text-[10px]">${esc(s.t)}</span>
<span class="font-label-sm text-label-sm ${labelCls} text-[10px] px-1 rounded shadow-sm text-center truncate max-w-full" title="${esc(s.detail)}">${esc(s.label)}</span>
</div>`;
    })
    .join('');
}

/**
 * LLM / JSON payloads often store code with literal "\\n" instead of real newlines.
 * Expand those so diffs render line-by-line.
 */
function normalizeCodeText(text) {
  return normalizeDisplayedCode(text).replace(/\r/g, '\n');
}

function buildUnifiedFromPair(original, corrected, fileName) {
  const a = normalizeCodeText(original).split('\n');
  const b = normalizeCodeText(corrected).split('\n');
  while (a.length && a[a.length - 1] === '') a.pop();
  while (b.length && b[b.length - 1] === '') b.pop();
  const out = [
    `--- a/${fileName || 'snippet'}`,
    `+++ b/${fileName || 'snippet'}`,
    `@@ -1,${a.length} +1,${b.length} @@`,
  ];
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) {
    out.push(` ${a[i]}`);
    i += 1;
  }
  let ja = a.length - 1;
  let jb = b.length - 1;
  while (ja >= i && jb >= i && a[ja] === b[jb]) {
    ja -= 1;
    jb -= 1;
  }
  for (let k = i; k <= ja; k += 1) out.push(`-${a[k]}`);
  for (let k = i; k <= jb; k += 1) out.push(`+${b[k]}`);
  for (let k = ja + 1; k < a.length; k += 1) out.push(` ${a[k]}`);
  return out.join('\n');
}

function nbspPad(n, width = 3) {
  const s = String(n);
  return s + '\u00a0'.repeat(Math.max(1, width - s.length + 1));
}

function expandDiffLines(lines) {
  const out = [];
  for (const line of lines) {
    const prefix = line.startsWith('+') || line.startsWith('-') || line.startsWith(' ') ? line[0] : '';
    const body = prefix ? line.slice(1) : line;
    if (
      prefix &&
      body.includes('\\n') &&
      !body.includes('\n') &&
      !line.startsWith('---') &&
      !line.startsWith('+++') &&
      !line.startsWith('@@')
    ) {
      const parts = normalizeCodeText(body).split('\n');
      if (parts.length > 1) {
        parts.forEach((p) => out.push(`${prefix}${p}`));
        continue;
      }
    }
    out.push(line);
  }
  return out;
}

function renderDiffHtml(fileName, patchText) {
  const raw = normalizeCodeText(patchText);
  let lines = expandDiffLines(raw.split(/\n/));
  const looksLikeDiff = lines.some(
    (l) => l.startsWith('+++') || l.startsWith('---') || l.startsWith('@@') || /^[+-]/.test(l),
  );
  if (!looksLikeDiff) {
    const codeLines = normalizeCodeText(patchText).split('\n');
    lines = [
      `--- a/${fileName || 'snippet'}`,
      `+++ b/${fileName || 'snippet'}`,
      `@@ -0,0 +1,${codeLines.length} @@`,
      ...codeLines.map((l) => `+${l}`),
    ];
  }

  let oldNo = 0;
  let newNo = 0;
  const hunk = lines.find((l) => l.startsWith('@@')) || '@@ -1 +1 @@';
  const m = hunk.match(/@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)/);
  if (m) {
    oldNo = Number(m[1]) - 1;
    newNo = Number(m[2]) - 1;
  }

  const bodyParts = [];
  for (const line of lines) {
    if (
      line.startsWith('+++') ||
      line.startsWith('---') ||
      line.startsWith('diff ') ||
      line.startsWith('index ') ||
      line.startsWith('@@')
    ) {
      continue;
    }
    if (line.startsWith('+')) {
      newNo += 1;
      bodyParts.push(
        `<div class="bg-tertiary-container/20 text-tertiary -mx-3 px-3 py-0.5 flex items-start font-medium">` +
          `<span class="w-5 shrink-0 select-none text-tertiary">+</span>` +
          `<span class="whitespace-pre-wrap break-all">${nbspPad(newNo)}${esc(line.slice(1) || ' ')}</span>` +
          `</div>`,
      );
      continue;
    }
    if (line.startsWith('-')) {
      oldNo += 1;
      bodyParts.push(
        `<div class="bg-error-container/25 text-error -mx-3 px-3 py-0.5 flex items-start">` +
          `<span class="w-5 shrink-0 select-none text-error">-</span>` +
          `<span class="whitespace-pre-wrap break-all">${nbspPad(oldNo)}${esc(line.slice(1) || ' ')}</span>` +
          `</div>`,
      );
      continue;
    }
    const text = line.startsWith(' ') ? line.slice(1) : line;
    oldNo += 1;
    newNo += 1;
    bodyParts.push(
      `<div class="text-on-surface/80 -mx-3 px-3 py-0.5 flex items-start">` +
        `<span class="w-5 shrink-0 select-none text-outline"> </span>` +
        `<span class="whitespace-pre-wrap break-all">${nbspPad(oldNo)}${esc(text || ' ')}</span>` +
        `</div>`,
    );
  }

  return {
    hunk,
    body: bodyParts.join('') || `<div class="text-on-surface px-1">No changes</div>`,
    fileName: fileName || 'snippet',
  };
}

function resolvePatch(result) {
  const corrected = normalizeCodeText(result?.suggested_correction?.corrected_code || '');
  let patch = normalizeCodeText(result?.suggested_correction?.diff_unified || '');
  const original = normalizeCodeText(result?.code_snippet || '');
  if (!patch && corrected && original) {
    patch = buildUnifiedFromPair(original, corrected, result.file_name || 'snippet');
  } else if (!patch) {
    patch = corrected;
  }
  return patch;
}

/**
 * Full HTML for Memory live investigation panels (banner + timeline + RCA + diff).
 * @param {object} result AnalyzeResponse-like session detail
 */
export function buildMemoryInvestigationHtml(result) {
  if (!result) {
    return `<div class="rounded-xl bg-surface-container-low p-space-md text-on-surface-variant font-body-sm">Select an investigation to view analysis.</div>`;
  }

  const errType = String(result.error_type || 'ERROR').toUpperCase();
  const summary =
    result.error_summary || result.error_type || 'Investigation record';
  const rootCause = result.root_cause || result.explanation || '';
  const src = result.reasoning_source || 'brain';
  const steps = buildTimelineSteps(result);
  const hasFault = Boolean(result.error_type);
  const subtitle = `(0.00ms → ${hasFault ? 'FAULT' : 'OK'}${hasFault ? ' FAULT' : ''})`;
  const track = renderTimelineTrack(steps);
  const { exception, context } = pickEvidence(result);
  const vectors = [exception, context].filter(Boolean);
  const patch = resolvePatch(result);
  const painted = patch
    ? renderDiffHtml(result.file_name, patch)
    : { hunk: '@@ — @@', body: '<div class="text-on-surface-variant px-1">No suggested patch stored for this session.</div>', fileName: result.file_name || 'snippet' };

  const ctxDetail = String(context?.detail || '')
    .replace(/\\n/g, '\n')
    .slice(0, 800);

  return `
<div class="flex flex-col gap-space-sm" data-eyra-memory-live-inner>
  <!-- Fault banner -->
  <div class="rounded-xl bg-surface-container-lowest p-space-md flex flex-col sm:flex-row sm:items-center justify-between gap-space-md shadow-sm border border-error/20">
    <div class="flex items-start gap-space-sm min-w-0">
      <div class="w-10 h-10 rounded-lg bg-error-container/40 text-error flex items-center justify-center shrink-0">
        <span class="material-symbols-outlined text-[22px]">error</span>
      </div>
      <div class="flex flex-col gap-1 min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="font-label-sm text-label-sm px-2 py-0.5 rounded bg-error text-on-error font-semibold uppercase">${esc(errType)}</span>
          <span class="font-code-compact text-code-compact text-outline">run</span>
          <span class="font-code-compact text-code-compact text-outline">${esc(src)}</span>
        </div>
        <div class="font-headline-sm text-headline-sm font-semibold text-error truncate">${esc(summary)}</div>
        <p class="font-body-sm text-body-sm text-on-surface-variant">${esc(rootCause)}</p>
      </div>
    </div>
    <button type="button" data-eyra-open-workspace class="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-on-primary font-label-sm text-label-sm font-semibold hover:opacity-90 shadow-sm">
      <span class="material-symbols-outlined text-[18px]">play_circle</span>
      <span>Open in Debugging Workspace</span>
    </button>
  </div>

  <!-- Deterministic Execution Timeline -->
  <div class="rounded-xl bg-surface-container-lowest p-space-md shadow-sm flex flex-col gap-space-sm">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex items-center gap-2 min-w-0">
        <span class="material-symbols-outlined text-primary text-[18px]">schedule</span>
        <span class="font-headline-sm text-headline-sm font-semibold text-on-surface">Deterministic Execution Timeline</span>
        <span class="font-code-compact text-code-compact text-outline">${esc(subtitle)}</span>
      </div>
      <div class="flex items-center gap-3 font-label-sm text-label-sm text-on-surface-variant">
        <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-tertiary"></span>Frame Passed</span>
        <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-error"></span>Fault Trigger</span>
      </div>
    </div>
    <div class="overflow-x-auto py-2">
      <div class="w-full flex items-center justify-between min-w-[420px] relative gap-2">
        <div class="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-0.5 bg-surface-container-high z-0"></div>
        ${track}
      </div>
    </div>
  </div>

  <!-- Root-Cause Analysis -->
  <div class="rounded-xl bg-surface-container-lowest p-space-md shadow-sm flex flex-col gap-space-sm">
    <div class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <span class="material-symbols-outlined text-tertiary text-[18px]">analytics</span>
        <span class="font-headline-sm text-headline-sm font-semibold text-on-surface">Root-Cause Analysis</span>
      </div>
      <span class="font-label-sm text-label-sm text-outline uppercase tracking-wider">${vectors.length} Proof Vectors</span>
    </div>
    <p class="font-body-sm text-body-sm text-on-surface-variant">${esc(rootCause || 'No root-cause text stored.')}</p>
    <div class="flex flex-col gap-2">
      ${
        exception
          ? `<div class="rounded-lg bg-surface-container p-space-sm flex flex-col gap-1 shadow-sm">
<div class="flex items-center justify-between">
<div class="flex items-center gap-1.5 text-tertiary font-label-sm text-label-sm font-semibold">
<span class="material-symbols-outlined text-[15px]">fact_check</span>
<span>exception</span>
</div>
<span class="font-code-compact text-code-compact text-outline">${esc(exception.location || result.file_name || '—')}</span>
</div>
<p class="font-body-sm text-body-sm text-on-surface-variant whitespace-pre-wrap">${esc(exception.detail || '')}</p>
</div>`
          : ''
      }
      ${
        context
          ? `<div class="rounded-lg bg-surface-container p-space-sm flex flex-col gap-1 shadow-sm">
<div class="flex items-center justify-between">
<div class="flex items-center gap-1.5 text-error font-label-sm text-label-sm font-semibold">
<span class="material-symbols-outlined text-[15px]">sensors</span>
<span>context</span>
</div>
<span class="font-code-compact text-code-compact text-outline">${esc(context.location || '—')}</span>
</div>
<p class="font-body-sm text-body-sm text-on-surface-variant whitespace-pre-wrap font-mono text-[12px]">${esc(ctxDetail)}</p>
</div>`
          : ''
      }
    </div>
  </div>

  <!-- Suggested Correction / Diff -->
  <div class="rounded-xl bg-surface-container-lowest overflow-hidden shadow-sm flex flex-col" data-eyra-memory-patch>
    <div class="px-space-md py-2 flex items-center justify-between gap-2 bg-surface-container-low border-b border-outline-variant/20">
      <div class="flex items-center gap-2 min-w-0">
        <span class="material-symbols-outlined text-primary text-[18px]">auto_fix</span>
        <span class="font-headline-sm text-headline-sm font-semibold text-on-surface truncate">Suggested Correction</span>
        <span class="font-code-compact text-code-compact text-primary truncate">${esc(painted.fileName)}</span>
      </div>
      <div class="flex items-center gap-1.5 shrink-0">
        <button type="button" data-eyra-copy-patch class="px-2.5 py-1 rounded font-label-sm text-label-sm text-on-surface-variant hover:bg-surface-container">Copy Patch</button>
        <button type="button" data-eyra-apply-patch class="px-2.5 py-1 rounded bg-primary text-on-primary font-label-sm text-label-sm font-semibold">Apply Patch</button>
      </div>
    </div>
    <div class="px-space-md py-1.5 flex items-center justify-between bg-surface-container/60 border-b border-outline-variant/10">
      <div class="flex items-center gap-1.5">
        <span class="material-symbols-outlined text-[14px] text-outline">description</span>
        <span class="font-code-compact text-code-compact text-on-surface">${esc(painted.fileName)}</span>
      </div>
      <span class="font-code-compact text-code-compact text-outline">${esc(result.language || 'code')}</span>
    </div>
    <div class="eyra-diff-panel p-3 flex flex-col font-mono text-[12px] leading-relaxed select-text text-on-surface max-h-72 overflow-y-auto eyra-terminal-scroll">
      ${painted.body}
    </div>
  </div>
</div>`;
}

export function getSessionPatchText(result) {
  return resolvePatch(result) || '';
}
