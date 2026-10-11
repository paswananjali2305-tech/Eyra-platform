import { useCallback, useMemo, useState } from 'react';
import { CodeEditor } from '../../components/ide/CodeEditor.jsx';
import { FileTabBar } from '../../components/ide/FileTabBar.jsx';
import { useEyra } from '../../context/EyraContext.jsx';
import { FILE_CONTENTS } from '../../data/mockRepo.js';
import { useOpenTabs } from '../../hooks/useOpenTabs.js';

const HITL_STEPS = [
  { id: 'suggests', label: 'Suggests' },
  { id: 'reviews', label: 'Reviews' },
  { id: 'approves', label: 'Approves' },
  { id: 'applies', label: 'Applies' },
];

const NEW_FILE_TEMPLATE = `# New scratch file — write or paste code here

def main():
    pass


if __name__ == "__main__":
    main()
`;

function linesToText(lines) {
  if (!lines?.length) return '';
  return lines.map((l) => (typeof l === 'string' ? l : l?.text ?? '')).join('\n');
}

/**
 * Runtime Debugging — editor + tabs (+ new file) + terminal + ScopeBot.
 */
export function ScopeBotWorkspace({
  loading = false,
  statusNote = '',
  statusError = '',
  execResult = null,
  onAnalyze,
  onSandbox,
  onCopyPatch,
}) {
  const { showToast, activeResult, status } = useEyra();
  const { openTabs, activeId, setActiveId, openFile, closeTab } = useOpenTabs([
    'test.py',
    'main.py',
    'auth/jwt_handler.py',
  ]);
  const [scratchFiles, setScratchFiles] = useState({});
  const [scratchSeq, setScratchSeq] = useState(1);
  /** Edits to mockRepo / opened files — enables analyzing the active buffer, not a frozen SAMPLE. */
  const [bufferEdits, setBufferEdits] = useState({});
  const [consoleTab, setConsoleTab] = useState('logs');
  const [hitlStep, setHitlStep] = useState(0);

  const isScratch = Boolean(activeId && scratchFiles[activeId]);
  const file = isScratch
    ? scratchFiles[activeId]
    : FILE_CONTENTS[activeId] || FILE_CONTENTS['test.py'];
  const mockFinding = isScratch ? null : file.finding;

  const bufferText = isScratch
    ? file?.text || ''
    : bufferEdits[activeId] != null
      ? bufferEdits[activeId]
      : linesToText(file?.lines);

  const buildPayload = useCallback(() => {
    const baseName = (activeId || 'test.py').split('/').pop() || 'test.py';
    const langRaw = String(file?.language || 'python').toLowerCase();
    return {
      file_name: baseName,
      language: langRaw.includes('py') ? 'python' : langRaw.split(/\s+/)[0] || 'python',
      code_snippet: bufferText,
      terminal_output: activeResult?.terminal_output || '',
      stack_trace: activeResult?.stack_trace || '',
      error_type: activeResult?.error_type || undefined,
      project_name: activeResult?.project_name || 'default',
    };
  }, [activeId, file?.language, bufferText, activeResult]);

  /** Prefer live Brain result; keep mock finding as visual fallback. */
  const finding = useMemo(() => {
    if (activeResult) {
      const lineHint =
        mockFinding?.line ||
        (() => {
          const m = String(activeResult.stack_trace || '').match(/line (\d+)/i);
          return m ? Number(m[1]) : null;
        })();
      const evidence0 = activeResult.evidence?.[0];
      const evidence1 = activeResult.evidence?.[1];
      return {
        title: activeResult.error_type || mockFinding?.title || 'Runtime fault',
        summary: activeResult.root_cause || activeResult.explanation || mockFinding?.summary,
        line: lineHint,
        cwe: evidence0?.kind || activeResult.verification?.status || mockFinding?.cwe || 'Runtime',
        impact:
          evidence1?.detail ||
          activeResult.error_summary ||
          activeResult.explanation ||
          mockFinding?.impact,
        patch:
          activeResult.suggested_correction?.diff_unified ||
          activeResult.suggested_correction?.corrected_code ||
          mockFinding?.patch ||
          '',
        verification: activeResult.verification,
      };
    }
    return mockFinding;
  }, [activeResult, mockFinding]);

  const certaintyLabel = useMemo(() => {
    if (activeResult?.confidence != null && !Number.isNaN(Number(activeResult.confidence))) {
      const c = Number(activeResult.confidence);
      const pct = c <= 1 ? c * 100 : c;
      return `${pct.toFixed(1)}% Certainty`;
    }
    return '99.2% Certainty';
  }, [activeResult]);

  const modelLabel = useMemo(() => {
    const model = status?.groq_model_runtime || status?.groq_model || 'local heuristic';
    const src = activeResult?.reasoning_source || (status?.groq_configured ? 'groq' : 'local');
    return `${model} · ${src}`;
  }, [status, activeResult]);

  const exitCode = execResult
    ? execResult.exit_code
    : finding
      ? 1
      : 0;

  const tabItems = useMemo(
    () =>
      openTabs.map((id) => ({
        id,
        name: id.split('/').pop(),
        dirty: scratchFiles[id] ? true : FILE_CONTENTS[id]?.dirty,
        severity: scratchFiles[id] ? null : FILE_CONTENTS[id]?.finding ? 'critical' : null,
      })),
    [openTabs, scratchFiles],
  );

  const dirtyIds = useMemo(() => {
    const set = new Set();
    for (const id of openTabs) {
      if (scratchFiles[id] || FILE_CONTENTS[id]?.dirty || bufferEdits[id] != null) set.add(id);
    }
    return set;
  }, [openTabs, scratchFiles, bufferEdits]);

  const addNewFile = useCallback(() => {
    const id = `scratch/untitled-${scratchSeq}.py`;
    setScratchSeq((n) => n + 1);
    setScratchFiles((prev) => ({
      ...prev,
      [id]: {
        language: 'Python 3.11',
        dirty: true,
        finding: null,
        text: NEW_FILE_TEMPLATE,
      },
    }));
    openFile(id);
  }, [openFile, scratchSeq]);

  const handleClose = useCallback(
    (id) => {
      closeTab(id);
      if (scratchFiles[id]) {
        setScratchFiles((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }
    },
    [closeTab, scratchFiles],
  );

  return (
    <div className="flex h-[calc(100vh-3.5rem)] w-full flex-col overflow-hidden select-none">
      <header className="z-30 flex h-11 shrink-0 items-center justify-between gap-space-md border-b border-outline-variant/20 bg-surface-container-lowest px-space-md">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={loading}
            onClick={() => {
              setHitlStep(0);
              onAnalyze?.(buildPayload());
            }}
            className="flex items-center gap-1 rounded bg-surface-container px-2 py-1 font-label-sm text-label-sm text-on-surface transition-colors hover:bg-surface-container-high disabled:opacity-40"
          >
            <span className="material-symbols-outlined text-[14px] text-primary">replay</span>
            <span>Re-run in Debug Mode</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setConsoleTab('stack');
              showToast?.('Stepped into frame (demo)', 'info');
            }}
            className="flex items-center gap-1 rounded bg-surface-container px-2 py-1 font-label-sm text-label-sm text-on-surface transition-colors hover:bg-surface-container-high"
          >
            <span className="material-symbols-outlined text-[14px]">subdirectory_arrow_right</span>
            <span>Step Into (F11)</span>
          </button>
          <button
            type="button"
            onClick={() => {
              if (finding?.line) {
                showToast?.(`AST focus → ${activeId}:${finding.line}`, 'info');
              } else {
                showToast?.('No AST finding on this file', 'info');
              }
              setConsoleTab('logs');
            }}
            className="flex items-center gap-1 rounded bg-surface-container px-2 py-1 font-label-sm text-label-sm text-on-surface transition-colors hover:bg-surface-container-high"
          >
            <span className="material-symbols-outlined text-[14px]">account_tree</span>
            <span>Inspect AST Node</span>
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => {
              setConsoleTab('output');
              setHitlStep(1);
              (onSandbox || onAnalyze)?.(buildPayload());
            }}
            className="flex items-center gap-1 rounded bg-secondary-container/40 px-2 py-1 font-label-sm text-label-sm font-semibold text-secondary transition-colors hover:bg-secondary-container/55 disabled:opacity-40"
          >
            <span className="material-symbols-outlined text-[14px]">deployed_code</span>
            <span>Run Sandbox Container</span>
          </button>
        </div>
        {(statusNote || statusError || loading) && (
          <span
            className={`max-w-xs truncate font-code-compact text-code-compact ${
              statusError ? 'text-error' : 'text-tertiary'
            }`}
          >
            {loading ? 'Investigating…' : statusError || statusNote}
          </span>
        )}
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden bg-surface-container-lowest">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <FileTabBar
            tabs={tabItems}
            activeId={activeId}
            dirtyIds={dirtyIds}
            onSelect={setActiveId}
            onClose={handleClose}
            onAdd={addNewFile}
          />

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {activeId ? (
              <CodeEditor
                path={activeId}
                language={file.language}
                editable
                value={bufferText}
                onChange={(text) => {
                  if (isScratch) {
                    setScratchFiles((prev) => ({
                      ...prev,
                      [activeId]: { ...prev[activeId], text, dirty: true },
                    }));
                  } else {
                    setBufferEdits((prev) => ({ ...prev, [activeId]: text }));
                  }
                }}
                findingLine={finding?.line}
                findingLabel={finding?.title}
                metaRight={
                  <>
                    <span className="font-code-compact text-code-compact text-outline">
                      UTF-8 · LF · Spaces: 4
                    </span>
                    {file.dirty || isScratch || bufferEdits[activeId] != null ? (
                      <span className="text-[10px] text-tertiary">● Modified</span>
                    ) : null}
                    <span className="font-label-sm text-label-sm text-outline">{file.language}</span>
                  </>
                }
              />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-surface">
                <p className="font-body-sm text-body-sm text-on-surface-variant">
                  No file open — add a new code tab to get started.
                </p>
                <button
                  type="button"
                  onClick={addNewFile}
                  className="flex items-center gap-1.5 rounded bg-primary-container px-space-md py-1.5 font-label-md text-label-md font-semibold text-on-primary-container"
                >
                  <span className="material-symbols-outlined text-[16px]">add</span>
                  New code file
                </button>
              </div>
            )}

            <section className="flex h-40 shrink-0 flex-col border-t border-outline-variant/20 bg-surface-container-lowest">
              <div className="flex h-8 shrink-0 items-center justify-between bg-surface-container-low px-space-sm">
                <div className="flex h-full items-center gap-0.5">
                  {[
                    { id: 'logs', label: 'Terminal / Runtime Logs', icon: 'terminal' },
                    {
                      id: 'stack',
                      label: `Stack Trace (${(activeResult?.stack_trace || finding) ? 1 : 0})`,
                      icon: null,
                    },
                    { id: 'output', label: 'Execution Output', icon: null, hideSm: true },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setConsoleTab(tab.id)}
                      className={`flex h-full items-center gap-1.5 px-space-md font-label-sm text-label-sm ${
                        tab.hideSm ? 'hidden sm:flex' : ''
                      } ${
                        consoleTab === tab.id
                          ? 'bg-surface-container-lowest font-medium text-primary'
                          : 'text-on-surface-variant hover:text-on-surface'
                      }`}
                    >
                      {tab.icon ? (
                        <span className="material-symbols-outlined text-[13px]">{tab.icon}</span>
                      ) : null}
                      {tab.label}
                    </button>
                  ))}
                </div>
                <span
                  className={`flex items-center gap-1 rounded px-1.5 py-0.5 font-code-compact text-code-compact ${
                    exitCode
                      ? 'bg-error-container/30 text-error'
                      : 'bg-tertiary-container/30 text-tertiary'
                  }`}
                >
                  Exit code {exitCode}
                </span>
              </div>
              <div className="flex flex-1 flex-col gap-1 overflow-y-auto p-space-sm font-code-compact text-code-compact text-on-surface">
                {consoleTab === 'logs' ? (
                  <>
                    <div className="text-outline">
                      $ /usr/local/bin/python3 /workspace/backend-api/{activeId || 'test.py'}
                    </div>
                    {execResult?.stderr || activeResult?.terminal_output || finding ? (
                      <div className="flex items-center gap-1 pt-0.5 font-semibold text-error">
                        <span className="material-symbols-outlined text-[14px]">error</span>
                        {execResult?.error_type ||
                          activeResult?.error_type ||
                          finding?.title ||
                          'Runtime fault'}
                      </div>
                    ) : (
                      <div className="text-tertiary">Process finished with exit code 0.</div>
                    )}
                    {execResult?.stdout ? (
                      <div className="whitespace-pre-wrap text-on-surface-variant">{execResult.stdout}</div>
                    ) : null}
                  </>
                ) : null}
                {consoleTab === 'stack' ? (
                  (activeResult?.stack_trace || finding) ? (
                    <>
                      {activeResult?.stack_trace ? (
                        <div className="whitespace-pre-wrap text-on-surface-variant">
                          {activeResult.stack_trace}
                        </div>
                      ) : (
                        <>
                          <div className="text-on-surface-variant">
                            Traceback (most recent call last):
                          </div>
                          <div className="pl-4 text-on-surface-variant">
                            File{' '}
                            <span className="text-primary">
                              &quot;/workspace/backend-api/{activeId}&quot;
                            </span>
                            , line {finding.line}, in{' '}
                            <span className="text-secondary">&lt;module&gt;</span>
                          </div>
                          <div className="font-semibold text-error">{finding.title}</div>
                          <div className="text-on-surface-variant">{finding.summary}</div>
                        </>
                      )}
                    </>
                  ) : (
                    <div className="text-tertiary">No stack trace for this file.</div>
                  )
                ) : null}
                {consoleTab === 'output' ? (
                  execResult || finding || activeResult ? (
                    <>
                      <div className="text-outline">{execResult?.ok ? 'stdout' : 'stderr'}</div>
                      <div className="whitespace-pre-wrap text-error">
                        {execResult?.stderr ||
                          activeResult?.terminal_output ||
                          finding?.title ||
                          ''}
                      </div>
                      <div className="whitespace-pre-wrap text-on-surface-variant">
                        {execResult?.stdout ||
                          activeResult?.verification?.detail ||
                          finding?.impact ||
                          ''}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-outline">stdout</div>
                      <div className="text-tertiary">(no output)</div>
                    </>
                  )
                ) : null}
              </div>
            </section>
          </div>
        </div>

        <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-outline-variant/25 bg-surface-container-low 2xl:w-96">
          <div className="flex items-center justify-between bg-surface-container-lowest p-space-sm">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded bg-primary-container text-on-primary-container shadow-[0_0_12px_rgba(53,214,242,0.35)]">
                <span className="material-symbols-outlined text-[16px]">smart_toy</span>
              </div>
              <div className="flex flex-col">
                <span className="font-headline-sm text-headline-sm leading-tight text-on-surface">
                  ScopeBot Online
                </span>
                <span className="font-label-sm text-[10px] text-tertiary">{modelLabel}</span>
              </div>
            </div>
            <button
              type="button"
              aria-label="ScopeBot settings"
              onClick={() => showToast?.('ScopeBot uses Brain /api/analyze', 'info')}
              className="rounded p-1 text-outline hover:bg-surface-container hover:text-on-surface"
            >
              <span className="material-symbols-outlined text-[16px]">settings</span>
            </button>
          </div>

          <div className="flex flex-col gap-space-md p-space-md">
            {finding ? (
              <>
                <div className="flex flex-col gap-2 rounded bg-surface-container p-space-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-label-sm text-label-sm uppercase text-outline">
                      Root-Cause Analysis
                    </span>
                    <span className="rounded bg-tertiary-container/20 px-1.5 py-0.5 font-label-sm text-[10px] text-tertiary">
                      {certaintyLabel}
                    </span>
                  </div>
                  <p className="font-body-md text-body-md leading-snug text-on-surface">
                    {finding.summary}
                  </p>
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="font-label-sm text-label-sm uppercase tracking-wider text-outline">
                    Evidence Engine
                  </span>
                  <div className="flex flex-col gap-1 rounded bg-surface-container-lowest p-2 font-code-compact text-code-compact">
                    <div className="flex items-center gap-1 text-[11px] text-tertiary">
                      <span className="material-symbols-outlined text-[13px]">check_circle</span>
                      <span>[CONFIRMED FACT]</span>
                    </div>
                    <span className="text-[11px] text-on-surface-variant">
                      Issue at <span className="text-primary">{activeId}:{finding.line}</span> ·{' '}
                      {finding.cwe}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1 rounded bg-surface-container p-2 font-code-compact text-code-compact">
                    <div className="flex items-center gap-1 text-[11px] text-secondary">
                      <span className="material-symbols-outlined text-[13px]">science</span>
                      <span>[IMPACT]</span>
                    </div>
                    <span className="text-[11px] text-on-surface-variant">{finding.impact}</span>
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <span className="font-label-sm text-label-sm uppercase text-outline">
                      Proposed Patch Diff
                    </span>
                    <span className="rounded bg-surface-container-high px-1.5 py-0.5 font-label-sm text-[10px] text-on-surface-variant">
                      unified git diff
                    </span>
                  </div>
                  <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-surface-container-lowest p-2 font-code-compact text-code-compact text-on-surface-variant">
                    {finding.patch}
                  </pre>
                </div>
              </>
            ) : (
              <div className="rounded bg-surface-container p-space-md text-center">
                <span className="material-symbols-outlined text-[28px] text-tertiary">verified</span>
                <p className="mt-2 font-body-sm text-body-sm text-on-surface-variant">
                  No runtime exception on this file. Open <strong className="text-primary">test.py</strong>{' '}
                  to inspect the ZeroDivisionError session.
                </p>
              </div>
            )}

            <div className="flex flex-col gap-2 border-t border-outline-variant/20 pt-space-sm">
              <span className="font-label-sm text-label-sm uppercase tracking-wider text-outline">
                Human-in-the-Loop Governance
              </span>
              <div className="flex items-center gap-1">
                {HITL_STEPS.map((step, i) => (
                  <div key={step.id} className="flex min-w-0 flex-1 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setHitlStep(i)}
                      className={`flex w-full flex-col items-center gap-0.5 rounded px-1 py-1.5 ${
                        i <= hitlStep
                          ? 'bg-primary-container/20 text-primary'
                          : 'bg-surface-container text-outline'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[14px]">
                        {i <= hitlStep ? 'radio_button_checked' : 'radio_button_unchecked'}
                      </span>
                      <span className="truncate font-label-sm text-[10px] font-medium">{step.label}</span>
                    </button>
                    {i < HITL_STEPS.length - 1 ? (
                      <span className="material-symbols-outlined shrink-0 text-[12px] text-outline-variant">
                        chevron_right
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                Status: {HITL_STEPS[hitlStep]?.label || 'Suggested'}
                {activeResult?.verification?.status
                  ? ` · verify ${activeResult.verification.status}`
                  : ''}{' '}
                — human approval required before apply.
              </p>
              <button
                type="button"
                disabled={loading}
                onClick={() => {
                  setHitlStep(1);
                  setConsoleTab('output');
                  (onSandbox || onAnalyze)?.(buildPayload());
                }}
                className="flex w-full items-center justify-center gap-2 rounded bg-surface-container-high px-space-sm py-2 font-label-sm text-label-sm font-semibold text-on-surface hover:bg-surface-bright disabled:opacity-40"
              >
                <span className="material-symbols-outlined text-[15px] text-primary">play_circle</span>
                Run Sandbox Verification
              </button>
              <button
                type="button"
                onClick={async () => {
                  setHitlStep(3);
                  await onCopyPatch?.();
                  showToast?.(
                    'Suggested patch copied — not applied to disk (review/copy only)',
                    'info',
                  );
                }}
                className="flex w-full items-center justify-center gap-2 rounded bg-primary-container px-space-sm py-2 font-label-sm text-label-sm font-semibold text-on-primary-container shadow-[0_0_12px_rgba(53,214,242,0.3)] hover:brightness-110"
              >
                <span className="material-symbols-outlined text-[15px]">done_all</span>
                Approve &amp; Apply to VS Code
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
