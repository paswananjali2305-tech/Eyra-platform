import { useState } from 'react';
import { api } from '../api/client';
import { useEyra } from '../context/EyraContext';
import { ScopeBotWorkspace } from './workspace/ScopeBotWorkspace.jsx';

/** Fallback demo payload when the editor buffer is empty. */
const SAMPLE = {
  file_name: 'test.py',
  language: 'python',
  code_snippet: 'a = 10\nb = 0\nprint(a / b)\n',
  terminal_output: 'ZeroDivisionError: division by zero',
  stack_trace:
    'Traceback (most recent call last):\n  File "test.py", line 3, in <module>\n    print(a / b)\nZeroDivisionError: division by zero',
  reasoning_profile: 'runtime',
};

const PATCH = `if b != 0:
    print(a / b)
else:
    print("Cannot divide by zero")
`;

export function WorkspacePage() {
  const { adoptResult, showToast, activeResult } = useEyra();
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [execResult, setExecResult] = useState(null);

  function buildAnalyzeBody(partial = {}) {
    const code = String(partial.code_snippet ?? '').trim();
    const usingFallback = !code;
    return {
      ...SAMPLE,
      ...partial,
      file_name: partial.file_name || SAMPLE.file_name,
      language: (partial.language || SAMPLE.language || 'python').toLowerCase().includes('py')
        ? 'python'
        : partial.language || 'python',
      code_snippet: usingFallback ? SAMPLE.code_snippet : code,
      terminal_output: partial.terminal_output ?? (usingFallback ? SAMPLE.terminal_output : ''),
      stack_trace: partial.stack_trace ?? (usingFallback ? SAMPLE.stack_trace : ''),
      reasoning_profile: 'runtime',
      _usedSampleFallback: usingFallback,
    };
  }

  async function runAnalyze(partial = {}) {
    setLoading(true);
    setError('');
    setNote('');
    const body = buildAnalyzeBody(partial);
    const { _usedSampleFallback, ...requestBody } = body;
    try {
      const data = await api.analyze(requestBody);
      adoptResult(data);
      setNote(
        `${data.session_id} · ${data.reasoning_source}${
          _usedSampleFallback ? ' · sample fallback' : ''
        }`,
      );
      showToast?.(
        _usedSampleFallback
          ? `Sample analyze · ${data.session_id}`
          : `Investigation ${data.session_id}`,
        'info',
      );
      return data;
    } catch (err) {
      setError(err.message || String(err));
      showToast?.(err.message || 'Analyze failed', 'error');
      return null;
    } finally {
      setLoading(false);
    }
  }

  /**
   * Sandbox path: call verified /api/execute (timeout + blocked APIs), then analyze
   * with captured stdout/stderr. Terminal UI is filled via execResult prop only.
   */
  async function runSandbox(partial = {}) {
    setLoading(true);
    setError('');
    setNote('');
    const body = buildAnalyzeBody(partial);
    const { _usedSampleFallback, ...requestBody } = body;
    try {
      const exec = await api.execute({
        code: requestBody.code_snippet,
        language: 'python',
        file_name: requestBody.file_name,
      });
      setExecResult(exec);
      const terminal = [exec.stdout, exec.stderr].filter(Boolean).join('\n').trim();
      const data = await api.analyze({
        ...requestBody,
        terminal_output: terminal || requestBody.terminal_output,
        stack_trace: exec.stderr || requestBody.stack_trace,
        error_type: exec.error_type || undefined,
      });
      adoptResult(data);
      setNote(
        `sandbox exit ${exec.exit_code} · ${data.session_id}${
          _usedSampleFallback ? ' · sample fallback' : ''
        }`,
      );
      showToast?.(
        exec.ok ? `Sandbox OK · ${data.session_id}` : `Sandbox exit ${exec.exit_code}`,
        exec.ok ? 'info' : 'error',
      );
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
      PATCH;
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
      onAnalyze={runAnalyze}
      onSandbox={runSandbox}
      onCopyPatch={copyPatch}
    />
  );
}
