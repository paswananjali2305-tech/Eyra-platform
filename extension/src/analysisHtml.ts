import type { AnalyzeResult } from './parse';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function block(title: string, text: string): string {
  if (!text.trim()) {
    return '';
  }
  return `<section><h2>${escapeHtml(title)}</h2><p>${escapeHtml(text)}</p></section>`;
}

export function renderAnalysisHtml(input: {
  result: AnalyzeResult;
  localPath: string;
  startLine: number;
  endLine: number;
  nonce: string;
}): string {
  const result = input.result;
  const verified = result.verification.status === 'verified' && !result.verification.is_hypothesis_only;
  const verificationNote = verified
    ? `The Brain reported verification status "${result.verification.status}". The editor file was not changed.`
    : `Verification status: ${result.verification.status || 'not returned'}. This proposal was not applied and was not confirmed in the editor.`;
  const evidence = result.evidence.length
    ? `<ul>${result.evidence.map((item) => `<li><strong>${escapeHtml(item.kind || 'note')}</strong> ${escapeHtml(item.detail)}${item.location ? ` <span class="meta">${escapeHtml(item.location)}</span>` : ''}</li>`).join('')}</ul>`
    : '<p class="meta">No evidence items were returned.</p>';
  const timeline = result.execution_timeline.length
    ? `<ol>${result.execution_timeline.map((item) => `<li><strong>${escapeHtml(item.step)}</strong> ${escapeHtml(item.detail)} <span class="meta">${escapeHtml(item.status || '')}</span></li>`).join('')}</ol>`
    : '<p class="meta">No timeline was returned.</p>';
  const suggestion = result.suggested_correction.corrected_code.trim()
    ? `<pre>${escapeHtml(result.suggested_correction.corrected_code)}</pre>`
    : '<p class="meta">No corrected code was returned.</p>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${input.nonce}';" />
  <title>EYRA analysis</title>
  <style>
    body { margin: 0; padding: 20px 24px 40px; background: #0e131e; color: #dee2f2; font-family: Inter, Segoe UI, sans-serif; font-size: 13px; line-height: 1.5; }
    h1 { margin: 0; color: #35d6f2; font-size: 20px; letter-spacing: 0.04em; }
    h2 { margin: 18px 0 6px; font-size: 13px; color: #9cedff; }
    .meta { color: #859397; }
    .banner { margin: 12px 0; padding: 10px 12px; border: 1px solid rgba(60,73,76,0.8); background: #161b27; border-radius: 8px; }
    pre { white-space: pre-wrap; word-break: break-word; background: #090e19; border: 1px solid rgba(60,73,76,0.7); padding: 10px; border-radius: 8px; font-family: "JetBrains Mono", Consolas, monospace; font-size: 12px; }
    button { border: none; border-radius: 4px; background: #35d6f2; color: #00363f; font-weight: 650; padding: 7px 10px; cursor: pointer; }
    ul, ol { padding-left: 18px; }
  </style>
</head>
<body>
  <h1>EYRA</h1>
  <p class="meta">Analysis proposal · not applied to the file</p>
  <div class="banner">
    <div>${escapeHtml(result.error_type || 'No error type')} · ${escapeHtml(result.session_id)}</div>
    <div class="meta">${escapeHtml(input.localPath)} · lines ${input.startLine}–${input.endLine}</div>
    <div class="meta">Brain file name: ${escapeHtml(result.file_name)} · ${escapeHtml(result.language)} · ${escapeHtml(result.reasoning_source)}</div>
  </div>
  <button id="reveal" type="button">Show in editor</button>
  ${block('Summary', result.error_summary)}
  ${block('Root cause', result.root_cause)}
  ${block('Explanation', result.explanation)}
  <section><h2>Evidence</h2>${evidence}</section>
  <section><h2>Timeline</h2>${timeline}</section>
  <section>
    <h2>Suggested correction</h2>
    <p>${escapeHtml(result.suggested_correction.summary)}</p>
    <p class="meta">apply_mode: ${escapeHtml(result.suggested_correction.apply_mode || 'not returned')}. ${escapeHtml(verificationNote)}</p>
    ${suggestion}
  </section>
  ${block('Verification detail', result.verification.detail)}
  ${block('Verification method', result.verification.method)}
  ${block('Reasoning note', result.reasoning_note)}
  <script nonce="${input.nonce}">
    const vscode = acquireVsCodeApi();
    document.getElementById('reveal').addEventListener('click', () => {
      vscode.postMessage({ type: 'reveal' });
    });
  </script>
</body>
</html>`;
}
