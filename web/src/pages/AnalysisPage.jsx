import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useEyra } from '../context/EyraContext';

const DEFAULT_FIB = `def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n - 1) + fibonacci(n - 2)
`;

const COMPARISON_ROWS = [
  { label: 'O(1)', name: 'Constant', width: 18, tone: 'bg-tertiary' },
  { label: 'O(log n)', name: 'Logarithmic', width: 32, tone: 'bg-tertiary/80' },
  { label: 'O(n)', name: 'Linear', width: 48, tone: 'bg-primary' },
  { label: 'O(n log n)', name: 'Linearithmic', width: 62, tone: 'bg-primary/70' },
  { label: 'O(n^2)', name: 'Quadratic', width: 78, tone: 'bg-warning' },
  { label: 'O(2^n)', name: 'Exponential', width: 96, tone: 'bg-error' },
];

function severityPill(sev) {
  const s = String(sev || '').toLowerCase();
  if (s === 'high') return 'bg-error/20 text-error border border-error/30';
  if (s === 'medium') return 'bg-warning/15 text-warning border border-warning/30';
  return 'bg-tertiary/15 text-tertiary border border-tertiary/30';
}

function statusPill(status) {
  const s = String(status || 'not_run').toLowerCase();
  if (s === 'passed') return 'bg-tertiary/20 text-tertiary border border-tertiary/30';
  if (s === 'failed') return 'bg-error/20 text-error border border-error/30';
  return 'bg-surface-container-high text-outline border border-outline-variant/40';
}

function resolveBuffer(activeResult) {
  const code =
    activeResult?.code_snippet ||
    activeResult?.suggested_correction?.corrected_code ||
    '';
  return {
    code: String(code || '').trim() || DEFAULT_FIB,
    language: activeResult?.language || 'python',
    file_name: activeResult?.file_name || 'snippet.py',
    fromEditor: Boolean(String(activeResult?.code_snippet || '').trim()),
  };
}

