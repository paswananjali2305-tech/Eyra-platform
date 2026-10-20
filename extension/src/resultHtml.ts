import { escapeHtml } from './analysisHtml';
import type { ExecuteView, GeneratedTestsView, OptimizeView, PerformanceView, TestRunView } from './phase3Model';

function page(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'none';" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 0; padding: 20px 24px 40px; background: #0e131e; color: #dee2f2; font-family: Inter, Segoe UI, sans-serif; font-size: 13px; line-height: 1.5; }
    h1 { margin: 0; color: #35d6f2; font-size: 20px; letter-spacing: 0.04em; }
    h2 { margin: 18px 0 6px; font-size: 13px; color: #9cedff; }
    .meta { color: #859397; }
    .banner { margin: 12px 0; padding: 10px 12px; border: 1px solid rgba(60,73,76,0.8); background: #161b27; border-radius: 8px; }
    pre { white-space: pre-wrap; word-break: break-word; background: #090e19; border: 1px solid rgba(60,73,76,0.7); padding: 10px; border-radius: 8px; font-family: "JetBrains Mono", Consolas, monospace; font-size: 12px; }
    ul { padding-left: 18px; }
  </style>
</head>
<body>
  <h1>EYRA</h1>
  ${body}
</body>
</html>`;
}

function section(title: string, text: string | null | undefined): string {
  if (!text || !text.trim()) {
    return '';
  }
  return `<section><h2>${escapeHtml(title)}</h2><pre>${escapeHtml(text)}</pre></section>`;
}

export function renderExecuteHtml(view: ExecuteView): string {
  const duration = view.durationMs === null ? 'not returned' : `${view.durationMs} ms`;
  const available = view.runtimeAvailable === null ? 'not returned' : String(view.runtimeAvailable);
  return page('EYRA run', `
    <p class="meta">Execution result from the Brain. Suggested fixes were not run.</p>
    <div class="banner">
      <div>${escapeHtml(view.headline)}</div>
      <div class="meta">ok ${escapeHtml(String(view.ok))} · exit ${escapeHtml(String(view.exitCode))} · duration ${escapeHtml(duration)}</div>
      <div class="meta">runtime_available ${escapeHtml(available)} · runtime ${escapeHtml(view.runtime || 'not returned')} ${escapeHtml(view.runtimeVersion || '')}</div>
      <div class="meta">status ${escapeHtml(view.status || 'not returned')} · phase ${escapeHtml(view.phase || 'not returned')} · timed_out ${escapeHtml(String(view.timedOut))}</div>
    </div>
    ${section('stdout', view.stdout)}
    ${section('stderr', view.stderr)}
    ${section('Diagnostics', view.diagnostics)}
    ${section('Error type', view.errorType)}
  `);
}

export function renderGeneratedTestsHtml(view: GeneratedTestsView): string {
  const items = view.cases.length
    ? `<ul>${view.cases.map((item) => `<li>#${escapeHtml(String(item.id))} ${escapeHtml(item.description || 'Untitled case')} <span class="meta">${escapeHtml(item.call || 'no call')} · ${escapeHtml(item.status || 'not_run')}</span></li>`).join('')}</ul>`
    : '<p class="meta">No cases were returned.</p>';
  return page('EYRA tests', `
    <p class="meta">Review only. Nothing has been executed.</p>
    <div class="banner">${escapeHtml(view.headline)}</div>
    ${items}
  `);
}

export function renderTestRunHtml(view: TestRunView): string {
  const items = view.cases.length
    ? `<ul>${view.cases.map((item) => `<li>#${escapeHtml(String(item.id))} ${escapeHtml(item.description || 'Untitled case')} <span class="meta">${escapeHtml(item.status || 'not returned')}</span></li>`).join('')}</ul>`
    : '<p class="meta">No cases were returned.</p>';
  return page('EYRA test run', `
    <p class="meta">Counts below are the values returned by the Brain.</p>
    <div class="banner">
      <div>${escapeHtml(view.headline)}</div>
      <div class="meta">passed ${view.counts.passed} · failed ${view.counts.failed} · error ${view.counts.error} · skipped ${view.counts.skipped} · not_run ${view.counts.not_run} · total ${view.counts.total}</div>
      <div class="meta">${view.coverage.measured ? `Measured line coverage ${view.coverage.percent ?? 0}%` : `Coverage unavailable: ${escapeHtml(view.coverage.reason)}`} Test pass rate is reported separately and is not line coverage.</div>
    </div>
    ${items}
    ${section('Log', view.log)}
  `);
}

export function renderPerformanceHtml(view: PerformanceView): string {
  const notes = [...view.notes, ...view.payloadNotes];
  const noteList = notes.length
    ? `<ul>${notes.map((note) => `<li>${escapeHtml(note)}</li>`).join('')}</ul>`
    : '';
  const unrun = view.unrunCases === null
    ? ''
    : `<p class="meta">Unrun test cases returned: ${escapeHtml(String(view.unrunCases))}. They were not executed.</p>`;
  return page('EYRA performance', `
    <p class="meta">These are estimates returned by the Brain, not a measured benchmark and not a speedup.</p>
    <div class="banner">
      <div>Time ${escapeHtml(view.time)} · ${escapeHtml(view.timeLabel)} · severity ${escapeHtml(view.timeSeverity || 'not returned')}</div>
      <div>Space ${escapeHtml(view.space)} · ${escapeHtml(view.spaceLabel)} · severity ${escapeHtml(view.spaceSeverity || 'not returned')}</div>
      <div class="meta">${escapeHtml(view.fileName)} · ${escapeHtml(view.language)} · pattern ${escapeHtml(view.pattern || 'not returned')} · function ${escapeHtml(view.functionName || 'not returned')} · basis ${escapeHtml(view.basisLabel || view.basis || 'not returned')}</div>
    </div>
    <section>
      <h2>Requested targets</h2>
      <p>Time ${escapeHtml(view.targetTime || 'not returned')} · space ${escapeHtml(view.targetSpace || 'not returned')}</p>
      <p class="meta">${escapeHtml(view.targetGoal)}</p>
    </section>
    ${unrun}
    ${noteList}
  `);
}

export function renderOptimizeHtml(view: OptimizeView): string {
  const reasons = view.reasons.length
    ? `<ul>${view.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join('')}</ul>`
    : '<p class="meta">No reasons were returned.</p>';
  const rewrite = view.appliedTransform
    ? 'The Brain returned a suggested rewrite. It was not applied to the editor and was not measured.'
    : 'No rewrite was applied. Any optimized complexity below is a target or estimate, not a measured speedup.';
  return page('EYRA optimization', `
    <p class="meta">Suggestion only. This is not a measured performance improvement.</p>
    <div class="banner">
      <div>${escapeHtml(rewrite)}</div>
      <div class="meta">applied_transform ${escapeHtml(String(view.appliedTransform))} · ${escapeHtml(view.reasoningSource || 'source not returned')}</div>
      <div>Current estimate ${escapeHtml(view.currentTime || 'not returned')} time / ${escapeHtml(view.currentSpace || 'not returned')} space</div>
      <div>Suggested target ${escapeHtml(view.optimizedTime || 'not returned')} time / ${escapeHtml(view.optimizedSpace || 'not returned')} space</div>
    </div>
    ${reasons}
    ${section('Suggested code', view.optimizedCode)}
  `);
}
