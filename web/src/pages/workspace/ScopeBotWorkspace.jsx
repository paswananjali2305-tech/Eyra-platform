import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CodeEditor } from '../../components/ide/CodeEditor.jsx';
import { FileTabBar } from '../../components/ide/FileTabBar.jsx';
import { EyraAssistantChat } from '../../components/EyraAssistantChat.jsx';
import { useEyra } from '../../context/EyraContext.jsx';
import { useOpenTabs } from '../../hooks/useOpenTabs.js';
import {
  AUDIT_LANGUAGES,
  apiLanguageFromId,
  languageById,
  languageIdFromPath,
} from '../../lib/auditLanguages.js';
import { auditFileText } from '../../lib/liveFileAudit.js';
import { LanguageSelect } from '../../components/ide/LanguageLogo.jsx';
import { loadWorkspaceSlice, saveWorkspaceSlice } from '../../lib/workspaceDraft.js';

const DEFAULT_LANG = 'Python';
const LIVE_DEBOUNCE_MS = 900;

function scratchPath(seq, langId) {
  const id = langId || DEFAULT_LANG;
  const lang = languageById(id);
  return `scratch/untitled-${seq}.${lang.ext || 'py'}`;
}

const CONSOLE_TABS = new Set(['terminal', 'output', 'debug']);

function defaultEditor() {
  const initialPath = scratchPath(1, DEFAULT_LANG);
  const lang = languageById(DEFAULT_LANG);
  const text = lang.template || '';
  return {
    scratchFiles: {
      [initialPath]: {
        languageId: DEFAULT_LANG,
        language: lang.label,
        dirty: true,
        text,
      },
    },
    openTabs: [initialPath],
    activeId: initialPath,
    scratchSeq: 2,
    savedSnapshot: { [initialPath]: text },
    consoleTab: 'terminal',
    syncedSnippet: '',
    newFileLangId: DEFAULT_LANG,
  };
}

function bootEditor() {
  const saved = loadWorkspaceSlice('editor');
  const filesIn = saved?.scratchFiles;
  if (!filesIn || typeof filesIn !== 'object') return defaultEditor();

  /** @type {Record<string, { languageId: string, language: string, dirty: boolean, text: string }>} */
  const scratchFiles = {};
  for (const [path, file] of Object.entries(filesIn)) {
    if (!path || !file || typeof file.text !== 'string') continue;
    const languageId = file.languageId || languageIdFromPath(path);
    const lang = languageById(languageId);
    scratchFiles[path] = {
      languageId,
      language: typeof file.language === 'string' ? file.language : lang.label,
      dirty: Boolean(file.dirty),
      text: file.text,
    };
  }
  const openTabs = (Array.isArray(saved.openTabs) ? saved.openTabs : Object.keys(scratchFiles)).filter(
    (id) => scratchFiles[id],
  );
  if (!openTabs.length) return defaultEditor();

  const activeId = openTabs.includes(saved.activeId) ? saved.activeId : openTabs[0];
  /** @type {Record<string, string>} */
  const savedSnapshot = {};
  if (saved.savedSnapshot && typeof saved.savedSnapshot === 'object') {
    for (const id of openTabs) {
      if (typeof saved.savedSnapshot[id] === 'string') savedSnapshot[id] = saved.savedSnapshot[id];
    }
  }
  let scratchSeq = 2;
  for (const path of Object.keys(scratchFiles)) {
    const match = /untitled-(\d+)\./.exec(path);
    if (match) scratchSeq = Math.max(scratchSeq, Number(match[1]) + 1);
  }
  if (Number.isFinite(saved.scratchSeq) && saved.scratchSeq >= scratchSeq) {
    scratchSeq = saved.scratchSeq;
  }
  const langId = scratchFiles[activeId]?.languageId || DEFAULT_LANG;
  return {
    scratchFiles,
    openTabs,
    activeId,
    scratchSeq,
    savedSnapshot,
    consoleTab: CONSOLE_TABS.has(saved.consoleTab) ? saved.consoleTab : 'terminal',
    syncedSnippet: typeof saved.syncedSnippet === 'string' ? saved.syncedSnippet : '',
    newFileLangId: languageById(saved.newFileLangId || langId).id || langId,
  };
}

