import { useState } from 'react';
import { api } from '../api/client';
import { useEyra } from '../context/EyraContext';
import { ScopeBotWorkspace } from './workspace/ScopeBotWorkspace.jsx';

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

  async function runAnalyze() {
    setLoading(true);
    setError('');
    setNote('');
    try {
      const data = await api.analyze(SAMPLE);
      adoptResult(data);
      setNote(`${data.session_id} · ${data.reasoning_source}`);
      showToast?.(`Investigation ${data.session_id}`, 'info');
    } catch (err) {
      setError(err.message || String(err));
      showToast?.(err.message || 'Analyze failed', 'error');
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
      onAnalyze={runAnalyze}
      onCopyPatch={copyPatch}
    />
  );
}