function CodePanel({
  title,
  badge,
  timeLabel,
  spaceLabel,
  code,
  tone = 'neutral',
  onCopy,
}) {
  const border =
    tone === 'bad'
      ? 'border-error/25'
      : tone === 'good'
        ? 'border-tertiary/25'
        : 'border-outline-variant/25';
  const head =
    tone === 'bad'
      ? 'bg-error/10 text-error'
      : tone === 'good'
        ? 'bg-tertiary/10 text-tertiary'
        : 'bg-surface-container-high text-on-surface';
  const lines = String(code || '').replace(/\r\n/g, '\n').split('\n');

  return (
    <div className={`rounded-xl border ${border} bg-surface-container-lowest overflow-hidden flex flex-col min-h-[16rem]`}>
      <div className={`px-space-sm py-2 flex items-center justify-between gap-2 ${head}`}>
        <div className="flex items-center gap-1.5 font-label-sm text-label-sm font-semibold min-w-0">
          <span className="material-symbols-outlined text-[16px]">
            {tone === 'good' ? 'check_circle' : tone === 'bad' ? 'error' : 'code'}
          </span>
          <span className="truncate">{title}</span>
          {badge ? (
            <span className="ml-1 px-1.5 py-0.5 rounded font-code-compact text-[10px] bg-surface-container-lowest/40">
              {badge}
            </span>
          ) : null}
        </div>
        {onCopy ? (
          <button
            type="button"
            onClick={onCopy}
            className="p-1 rounded hover:bg-surface-container-lowest/40 text-current opacity-80"
            title="Copy"
          >
            <span className="material-symbols-outlined text-[16px]">content_copy</span>
          </button>
        ) : null}
      </div>
      <div className="px-space-sm py-1.5 flex flex-wrap gap-2 border-b border-outline-variant/15 font-code-compact text-[11px]">
        {timeLabel ? (
          <span className={tone === 'good' ? 'text-tertiary' : 'text-error'}>
            Time Complexity: {timeLabel}
          </span>
        ) : null}
        {spaceLabel ? (
          <span className={tone === 'good' ? 'text-tertiary' : 'text-primary'}>
            Space Complexity: {spaceLabel}
          </span>
        ) : null}
      </div>
      <div className="flex-1 overflow-auto eyra-terminal-scroll max-h-64 bg-[#0a0f18]">
        <pre className="p-0 m-0 font-mono text-[12px] leading-5 text-on-surface">
          {lines.map((line, i) => (
            <div key={`L${i}`} className="flex hover:bg-surface-container/40">
              <span className="w-9 shrink-0 select-none text-right pr-2 text-outline/70 border-r border-outline-variant/20">
                {i + 1}
              </span>
              <span className="px-3 whitespace-pre-wrap break-all">{line || ' '}</span>
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}

export function AnalysisPage() {
  const navigate = useNavigate();
  const { activeResult, adoptResult, showToast } = useEyra();
  const buffer = useMemo(() => resolveBuffer(activeResult), [activeResult]);

  const [loading, setLoading] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [runningTests, setRunningTests] = useState(false);
  const [payload, setPayload] = useState(null);
  const [targetTime, setTargetTime] = useState('O(n)');
  const [targetSpace, setTargetSpace] = useState('O(1)');
  const [goal, setGoal] = useState('');
  const [suggestion, setSuggestion] = useState(null);
  const [cases, setCases] = useState([]);
  const [testLog, setTestLog] = useState(
    '> Tests have not been executed yet.\n> Click "Run All Tests" or run individual tests.',
  );

  const options = payload?.targets?.options || [
    'O(1)',
    'O(log n)',
    'O(n)',
    'O(n log n)',
    'O(n^2)',
    'O(2^n)',
  ];

  const stats = useMemo(() => {
    const total = cases.length;
    const passed = cases.filter((c) => c.status === 'passed').length;
    const failed = cases.filter((c) => c.status === 'failed').length;
    const executed = cases.filter((c) => c.status === 'executed').length;
    const not_run = cases.filter((c) => c.status === 'not_run' || !c.status).length;
    return { total, passed, failed, executed, not_run };
  }, [cases]);

  const runAnalyze = useCallback(
    async ({ toast = true } = {}) => {
      setLoading(true);
      try {
        const data = await api.performanceAnalyze({
          code: buffer.code,
          language: buffer.language,
          file_name: buffer.file_name,
          target_time: targetTime,
          target_space: targetSpace,
          goal,
        });
        setPayload(data);
        setSuggestion(data.suggestion || null);
        setCases(data.tests?.cases || []);
        if (data.targets?.time) setTargetTime(data.targets.time);
        if (data.targets?.space) setTargetSpace(data.targets.space);
        if (data.targets?.goal && !goal) setGoal(data.targets.goal);
        setTestLog(
          '> Tests have not been executed yet.\n> Click "Run All Tests" or run individual tests.',
        );
        if (toast) showToast?.('Performance analysis updated', 'info');
      } catch (err) {
        showToast?.(err.message || 'Analyze failed', 'error');
      } finally {
        setLoading(false);
      }
    },
    [buffer, targetTime, targetSpace, goal, showToast],
  );

  useEffect(() => {
    runAnalyze({ toast: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buffer.code, buffer.file_name, buffer.language]);

  async function onSuggestOptimized() {
    setOptimizing(true);
    try {
      const data = await api.performanceOptimize({
        code: buffer.code,
        language: buffer.language,
        file_name: buffer.file_name,
        target_time: targetTime,
        target_space: targetSpace,
        goal,
      });
      setSuggestion(data.suggestion || null);
      showToast?.(
        data.suggestion?.applied_transform
          ? 'Optimized suggestion ready'
          : 'Suggestion guidance updated',
        'info',
      );
    } catch (err) {
      showToast?.(err.message || 'Optimize failed', 'error');
    } finally {
      setOptimizing(false);
    }
  }

  async function onGenerateTests() {
    try {
      const data = await api.performanceGenerateTests({
        code: suggestion?.optimized_code || buffer.code,
        language: buffer.language,
        file_name: buffer.file_name,
        function_name: payload?.complexity?.function_name,
      });
      setCases(data.cases || []);
      setTestLog('> Test cases regenerated.\n> Not executed yet.');
      showToast?.(`Generated ${data.total || 0} test cases`, 'info');
    } catch (err) {
      showToast?.(err.message || 'Generate tests failed', 'error');
    }
  }

  async function onRunTests(caseIds = null) {
    setRunningTests(true);
    try {
      const codeUnderTest = suggestion?.optimized_code || buffer.code;
      const data = await api.performanceRunTests({
        code: codeUnderTest,
        language: buffer.language,
        file_name: buffer.file_name,
        cases,
        case_ids: caseIds || undefined,
      });
      setCases(data.cases || []);
      setTestLog(data.log || '> Done.');
      showToast?.(
        `Tests: ${data.passed || 0} passed · ${data.failed || 0} failed`,
        data.failed ? 'error' : 'info',
      );
    } catch (err) {
      showToast?.(err.message || 'Run tests failed', 'error');
    } finally {
      setRunningTests(false);
    }
  }

  function onExport() {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            file_name: buffer.file_name,
            language: buffer.language,
            complexity: payload?.complexity,
            suggestion,
            cases,
            log: testLog,
          },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `eyra-perf-${buffer.file_name || 'analysis'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copyText(text, label = 'Copied') {
    try {
      await navigator.clipboard.writeText(text || '');
      showToast?.(label, 'info');
    } catch {
      showToast?.('Clipboard blocked', 'error');
    }
  }

  function onPreviewFix() {
    const code = suggestion?.optimized_code;
    if (!code) {
      showToast?.('No optimized code to preview', 'error');
      return;
    }
    adoptResult?.({
      ...(activeResult || {}),
      file_name: buffer.file_name,
      language: buffer.language,
      code_snippet: buffer.code,
      suggested_correction: {
        summary: 'Performance optimization suggestion',
        corrected_code: code,
        apply_mode: 'review_and_copy',
      },
      root_cause: (suggestion?.reasons || []).join('; '),
      error_type: activeResult?.error_type || 'Performance',
      status: 'verified',
    });
    showToast?.('Preview loaded — opening Debugging Workspace', 'info');
    navigate('/workspace');
  }

  const cx = payload?.complexity;
  const currentCode = suggestion?.current_code || buffer.code;
  const optimizedCode =
    suggestion?.optimized_code ||
    'Click “Suggest Optimized Code” to generate a recommendation.';
  const activeBigO = cx?.time || '';

  return (
    <div className="flex flex-col w-full min-h-full bg-background px-space-lg py-space-md gap-space-md">
      {/* Header */}
      <header className="flex flex-col lg:flex-row lg:items-end justify-between gap-space-md">
        <div className="flex flex-col gap-1 min-w-0">
          <div className="font-label-sm text-label-sm text-primary uppercase tracking-[0.14em]">
            Runtime Debugging / Code Performance & Test Analysis
          </div>
          <h1 className="font-headline-lg text-headline-lg text-on-surface font-semibold tracking-tight">
            Code Performance &amp; Test Analysis
          </h1>
          <p className="font-body-sm text-body-sm text-on-surface-variant max-w-2xl">
            Understand complexity, explore target constraints, and validate fixes with generated
            tests.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-space-sm shrink-0">
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-surface-container border border-outline-variant/30 font-label-sm text-label-sm text-on-surface-variant">
            <span className="w-1.5 h-1.5 rounded-full bg-tertiary shadow-[0_0_8px_rgba(108,249,187,0.6)]" />
            {buffer.fromEditor
              ? 'Results based on current editor buffer'
              : 'Demo buffer — open Workspace to analyze live code'}
          </div>
          <button
            type="button"
            onClick={() => runAnalyze({ toast: true })}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary-container text-on-primary-container font-label-sm text-label-sm font-semibold shadow-[0_0_16px_rgba(53,214,242,0.25)] disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-[18px]">sync</span>
            {loading ? 'Analyzing…' : 'Re-analyze'}
          </button>
        </div>
      </header>

      {/* Row 1 */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-space-md">
        {/* Complexity Analysis */}
        <section className="xl:col-span-7 rounded-xl border border-outline-variant/25 bg-surface-container-low p-space-md shadow-sm flex flex-col gap-space-md">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-[20px]">analytics</span>
            <h2 className="font-headline-sm text-headline-sm font-semibold text-on-surface">
              Complexity Analysis
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-space-sm">
            <div className="rounded-xl border border-error/20 bg-surface-container p-space-md flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 font-label-sm text-label-sm text-on-surface-variant">
                  <span className="material-symbols-outlined text-[16px] text-error">schedule</span>
                  Time Complexity
                </div>
                <span
                  className={`px-2 py-0.5 rounded-full font-label-sm text-[10px] font-semibold uppercase ${severityPill(cx?.time_severity)}`}
                >
                  {cx?.time_severity || '—'}
                </span>
              </div>
              <div className="font-headline-md text-[1.75rem] leading-none font-semibold text-error tracking-tight">
                {cx?.time || '—'}
              </div>
              <div className="font-body-sm text-body-sm text-on-surface-variant">
                {cx?.time_label || 'Estimated'}
              </div>
            </div>

            <div className="rounded-xl border border-primary/20 bg-surface-container p-space-md flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 font-label-sm text-label-sm text-on-surface-variant">
                  <span className="material-symbols-outlined text-[16px] text-primary">
                    memory
                  </span>
                  Space Complexity
                </div>
                <span
                  className={`px-2 py-0.5 rounded-full font-label-sm text-[10px] font-semibold uppercase ${severityPill(cx?.space_severity)}`}
                >
                  {cx?.space_severity || '—'}
                </span>
              </div>
              <div className="font-headline-md text-[1.75rem] leading-none font-semibold text-primary tracking-tight">
                {cx?.space || '—'}
              </div>
              <div className="font-body-sm text-body-sm text-on-surface-variant">
                {cx?.space_label || 'Estimated'}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-outline-variant/20 bg-surface-container p-space-md">
            <div className="font-label-sm text-label-sm text-on-surface-variant mb-space-sm">
              Complexity Comparison
            </div>
            <div className="flex flex-col gap-2">
              {COMPARISON_ROWS.map((row) => {
                const active = row.label === activeBigO;
                return (
                  <div key={row.label} className="grid grid-cols-[5.5rem_1fr_6.5rem] items-center gap-2">
                    <span
                      className={`font-code-compact text-[11px] ${
                        active ? 'text-on-surface font-semibold' : 'text-outline'
                      }`}
                    >
                      {row.label}
                    </span>
                    <div className="h-2 rounded-full bg-surface-container-highest overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          active ? row.tone : 'bg-surface-bright/50'
                        } ${active ? 'shadow-[0_0_10px_rgba(255,180,171,0.35)]' : ''}`}
                        style={{ width: `${row.width}%` }}
                      />
                    </div>
                    <span
                      className={`font-label-sm text-[11px] text-right ${
                        active ? 'text-on-surface' : 'text-outline'
                      }`}
                    >
                      {row.name}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Target Complexity */}
        <section className="xl:col-span-5 rounded-xl border border-outline-variant/25 bg-surface-container-low p-space-md shadow-sm flex flex-col gap-space-sm">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-[20px]">flag</span>
            <h2 className="font-headline-sm text-headline-sm font-semibold text-on-surface">
              Target Complexity
            </h2>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="font-label-sm text-label-sm text-on-surface-variant">
              Target Time Complexity
            </span>
            <select
              value={targetTime}
              onChange={(e) => setTargetTime(e.target.value)}
              className="rounded-lg bg-surface-container border border-outline-variant/35 px-3 py-2.5 font-code-compact text-code-compact text-on-surface focus:outline-none focus:border-primary/50"
            >
              {options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="font-label-sm text-label-sm text-on-surface-variant">
              Target Space Complexity
            </span>
            <select
              value={targetSpace}
              onChange={(e) => setTargetSpace(e.target.value)}
              className="rounded-lg bg-surface-container border border-outline-variant/35 px-3 py-2.5 font-code-compact text-code-compact text-on-surface focus:outline-none focus:border-primary/50"
            >
              {options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5 flex-1">
            <span className="font-label-sm text-label-sm text-on-surface-variant">
              Optimization goal
            </span>
            <textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              rows={4}
              className="rounded-lg bg-surface-container border border-outline-variant/35 px-3 py-2.5 font-body-sm text-body-sm text-on-surface resize-none focus:outline-none focus:border-primary/50 flex-1 min-h-[6rem]"
              placeholder="Describe the optimization goal…"
            />
          </label>

          <button
            type="button"
            onClick={onSuggestOptimized}
            disabled={optimizing}
            className="mt-1 flex items-center justify-center gap-2 px-3 py-3 rounded-lg bg-primary-container text-on-primary-container font-label-sm text-label-sm font-semibold shadow-[0_0_18px_rgba(53,214,242,0.28)] disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-[18px]">auto_fix</span>
            {optimizing ? 'Suggesting…' : 'Suggest Optimized Code'}
          </button>
        </section>
      </div>

      {/* Optimization Suggestions */}
      <section className="rounded-xl border border-outline-variant/25 bg-surface-container-low p-space-md shadow-sm flex flex-col gap-space-md">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-primary text-[20px]">lightbulb</span>
          <h2 className="font-headline-sm text-headline-sm font-semibold text-on-surface">
            Optimization Suggestions
          </h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-sm items-stretch">
          <div className="lg:col-span-4">
            <CodePanel
              title="Current approach"
              tone="bad"
              timeLabel={suggestion?.current_time || cx?.time}
              spaceLabel={suggestion?.current_space || cx?.space}
              code={currentCode}
              onCopy={() => copyText(currentCode, 'Current code copied')}
            />
          </div>

          <div className="hidden lg:flex lg:col-span-1 items-center justify-center">
            <div className="w-10 h-10 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center text-primary">
              <span className="material-symbols-outlined text-[22px]">arrow_forward</span>
            </div>
          </div>

          <div className="lg:col-span-4">
            <CodePanel
              title="Recommended approach"
              tone="good"
              timeLabel={suggestion?.optimized_time || targetTime}
              spaceLabel={suggestion?.optimized_space || targetSpace}
              code={optimizedCode}
              onCopy={() =>
                suggestion?.optimized_code &&
                copyText(suggestion.optimized_code, 'Recommended code copied')
              }
            />
          </div>

          <div className="lg:col-span-3 rounded-xl border border-outline-variant/25 bg-surface-container p-space-md flex flex-col gap-space-sm">
            <div className="font-label-sm text-label-sm font-semibold text-on-surface">
              Why this is better?
            </div>
            <ul className="flex flex-col gap-2.5 flex-1">
              {(suggestion?.reasons || ['Run Suggest Optimized Code to see reasons.']).map((r) => (
                <li
                  key={r}
                  className="flex items-start gap-2 font-body-sm text-body-sm text-on-surface-variant"
                >
                  <span className="material-symbols-outlined text-tertiary text-[18px] mt-0.5">
                    check_circle
                  </span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={onPreviewFix}
              className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg bg-secondary-container text-on-secondary-container font-label-sm text-label-sm font-semibold"
            >
              <span className="material-symbols-outlined text-[18px]">visibility</span>
              Preview Fix
            </button>
          </div>
        </div>
      </section>

      {/* Tests */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-space-md">
        <section className="xl:col-span-8 rounded-xl border border-outline-variant/25 bg-surface-container-low p-space-md shadow-sm flex flex-col gap-space-sm min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[20px]">science</span>
                <h2 className="font-headline-sm text-headline-sm font-semibold text-on-surface">
                  Generated Test Cases
                </h2>
              </div>
              <div className="font-code-compact text-[11px] text-outline pl-7">
                Total {stats.total} · Passed {stats.passed} · Failed {stats.failed} · Executed{' '}
                {stats.executed} · Not Run {stats.not_run}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={onGenerateTests}
                className="px-2.5 py-1.5 rounded-lg bg-primary-container text-on-primary-container font-label-sm text-label-sm font-semibold"
              >
                Generate Test Cases
              </button>
              <button
                type="button"
                onClick={() => onRunTests(null)}
                disabled={runningTests || !cases.length}
                className="px-2.5 py-1.5 rounded-lg bg-secondary-container text-on-secondary-container font-label-sm text-label-sm font-semibold disabled:opacity-60"
              >
                {runningTests ? 'Running…' : 'Run All Tests'}
              </button>
              <button
                type="button"
                onClick={onExport}
                className="px-2.5 py-1.5 rounded-lg border border-outline-variant/40 bg-surface-container text-on-surface font-label-sm text-label-sm"
              >
                Export Results
              </button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-outline-variant/25 bg-surface-container-lowest">
            <table className="w-full text-left min-w-[640px]">
              <thead>
                <tr className="bg-surface-container-high/80 font-label-sm text-[11px] uppercase tracking-wide text-outline">
                  <th className="px-3 py-2.5 font-medium">#</th>
                  <th className="px-3 py-2.5 font-medium">Case Description</th>
                  <th className="px-3 py-2.5 font-medium">Input</th>
                  <th className="px-3 py-2.5 font-medium">Expected Output</th>
                  <th className="px-3 py-2.5 font-medium">Actual Output</th>
                  <th className="px-3 py-2.5 font-medium">Result</th>
                  <th className="px-3 py-2.5 w-12" />
                </tr>
              </thead>
              <tbody className="font-body-sm text-body-sm">
                {cases.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-on-surface-variant text-center">
                      No test cases yet — click Generate Test Cases.
                    </td>
                  </tr>
                ) : (
                  cases.map((c) => (
                    <tr
                      key={c.id}
                      className="border-t border-outline-variant/15 hover:bg-surface-container/40"
                    >
                      <td className="px-3 py-2.5 font-mono text-outline">{c.id}</td>
                      <td className="px-3 py-2.5 text-on-surface">{c.description}</td>
                      <td className="px-3 py-2.5 font-mono text-primary">{c.input}</td>
                      <td className="px-3 py-2.5 font-mono text-on-surface-variant">
                        {c.expected == null ? '—' : String(c.expected)}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-on-surface-variant max-w-[9rem] truncate">
                        {c.actual == null ? '—' : String(c.actual)}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-full font-label-sm text-[10px] font-semibold uppercase ${statusPill(c.status)}`}
                        >
                          {String(c.status || 'not_run').replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <button
                          type="button"
                          title="Run test"
                          onClick={() => onRunTests([c.id])}
                          disabled={runningTests}
                          className="p-1 rounded-md hover:bg-surface-container-high text-primary disabled:opacity-50"
                        >
                          <span className="material-symbols-outlined text-[18px]">play_arrow</span>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="xl:col-span-4 rounded-xl border border-outline-variant/25 bg-surface-container-low p-space-md shadow-sm flex flex-col gap-2 min-h-[18rem]">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="material-symbols-outlined text-primary text-[20px]">terminal</span>
              <h2 className="font-headline-sm text-headline-sm font-semibold text-on-surface truncate">
                Test Execution Results
              </h2>
            </div>
            <button
              type="button"
              onClick={() =>
                setTestLog(
                  '> Tests have not been executed yet.\n> Click "Run All Tests" or run individual tests.',
                )
              }
              className="font-label-sm text-label-sm text-outline hover:text-on-surface px-2 py-1 rounded"
            >
              Clear
            </button>
          </div>
          <pre className="flex-1 rounded-xl bg-[#0a0f18] border border-outline-variant/25 p-space-sm font-mono text-[12px] leading-5 text-on-surface-variant whitespace-pre-wrap overflow-auto eyra-terminal-scroll min-h-[14rem]">
            {testLog}
          </pre>
        </section>
      </div>
    </div>
  );
}
