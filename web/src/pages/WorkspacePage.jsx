import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { useEyra } from '../context/EyraContext';
import { loadWorkspaceSlice, saveWorkspaceSlice } from '../lib/workspaceDraft.js';
import { ScopeBotWorkspace } from './workspace/ScopeBotWorkspace.jsx';

function bootSession() {
  const saved = loadWorkspaceSlice('session');
  if (!saved) return { note: '', error: '', execResult: null, runtimePulse: null };
  return {
    note: typeof saved.note === 'string' ? saved.note : '',
    error: typeof saved.error === 'string' ? saved.error : '',
    execResult: saved.execResult && typeof saved.execResult === 'object' ? saved.execResult : null,
    runtimePulse:
      saved.runtimePulse && typeof saved.runtimePulse === 'object' && saved.runtimePulse.id
        ? saved.runtimePulse
        : null,
  };
}

export function WorkspacePage() {
  const { adoptResult, showToast, activeResult, setLastExecResult } = useEyra();
  const bootRef = useRef(null);
  if (!bootRef.current) bootRef.current = bootSession();
  const boot = bootRef.current;
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState(boot.note);
  const [error, setError] = useState(boot.error);
  const [execResult, setExecResult] = useState(boot.execResult);
  /** One-shot pulse so the chatbot auto-ingests terminal Run results. */
  const [runtimePulse, setRuntimePulse] = useState(boot.runtimePulse);

  const sessionSnap = useRef(null);
  sessionSnap.current = { note, error, execResult, runtimePulse };
  useEffect(() => {
    saveWorkspaceSlice('session', sessionSnap.current);
    return () => saveWorkspaceSlice('session', sessionSnap.current);
  }, [note, error, execResult, runtimePulse]);

  useEffect(() => {
    if (boot.execResult) setLastExecResult?.(boot.execResult);
  }, [boot, setLastExecResult]);

  function rememberExec(exec) {
    setExecResult(exec);
    setLastExecResult?.(exec);
  }

  function normalizeLanguage(lang) {
    const l = String(lang || 'python').toLowerCase();
    if (l.includes('python') || l === 'py') return 'python';
    if (l.includes('typescript') || l === 'ts' || l === 'tsx') return 'typescript';
    if (l.includes('javascript') || l === 'js' || l === 'jsx' || l === 'mjs') return 'javascript';
    if (l.includes('java')) return 'java';
    if (l === 'c++' || l === 'cpp' || l.includes('cplusplus')) return 'cpp';
    if (l === 'c' || l === 'clang') return 'c';
    if (l === 'go' || l.includes('golang')) return 'go';
    if (l.includes('html')) return 'html';
    if (l.includes('css')) return 'css';
    if (l.includes('sql')) return 'sql';
    return l.split(/\s+/)[0] || 'python';
  }

  function buildAnalyzeBody(partial = {}) {
    const code = String(partial.code_snippet ?? '').trim();
    if (!code) return null;
    return {
      file_name: partial.file_name || 'untitled.py',
      language: normalizeLanguage(partial.language),
      code_snippet: code,
      terminal_output: partial.terminal_output || '',
      stack_trace: partial.stack_trace || '',
      error_type: partial.error_type || undefined,
      project_name: partial.project_name || 'default',
      reasoning_profile: 'runtime',
    };
  }

  async function runAnalyze(partial = {}) {
    const requestBody = buildAnalyzeBody(partial);
    if (!requestBody) {
      showToast?.('Write or paste code in the editor first — no sample fallback', 'error');
      return null;
    }
    setLoading(true);
    setError('');
    setNote('');
    try {
      const data = await api.analyze(requestBody);
      adoptResult(data);
      setNote(`${data.session_id} · ${data.reasoning_source}`);
      showToast?.(`Investigation ${data.session_id}`, 'info');
      return data;
    } catch (err) {
      setError(err.message || String(err));
      showToast?.(err.message || 'Analyze failed', 'error');
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function runSandbox(partial = {}) {
    const requestBody = buildAnalyzeBody(partial);
    if (!requestBody) {
      showToast?.('Write or paste code in the editor first — no sample fallback', 'error');
      return null;
    }
    setLoading(true);
    setError('');
    setNote('');
    rememberExec(null);
    try {
      const exec = await api.execute({
        code: requestBody.code_snippet,
        language: requestBody.language || 'python',
        file_name: requestBody.file_name,
      });
      rememberExec(exec);

      const status = String(exec.status || '');
      if (status === 'RUNTIME_UNAVAILABLE' || exec.runtime_available === false) {
        showToast?.(
          exec.stderr || `Runtime unavailable for ${requestBody.language}`,
          'error',
        );
        setNote(exec.stderr || status);
        // Still analyze so ScopeBot explains the buffer; mark evidence as setup failure
        const data = await api.analyze({
          ...requestBody,
          terminal_output: exec.stderr || '',
          stack_trace: exec.stderr || '',
          error_type: exec.error_type || 'RuntimeUnavailable',
        });
        adoptResult(data);
        setRuntimePulse({
          id: `${Date.now()}-${data.session_id || 'run'}`,
          exec,
          result: data,
          code: requestBody.code_snippet,
          fileName: requestBody.file_name,
          language: requestBody.language,
        });
        return data;
      }

      const terminal = [exec.stdout, exec.stderr].filter(Boolean).join('\n').trim();
      const stack = exec.stack_trace || exec.stderr || '';
      const data = await api.analyze({
        ...requestBody,
        terminal_output: terminal || requestBody.terminal_output,
        stack_trace: stack || requestBody.stack_trace,
        error_type: exec.error_type || undefined,
      });
      adoptResult(data);
      // Chatbot only auto-ingests failed runs — successful executes stay out of the panel.
      if (!exec.ok) {
        setRuntimePulse({
          id: `${Date.now()}-${data.session_id || 'run'}`,
          exec,
          result: data,
          code: requestBody.code_snippet,
          fileName: requestBody.file_name,
          language: requestBody.language,
        });
      }
      const label =
        status === 'COMPILE_ERROR'
          ? 'Compile error'
          : status === 'TIMEOUT'
            ? 'Timed out'
            : status === 'EXECUTION_BLOCKED'
              ? 'Blocked by sandbox'
              : exec.ok
                ? 'Run OK'
                : `Exit ${exec.exit_code}`;
      setNote(`${label} · ${exec.runtime || requestBody.language} · ${data.session_id}`);
      showToast?.(`${label} · ${data.session_id}`, exec.ok ? 'info' : 'error');
      return data;
    } catch (err) {
      setError(err.message || String(err));
      showToast?.(err.message || 'Sandbox failed', 'error');
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function copyPatch() {
    const patch =
      activeResult?.suggested_correction?.diff_unified ||
      activeResult?.suggested_correction?.corrected_code ||
      '';
    if (!patch) {
      setNote('No live patch yet — run an investigation first.');
      showToast?.('No live patch to copy', 'error');
      return;
    }
    try {
      await navigator.clipboard.writeText(patch);
      setNote('Patch copied — human-in-the-loop apply only.');
    } catch {
      setNote('Copy manually — auto-apply disabled.');
    }
  }

  return (
    <ScopeBotWorkspace
      loading={loading}
      statusNote={note}
      statusError={error}
      execResult={execResult}
      runtimePulse={runtimePulse}
      onAnalyze={runAnalyze}
      onSandbox={runSandbox}
      onCopyPatch={copyPatch}
      onClearConsole={() => rememberExec(null)}
    />
  );
}