function downloadTextFile(filename, text) {
  const blob = new Blob([text ?? ''], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'untitled.txt';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Runtime Debugging — multi-language editor + save/download + live ScopeBot sync.
 */
export function ScopeBotWorkspace({
  loading = false,
  statusNote = '',
  statusError = '',
  execResult = null,
  runtimePulse = null,
  onAnalyze,
  onSandbox,
  onCopyPatch,
  onClearConsole,
}) {
  const { showToast, activeResult, status, adoptResult } = useEyra();
  const bootRef = useRef(null);
  if (!bootRef.current) bootRef.current = bootEditor();
  const boot = bootRef.current;
  const { openTabs, activeId, setActiveId, openFile, closeTab } = useOpenTabs(
    boot.openTabs,
    boot.activeId,
  );
  const [scratchFiles, setScratchFiles] = useState(boot.scratchFiles);
  const [scratchSeq, setScratchSeq] = useState(boot.scratchSeq);
  const [newFileLangId, setNewFileLangId] = useState(boot.newFileLangId);
  const [savedSnapshot, setSavedSnapshot] = useState(boot.savedSnapshot);
  const [consoleTab, setConsoleTab] = useState(boot.consoleTab);
  const [liveWatching, setLiveWatching] = useState(false);
  const [syncedSnippet, setSyncedSnippet] = useState(boot.syncedSnippet);
  const analyzeGen = useRef(0);
  const loadingRef = useRef(loading);
  const onAnalyzeRef = useRef(onAnalyze);
  const bufferRef = useRef('');
  const payloadRef = useRef(null);
  loadingRef.current = loading;
  onAnalyzeRef.current = onAnalyze;

  const file = (activeId && scratchFiles[activeId]) || null;
  const languageId =
    file?.languageId || (activeId ? languageIdFromPath(activeId) : DEFAULT_LANG);
  const langMeta = languageById(languageId);
  const bufferText = file?.text ?? '';
  bufferRef.current = bufferText;

  const dirty = useMemo(() => {
    if (!activeId) return false;
    const baseline = savedSnapshot[activeId];
    if (baseline == null) return Boolean(file?.dirty);
    return bufferText !== baseline;
  }, [activeId, bufferText, savedSnapshot, file?.dirty]);

  const buildPayload = useCallback(() => {
    const baseName = (activeId || `untitled.${langMeta.ext}`).split('/').pop() || 'untitled.py';
    return {
      file_name: baseName,
      language: apiLanguageFromId(languageId),
      code_snippet: bufferText,
      terminal_output: activeResult?.terminal_output || '',
      stack_trace: activeResult?.stack_trace || '',
      error_type: activeResult?.error_type || undefined,
      project_name: activeResult?.project_name || 'default',
    };
  }, [activeId, languageId, langMeta.ext, bufferText, activeResult]);

  payloadRef.current = buildPayload;

  const editorSnap = useRef(null);
  editorSnap.current = {
    scratchFiles,
    openTabs,
    activeId,
    scratchSeq,
    savedSnapshot,
    consoleTab,
    syncedSnippet,
    newFileLangId,
  };
  useEffect(() => {
    saveWorkspaceSlice('editor', editorSnap.current);
    return () => saveWorkspaceSlice('editor', editorSnap.current);
  }, [
    scratchFiles,
    openTabs,
    activeId,
    scratchSeq,
    savedSnapshot,
    consoleTab,
    syncedSnippet,
    newFileLangId,
  ]);

  /** Instant local checks while typing (same engine as Code Audit editor). */
  const liveFindings = useMemo(
    () => (activeId ? auditFileText(activeId, bufferText) : []),
    [activeId, bufferText],
  );
  const liveFinding = liveFindings[0] || null;

  /** Brain result when it matches current buffer; otherwise prefer live finding. */
  const brainSynced = Boolean(activeResult) && syncedSnippet === bufferText;
  const brainHasFault = useMemo(() => {
    if (!brainSynced || !activeResult) return false;
    const t = String(activeResult.error_type || '').trim();
    if (!t || /^none$/i.test(t) || t === 'null' || t === 'undefined') return false;
    const st = String(activeResult.status || '').toLowerCase();
    if (st === 'verified' && !activeResult.stack_trace && !activeResult.error_summary) return false;
    return true;
  }, [brainSynced, activeResult]);
  const finding = useMemo(() => {
    if (brainHasFault && activeResult) {
      const lineHint = (() => {
        const m = String(activeResult.stack_trace || '').match(/line (\d+)/i);
        return m ? Number(m[1]) : liveFinding?.line || null;
      })();
      const evidence0 = activeResult.evidence?.[0];
      const evidence1 = activeResult.evidence?.[1];
      return {
        source: 'brain',
        title: activeResult.error_type || 'Runtime fault',
        summary: activeResult.root_cause || activeResult.explanation || '',
        line: lineHint,
        cwe: evidence0?.kind || activeResult.verification?.status || 'Runtime',
        impact: evidence1?.detail || activeResult.error_summary || activeResult.explanation || '',
        patch:
          activeResult.suggested_correction?.diff_unified ||
          activeResult.suggested_correction?.corrected_code ||
          '',
        verification: activeResult.verification,
      };
    }
    if (liveFinding) {
      return {
        source: 'live',
        title: liveFinding.title,
        summary: liveFinding.summary,
        line: liveFinding.line,
        cwe: liveFinding.cwe || 'LIVE',
        impact: liveFinding.impact || liveFinding.summary,
        patch: liveFinding.patch || '',
        verification: null,
      };
    }
    return null;
  }, [brainHasFault, activeResult, liveFinding]);

  const modelLabel = useMemo(() => {
    const model = status?.groq_model_runtime || status?.groq_model || 'local heuristic';
    const src = activeResult?.reasoning_source || (status?.groq_configured ? 'groq' : 'local');
    return `${model} · ${src}`;
  }, [status, activeResult]);

  const exitCode = execResult != null ? execResult.exit_code : null;
  const execStatus = execResult?.status || null;

  const runCommandLine = useMemo(() => {
    const lang = apiLanguageFromId(languageId);
    const file = (activeId || 'untitled').split('/').pop() || 'untitled';
    if (lang === 'python') return `python ${file}`;
    if (lang === 'javascript') return `node ${file}`;
    if (lang === 'typescript') return `tsx ${file}`;
    if (lang === 'java') return `javac ${file} && java Main`;
    if (lang === 'go') return `go run ${file}`;
    if (lang === 'c') return `gcc ${file} -o program && ./program`;
    if (lang === 'cpp') return `g++ ${file} -o program && ./program`;
    return `run ${lang} ${file}`;
  }, [languageId, activeId]);

  const clearConsole = useCallback(() => {
    onClearConsole?.();
    showToast?.('Terminal cleared', 'info');
  }, [onClearConsole, showToast]);

  /** Debug Logs status color: green ok · red fail · amber pause/timeout · cyan running */
  const debugTone = useMemo(() => {
    if (loading && !execResult) {
      return {
        key: 'running',
        label: 'RUNNING',
        icon: 'pending',
        badge: 'bg-primary/20 text-primary border-primary/40',
        line: 'text-primary',
        detail: 'Sandbox execution in progress…',
      };
    }
    if (!execResult) {
      return {
        key: 'idle',
        label: 'IDLE',
        icon: 'pause_circle',
        badge: 'bg-outline-variant/20 text-outline border-outline-variant/40',
        line: 'text-outline',
        detail: 'Waiting for Run',
      };
    }
    const st = String(execResult.status || '');
    if (execResult.ok || st === 'SUCCESS') {
      return {
        key: 'ok',
        label: 'SUCCESS',
        icon: 'check_circle',
        badge: 'bg-tertiary-container/30 text-tertiary border-tertiary/40',
        line: 'text-tertiary',
        detail: 'Run completed successfully',
      };
    }
    if (st === 'TIMEOUT' || execResult.timed_out) {
      return {
        key: 'pause',
        label: 'TIMEOUT',
        icon: 'hourglass_empty',
        badge: 'bg-amber-500/20 text-amber-300 border-amber-400/40',
        line: 'text-amber-300',
        detail: 'Execution timed out / paused',
      };
    }
    if (st === 'RUNTIME_UNAVAILABLE' || st === 'EXECUTION_BLOCKED') {
      return {
        key: 'pause',
        label: st === 'EXECUTION_BLOCKED' ? 'BLOCKED' : 'UNAVAILABLE',
        icon: 'pause_circle',
        badge: 'bg-amber-500/20 text-amber-300 border-amber-400/40',
        line: 'text-amber-300',
        detail: execResult.stderr || 'Runtime not ready',
      };
    }
    if (st === 'COMPILE_ERROR') {
      return {
        key: 'fail',
        label: 'COMPILE ERROR',
        icon: 'error',
        badge: 'bg-error-container/30 text-error border-error/40',
        line: 'text-error',
        detail: execResult.error_type || 'Compilation failed',
      };
    }
    return {
      key: 'fail',
      label: st || 'FAILED',
      icon: 'error',
      badge: 'bg-error-container/30 text-error border-error/40',
      line: 'text-error',
      detail: execResult.error_type || `Exit ${execResult.exit_code}`,
    };
  }, [loading, execResult]);

  const issueLines = useMemo(() => {
    /** @type {Record<number, string>} */
    const map = {};
    for (const iss of liveFindings) {
      const ln = Number(iss.line);
      if (!ln) continue;
      if (!map[ln]) map[ln] = String(iss.title || 'Issue').slice(0, 48);
    }
    if (finding?.line && !map[finding.line]) {
      map[finding.line] = String(finding.title || 'Issue').slice(0, 48);
    }
    return map;
  }, [liveFindings, finding]);

  const tabItems = useMemo(
    () =>
      openTabs.map((id) => {
        const baseline = savedSnapshot[id];
        const cur = scratchFiles[id]?.text ?? '';
        const dirtyTab = baseline == null ? Boolean(scratchFiles[id]?.dirty) : cur !== baseline;
        return {
          id,
          name: id.split('/').pop(),
          dirty: dirtyTab,
          severity: null,
          languageId: scratchFiles[id]?.languageId || languageIdFromPath(id),
        };
      }),
    [openTabs, scratchFiles, savedSnapshot],
  );

  const handleRun = useCallback(() => {
    setConsoleTab('terminal');
    (onSandbox || onAnalyze)?.(buildPayload());
  }, [onSandbox, onAnalyze, buildPayload]);

  const dirtyIds = useMemo(() => {
    const set = new Set();
    for (const id of openTabs) {
      const baseline = savedSnapshot[id];
      const cur = scratchFiles[id]?.text ?? '';
      if (baseline == null ? scratchFiles[id]?.dirty : cur !== baseline) set.add(id);
    }
    return set;
  }, [openTabs, scratchFiles, savedSnapshot]);

  const setActiveText = useCallback(
    (text) => {
      if (!activeId) return;
      setScratchFiles((prev) => ({
        ...prev,
        [activeId]: {
          ...(prev[activeId] || {
            languageId,
            language: langMeta.label,
          }),
          text,
          dirty: true,
        },
      }));
    },
    [activeId, languageId, langMeta.label],
  );

  const handleSave = useCallback(() => {
    if (!activeId) return;
    setSavedSnapshot((prev) => ({ ...prev, [activeId]: bufferText }));
    setScratchFiles((prev) => ({
      ...prev,
      [activeId]: {
        ...(prev[activeId] || {}),
        dirty: false,
        text: bufferText,
      },
    }));
    showToast?.(`Saved ${activeId.split('/').pop()}`, 'info');
  }, [activeId, bufferText, showToast]);

  const handleDownload = useCallback(() => {
    if (!activeId) return;
    const name = activeId.split('/').pop() || `untitled.${langMeta.ext}`;
    downloadTextFile(name, bufferText);
    showToast?.(`Downloaded ${name}`, 'info');
  }, [activeId, bufferText, langMeta.ext, showToast]);

  const changeEditorLanguage = useCallback(
    (nextId) => {
      if (!activeId || !nextId) return;
      const lang = languageById(nextId);
      const prev = scratchFiles[activeId];
      const prevLang = languageById(prev?.languageId || languageIdFromPath(activeId));
      const text = prev?.text ?? '';
      // Same buffer — only switch language mode (online editors do not spawn a new file)
      const stillTemplate =
        !text.trim() || text.trim() === String(prevLang.template || '').trim();
      const nextText = stillTemplate ? lang.template || text : text;

      setScratchFiles((p) => ({
        ...p,
        [activeId]: {
          ...(p[activeId] || {}),
          languageId: nextId,
          language: lang.label,
          text: nextText,
          dirty: true,
        },
      }));
      if (stillTemplate) {
        setSavedSnapshot((s) => ({ ...s, [activeId]: nextText }));
      }
      setNewFileLangId(nextId);
      showToast?.(`Language → ${lang.label}`, 'info');
    },
    [activeId, scratchFiles, showToast],
  );

  const addNewFile = useCallback(() => {
    // New tab inherits the active editor language (no duplicate top-bar picker)
    const nextLangId = languageId || newFileLangId || DEFAULT_LANG;
    const lang = languageById(nextLangId);
    const id = scratchPath(scratchSeq, nextLangId);
    setScratchSeq((n) => n + 1);
    setNewFileLangId(nextLangId);
    const text = lang.template || '';
    setScratchFiles((prev) => ({
      ...prev,
      [id]: {
        languageId: nextLangId,
        language: lang.label,
        dirty: true,
        text,
      },
    }));
    setSavedSnapshot((prev) => ({ ...prev, [id]: text }));
    openFile(id);
  }, [openFile, scratchSeq, newFileLangId, languageId]);

  const handleClose = useCallback(
    (id) => {
      closeTab(id);
      setScratchFiles((prev) => {
        if (!prev[id]) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setSavedSnapshot((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    },
    [closeTab],
  );

  const runAnalyzeNow = useCallback(async (payload) => {
    const gen = ++analyzeGen.current;
    setLiveWatching(true);
    try {
      const data = await onAnalyzeRef.current?.(payload);
      if (gen !== analyzeGen.current) return;
      if (data) setSyncedSnippet(payload.code_snippet || '');
    } finally {
      if (gen === analyzeGen.current) setLiveWatching(false);
    }
  }, []);

  // Continuous ScopeBot sync — debounced Brain analyze as you type
  useEffect(() => {
    if (!activeId) return undefined;
    const snippet = bufferText;
    if (!String(snippet || '').trim()) {
      setLiveWatching(false);
      return undefined;
    }
    if (snippet === syncedSnippet) return undefined;

    setLiveWatching(true);
    const timer = window.setTimeout(() => {
      if (loadingRef.current) return;
      const payload = payloadRef.current?.();
      if (!payload?.code_snippet?.trim()) return;
      if (payload.code_snippet === syncedSnippet) return;
      void runAnalyzeNow(payload);
    }, LIVE_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync only on editor identity/content
  }, [bufferText, activeId, languageId, syncedSnippet, runAnalyzeNow]);

  // If debounce skipped due to loading, kick again when idle
  useEffect(() => {
    if (loading) return undefined;
    if (!activeId || !String(bufferRef.current || '').trim()) return undefined;
    if (bufferRef.current === syncedSnippet) return undefined;
    const timer = window.setTimeout(() => {
      const payload = payloadRef.current?.();
      if (!payload?.code_snippet?.trim()) return;
      if (payload.code_snippet === syncedSnippet) return;
      void runAnalyzeNow(payload);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [loading, syncedSnippet, activeId, runAnalyzeNow]);

  return (
    <div className="flex h-[calc(100vh-3.5rem)] w-full flex-col overflow-hidden select-none">
      <div className="flex min-h-0 flex-1 overflow-hidden bg-surface-container-lowest">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <FileTabBar
            tabs={tabItems}
            activeId={activeId}
            dirtyIds={dirtyIds}
            onSelect={setActiveId}
            onClose={handleClose}
            onAdd={addNewFile}
            onRun={handleRun}
            runDisabled={loading || !activeId}
            runLabel="Run"
            trailing={
              activeId ? (
                <>
                  <LanguageSelect
                    value={languageId}
                    onChange={changeEditorLanguage}
                    options={AUDIT_LANGUAGES}
                    aria-label="Code language"
                  />
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={!dirty}
                    className="flex items-center gap-1 rounded bg-primary-container px-2 py-1 font-label-sm text-[11px] font-semibold text-on-primary-container disabled:cursor-not-allowed disabled:opacity-40"
                    title="Save (Ctrl+S)"
                  >
                    <span className="material-symbols-outlined text-[14px]">save</span>
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={handleDownload}
                    className="flex items-center gap-1 rounded bg-surface-container-high px-2 py-1 font-label-sm text-[11px] text-on-surface"
                    title="Download file"
                  >
                    <span className="material-symbols-outlined text-[14px]">download</span>
                    Download
                  </button>
                </>
              ) : null
            }
          />

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {activeId && file ? (
              <CodeEditor
                path={activeId}
                language={langMeta.label}
                languageId={languageId}
                editable
                value={bufferText}
                dirty={dirty}
                onChange={setActiveText}
                onSave={handleSave}
                findingLine={finding?.line}
                findingLabel={finding?.title}
                issueLines={issueLines}
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

            <section className="flex h-52 shrink-0 flex-col border-t border-outline-variant/20 bg-[#010409] sm:h-56">
              <div className="flex h-9 shrink-0 items-center justify-between border-b border-outline-variant/15 bg-surface-container-low px-space-sm">
                <div className="flex h-full min-w-0 items-center gap-0.5 overflow-x-auto">
                  {[
                    { id: 'terminal', label: 'Terminal' },
                    { id: 'output', label: 'Execution Output' },
                    { id: 'debug', label: 'Debug Logs' },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setConsoleTab(tab.id)}
                      className={`relative flex h-full shrink-0 items-center px-space-md font-label-sm text-label-sm transition-colors ${
                        consoleTab === tab.id
                          ? 'rounded-t-md border border-b-0 border-outline-variant/25 bg-[#010409] font-medium text-on-surface'
                          : 'text-on-surface-variant hover:text-on-surface'
                      }`}
                    >
                      {tab.label}
                      {consoleTab === tab.id ? (
                        <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-primary" />
                      ) : null}
                    </button>
                  ))}
                </div>
                <div className="flex shrink-0 items-center gap-1 pl-2">
                  <button
                    type="button"
                    onClick={clearConsole}
                    title="Clear terminal"
                    className="flex items-center gap-1 rounded px-1.5 py-0.5 font-label-sm text-label-sm text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
                  >
                    <span className="material-symbols-outlined text-[14px]">delete</span>
                    Clear
                  </button>
                  <span
                    className="material-symbols-outlined px-1 text-[16px] text-outline"
                    title={
                      loading
                        ? 'Running…'
                        : exitCode != null
                          ? `Exit ${exitCode}${execStatus ? ` · ${execStatus}` : ''}`
                          : 'Not run'
                    }
                    aria-hidden
                  >
                    unfold_more
                  </span>
                </div>
              </div>
              <div
                role="log"
                aria-label="Terminal output"
                aria-readonly="true"
                tabIndex={0}
                className="eyra-terminal-scroll eyra-terminal-readonly min-h-0 flex-1 cursor-default overflow-y-auto overflow-x-hidden p-space-sm font-code-compact text-[12px] leading-relaxed text-on-surface outline-none select-text"
                onKeyDown={(e) => {
                  const copy =
                    (e.ctrlKey || e.metaKey) &&
                    (e.key === 'c' || e.key === 'C' || e.key === 'a' || e.key === 'A');
                  if (!copy && e.key.length === 1) e.preventDefault();
                }}
              >
                {consoleTab === 'terminal' ? (
                  <>
                    {(execResult || loading) && (
                      <div className="whitespace-pre-wrap">
                        <span className="text-primary">$ </span>
                        <span className="text-primary">{runCommandLine.split(' ')[0]}</span>
                        {runCommandLine.includes(' ') ? (
                          <span className="text-on-surface">
                            {' '}
                            {runCommandLine.split(' ').slice(1).join(' ')}
                          </span>
                        ) : null}
                      </div>
                    )}
                    {loading && !execResult ? (
                      <div className="text-outline">…</div>
                    ) : null}
                    {execResult?.stdout ? (
                      <div className="whitespace-pre-wrap text-on-surface">{execResult.stdout}</div>
                    ) : null}
                    {execResult?.stderr ? (
                      <div className="whitespace-pre-wrap text-error">{execResult.stderr}</div>
                    ) : null}
                    {!loading && !execResult ? (
                      <>
                        <div className="text-outline">
                          # Read-only terminal — press Run to execute the open file
                        </div>
                        <div>
                          <span className="text-primary">$ </span>
                          <span className="inline-block h-3 w-1.5 animate-pulse bg-primary align-middle" />
                        </div>
                      </>
                    ) : null}
                    {execResult && !loading ? (
                      <div>
                        <span className="text-primary">$ </span>
                        <span className="inline-block h-3 w-1.5 animate-pulse bg-primary/70 align-middle" />
                      </div>
                    ) : null}
                  </>
                ) : null}
                {consoleTab === 'output' ? (
                  execResult ? (
                    <div className="whitespace-pre-wrap text-on-surface">
                      {execResult.stdout?.trim()
                        ? execResult.stdout
                        : execResult.ok
                          ? '(no stdout)'
                          : '(no stdout — see Debug Logs / Terminal for errors)'}
                    </div>
                  ) : (
                    <div className="text-outline">(no execution output yet)</div>
                  )
                ) : null}
                {consoleTab === 'debug' ? (
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-label-sm text-[11px] font-semibold tracking-wide ${debugTone.badge}`}
                      >
                        <span className="material-symbols-outlined text-[14px]">{debugTone.icon}</span>
                        {debugTone.label}
                      </span>
                      <span className={`font-code-compact text-[11px] ${debugTone.line}`}>
                        {debugTone.detail}
                      </span>
                    </div>
                    {execResult ? (
                      <div className="flex flex-col gap-1 whitespace-pre-wrap font-code-compact text-[12px]">
                        <div className={debugTone.line}>
                          status=
                          <span className="font-semibold">{execResult.status || '—'}</span>
                          {' · '}exit=
                          <span className="font-semibold">{execResult.exit_code}</span>
                          {' · '}phase={execResult.phase || '—'}
                          {execResult.duration_ms != null
                            ? ` · ${execResult.duration_ms}ms`
                            : ''}
                        </div>
                        <div className="text-on-surface-variant">
                          runtime={execResult.runtime || '—'}
                          {execResult.runtime_version
                            ? ` · ${execResult.runtime_version}`
                            : ''}
                          {execResult.error_type ? (
                            <>
                              {' · '}error=
                              <span className={debugTone.line}>{execResult.error_type}</span>
                            </>
                          ) : null}
                        </div>
                        {(execResult.stack_trace || execResult.stderr) && (
                          <div
                            className={`mt-1 whitespace-pre-wrap ${
                              debugTone.key === 'ok' ? 'text-tertiary' : debugTone.line
                            }`}
                          >
                            {execResult.stack_trace || execResult.stderr}
                          </div>
                        )}
                        {execResult.diagnostics &&
                        execResult.diagnostics !== execResult.stderr ? (
                          <div className="mt-1 text-on-surface-variant">
                            {execResult.diagnostics}
                          </div>
                        ) : null}
                      </div>
                    ) : activeResult?.stack_trace && brainSynced ? (
                      <div className="whitespace-pre-wrap text-error">
                        {activeResult.stack_trace}
                      </div>
                    ) : !loading ? (
                      <div className="text-outline">
                        # No debug logs yet — press Run to capture status
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </section>
          </div>
        </div>

        <EyraAssistantChat
          bufferText={bufferText}
          language={apiLanguageFromId(languageId)}
          fileName={activeId?.split('/').pop() || 'snippet.py'}
          loading={loading}
          liveWatching={liveWatching}
          modelLabel={modelLabel}
          runtimePulse={runtimePulse}
          onAnalyze={onAnalyze}
          onSandbox={onSandbox}
          onCopyPatch={onCopyPatch}
          onApplyFix={(code) => {
            const next = String(code || '');
            if (!next.trim()) {
              showToast?.('No corrected code to apply', 'error');
              return;
            }
            setActiveText(next);
            // Break stale Brain sync so red SyntaxError / fault line clears;
            // live audit re-evaluates the new buffer and only flags real issues.
            setSyncedSnippet('');
            if (activeResult) {
              adoptResult({
                ...activeResult,
                code_snippet: next,
                error_type: 'None',
                error_summary: '',
                stack_trace: '',
                root_cause: 'Suggested fix applied in the editor — re-run to verify.',
                explanation: 'Suggested fix applied in the editor — re-run to verify.',
                status: 'verified',
                suggested_correction: {
                  ...(activeResult.suggested_correction || {}),
                  corrected_code: next,
                  apply_mode: 'applied',
                },
              });
            }
            showToast?.('Suggested fix applied to the open file', 'info');
          }}
          buildPayload={buildPayload}
        />
      </div>
    </div>
  );
}
