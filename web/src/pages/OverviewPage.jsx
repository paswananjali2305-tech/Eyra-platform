import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useEyra } from '../context/EyraContext';
import { relativeTime } from '../lib/hydrateStitch.js';

function capitalizeFirst(name) {
  const s = String(name || '').trim();
  if (!s) return 'there';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function isRealErrorType(t) {
  const s = String(t || '').trim();
  return Boolean(s) && !/^none$/i.test(s) && s !== 'null' && s !== 'undefined';
}

function displayErrorType(t) {
  return isRealErrorType(t) ? String(t) : 'Clean run';
}

function formatStatus(status) {
  const s = String(status || 'needs_review').replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function statusTone(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'verified') return 'verified';
  if (s === 'hypothesis' || s === 'unverified') return 'warn';
  if (s === 'failed') return 'error';
  return 'review';
}

function statusPillClass(tone) {
  switch (tone) {
    case 'verified':
      return 'bg-tertiary-container/20 text-tertiary';
    case 'warn':
      return 'bg-secondary-container/30 text-secondary';
    case 'error':
      return 'bg-error-container/40 text-error';
    case 'review':
      return 'bg-warning/15 text-warning';
    default: {
      void tone;
      return 'bg-warning/15 text-warning';
    }
  }
}

function errorDotClass(errorType) {
  if (!isRealErrorType(errorType)) return 'bg-tertiary';
  const t = String(errorType).toLowerCase();
  if (t.includes('syntax') || t.includes('zero') || t.includes('name')) return 'bg-error';
  if (t.includes('type') || t.includes('attr')) return 'bg-primary';
  return 'bg-error';
}

function formatExecutionTime(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return null;
  if (n < 1000) return `${Math.round(n)}ms`;
  const seconds = n / 1000;
  return `${seconds >= 10 ? seconds.toFixed(1) : seconds.toFixed(2)}s`;
}

function mostCommonError(items) {
  const counts = new Map();
  for (const it of items) {
    const key = displayErrorType(it.error_type);
    if (key === 'Clean run') continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let best = null;
  let n = 0;
  for (const [k, v] of counts) {
    if (v > n) {
      best = k;
      n = v;
    }
  }
  return { label: best, count: n };
}

function dayKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dayLabel(d) {
  return d.toLocaleDateString(undefined, { weekday: 'short' });
}

/** Last 7 calendar days of investigation counts (+ verified subset). */
function activitySeries(items, days = 7) {
  const now = new Date();
  const buckets = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    buckets.push({
      key: dayKey(d),
      label: dayLabel(d),
      total: 0,
      verified: 0,
    });
  }
  const byKey = new Map(buckets.map((b) => [b.key, b]));
  for (const it of items) {
    const t = new Date(it.created_at).getTime();
    if (!Number.isFinite(t)) continue;
    const key = dayKey(new Date(t));
    const bucket = byKey.get(key);
    if (!bucket) continue;
    bucket.total += 1;
    if (String(it.status || '').toLowerCase() === 'verified') bucket.verified += 1;
  }
  return buckets;
}

/** Top error types for horizontal bars (excludes clean runs). */
function errorDistribution(items, limit = 5) {
  const counts = new Map();
  for (const it of items) {
    const key = displayErrorType(it.error_type);
    if (key === 'Clean run') continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function ActivityChart({ series }) {
  const w = 320;
  const h = 140;
  const padL = 28;
  const padR = 8;
  const padT = 12;
  const padB = 28;
  const maxY = Math.max(1, ...series.map((s) => s.total));
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const n = series.length;
  const xAt = (i) => padL + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yAt = (v) => padT + innerH - (v / maxY) * innerH;

  const totalPts = series.map((s, i) => `${xAt(i)},${yAt(s.total)}`).join(' ');
  const areaPts = [
    `${xAt(0)},${padT + innerH}`,
    ...series.map((s, i) => `${xAt(i)},${yAt(s.total)}`),
    `${xAt(n - 1)},${padT + innerH}`,
  ].join(' ');
  const verifiedPts = series.map((s, i) => `${xAt(i)},${yAt(s.verified)}`).join(' ');
  const sum = series.reduce((a, s) => a + s.total, 0);

  if (sum === 0) {
    return (
      <EmptyBlock
        icon="show_chart"
        title="No activity yet"
        detail="Investigations from the last 7 days appear here."
      />
    );
  }

  return (
    <div className="flex flex-col gap-space-sm">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-36 w-full" role="img" aria-label="Investigations over 7 days">
        {[0, 0.5, 1].map((t) => {
          const y = padT + innerH * (1 - t);
          return (
            <g key={t}>
              <line
                x1={padL}
                x2={w - padR}
                y1={y}
                y2={y}
                stroke="rgba(60,73,76,0.45)"
                strokeWidth="1"
              />
              <text
                x={padL - 6}
                y={y + 3}
                textAnchor="end"
                fill="#859397"
                fontSize="9"
                fontFamily="JetBrains Mono, monospace"
              >
                {Math.round(maxY * t)}
              </text>
            </g>
          );
        })}
        <polygon points={areaPts} fill="rgba(53,214,242,0.12)" />
        <polyline
          points={totalPts}
          fill="none"
          stroke="#35d6f2"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <polyline
          points={verifiedPts}
          fill="none"
          stroke="#6cf9bb"
          strokeWidth="1.5"
          strokeDasharray="4 3"
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity="0.9"
        />
        {series.map((s, i) => (
          <circle key={s.key} cx={xAt(i)} cy={yAt(s.total)} r="3" fill="#9cedff" />
        ))}
        {series.map((s, i) => (
          <text
            key={`${s.key}-lbl`}
            x={xAt(i)}
            y={h - 8}
            textAnchor="middle"
            fill="#859397"
            fontSize="9"
            fontFamily="JetBrains Mono, monospace"
          >
            {s.label}
          </text>
        ))}
      </svg>
      <div className="flex flex-wrap items-center gap-space-md font-label-sm text-label-sm text-outline">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-3 rounded bg-primary-container" />
          Sessions
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-3 rounded border border-dashed border-tertiary bg-transparent" />
          Verified
        </span>
        <span className="ml-auto font-code-compact text-code-compact">{sum} in 7 days</span>
      </div>
    </div>
  );
}

function ErrorMixChart({ rows }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  const palette = ['#35d6f2', '#6cf9bb', '#bbc3ff', '#f59e0b', '#ffb4ab'];

  if (!rows.length) {
    return (
      <EmptyBlock
        icon="pie_chart"
        title="No errors yet"
        detail="Error types from your investigations show up here."
      />
    );
  }

  return (
    <div className="flex flex-col gap-space-sm py-1">
      {rows.map((row, i) => {
        const pct = Math.max(6, Math.round((row.count / max) * 100));
        return (
          <div key={row.label} className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-space-sm">
              <span className="truncate font-code-compact text-code-compact text-on-surface">
                {row.label}
              </span>
              <span className="shrink-0 font-label-sm text-label-sm text-outline">
                {row.count}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-container-highest">
              <div
                className="h-full rounded-full transition-[width] duration-500"
                style={{ width: `${pct}%`, background: palette[i % palette.length] }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function snippetLines(detail) {
  const code = String(detail?.code_snippet || '').replace(/\r\n/g, '\n');
  if (!code.trim()) return [];
  const lines = code.split('\n');
  const stack = String(detail?.stack_trace || detail?.terminal_output || '');
  const m = stack.match(/line\s+(\d+)/i);
  const focus = m ? Number(m[1]) : null;
  let start = 0;
  if (focus && focus >= 1) {
    start = Math.max(0, focus - 2);
  }
  const slice = lines.slice(start, start + 3);
  return slice.map((text, i) => ({
    n: start + i + 1,
    text: text || ' ',
    hot: focus != null && start + i + 1 === focus,
  }));
}

function SparkBars({ tone = 'primary' }) {
  const fill =
    tone === 'error'
      ? 'var(--color-error)'
      : tone === 'tertiary'
        ? 'var(--color-tertiary)'
        : 'var(--color-primary)';
  const heights = [28, 44, 36, 58, 42, 70, 52];
  return (
    <svg viewBox="0 0 56 28" className="h-7 w-14" aria-hidden>
      {heights.map((h, i) => (
        <rect
          key={i}
          x={i * 8}
          y={28 - h / 2.5}
          width="5"
          height={h / 2.5}
          rx="1"
          fill={fill}
          opacity={0.35 + i * 0.08}
        />
      ))}
    </svg>
  );
}

function SparkLine({ tone = 'primary' }) {
  const stroke =
    tone === 'error'
      ? 'var(--color-error)'
      : tone === 'tertiary'
        ? 'var(--color-tertiary)'
        : 'var(--color-primary)';
  return (
    <svg viewBox="0 0 64 28" className="h-7 w-16" aria-hidden>
      <path
        d="M2 20 C10 18, 14 8, 22 12 S34 24, 42 14 S54 6, 62 10"
        fill="none"
        stroke={stroke}
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.75"
      />
    </svg>
  );
}

function fittedErrorClass(value) {
  const length = String(value ?? '').length;
  if (length > 22) return 'text-[13px] leading-4';
  if (length > 16) return 'text-[15px] leading-5';
  if (length > 10) return 'text-[18px] leading-6';
  return 'text-[22px] leading-7';
}

function KpiCard({ label, icon, value, suffix, trend, footer, visual, fitValue = false }) {
  const valueClass = fitValue
    ? `whitespace-normal break-words font-headline-md font-bold text-on-surface ${fittedErrorClass(value)}`
    : 'truncate font-display-lg text-display-lg font-bold text-on-surface';
  return (
    <div className="flex flex-col justify-between rounded-xl bg-surface-container p-space-md shadow-sm transition-colors hover:bg-surface-container-high">
      <div className="flex items-center justify-between gap-space-xs">
        <span className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">
          {label}
        </span>
        <span className="material-symbols-outlined text-[16px] text-primary">{icon}</span>
      </div>
      <div className="my-space-sm flex items-end justify-between gap-space-sm">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex flex-wrap items-baseline gap-space-xs">
            <span className={valueClass} title={fitValue ? String(value ?? '') : undefined}>
              {value}
            </span>
            {suffix ? (
              <span className="font-label-sm text-label-sm text-outline">{suffix}</span>
            ) : null}
          </div>
          {trend ? (
            <span className="font-label-sm text-label-sm text-tertiary">{trend}</span>
          ) : null}
        </div>
        <div className="shrink-0 opacity-90">{visual}</div>
      </div>
      <div className="pt-space-xs font-code-compact text-code-compact text-outline">{footer}</div>
    </div>
  );
}

function EmptyBlock({ icon, title, detail }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-lg bg-surface-container px-space-md py-space-xl text-center">
      <span className="material-symbols-outlined text-[22px] text-outline">{icon}</span>
      <p className="font-body-sm text-body-sm text-on-surface">{title}</p>
      <p className="font-code-compact text-code-compact text-outline">{detail}</p>
    </div>
  );
}

export function OverviewPage() {
  const navigate = useNavigate();
  const { displayName } = useAuth();
  const { status, adoptResult, showToast } = useEyra();
  const [items, setItems] = useState([]);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  const welcomeName = capitalizeFirst(displayName || 'there');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const hist = await api.history({ limit: 50 });
      const list = hist.items || hist.sessions || [];
      setItems(list);
      setOffline(false);
      if (list[0]?.session_id) {
        try {
          setDetail(await api.historyDetail(list[0].session_id));
        } catch {
          setDetail(null);
        }
      } else {
        setDetail(null);
      }
    } catch {
      setItems([]);
      setDetail(null);
      setOffline(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, status?.session_count]);

  const total = status?.session_count ?? items.length;
  const active = status?.open_investigations ?? 0;
  const verified = status?.verified_count ?? 0;
  const common = useMemo(() => mostCommonError(items), [items]);
  const avgExecution = formatExecutionTime(status?.avg_execution_ms);
  const executionCount = Number(status?.execution_count || 0);
  const activity = useMemo(() => activitySeries(items, 7), [items]);
  const errorMix = useMemo(() => errorDistribution(items, 5), [items]);
  const lines = useMemo(() => snippetLines(detail), [detail]);
  const latest = detail || items[0] || null;
  const tableRows = items.slice(0, 5);
  const stackFrag = String(latest?.stack_trace || latest?.terminal_output || '')
    .split('\n')
    .filter(Boolean)
    .slice(0, 3)
    .join('\n');

  const openSession = async (sessionId) => {
    if (!sessionId) {
      navigate('/workspace');
      return;
    }
    try {
      const full = await api.historyDetail(sessionId);
      adoptResult?.(full);
      navigate('/workspace');
    } catch (err) {
      showToast?.(err?.message || 'Could not open session', 'error');
      navigate('/history');
    }
  };

  return (
    <div className="flex w-full flex-col">
      <div className="flex flex-col gap-space-lg px-space-lg py-space-md">
        {/* Welcome */}
        <div className="relative overflow-hidden rounded-xl bg-surface-container-low p-space-lg shadow-sm">
          <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-primary/10 blur-3xl" />
          <div className="relative z-10 flex flex-col gap-space-md lg:flex-row lg:items-center lg:justify-between">
            <div className="flex max-w-2xl flex-col gap-1">
              <h1 className="font-headline-lg text-headline-lg tracking-tight text-on-surface">
                Welcome, {welcomeName}
              </h1>
              <p className="font-body-md text-body-md text-on-surface-variant">
                Here&apos;s a quick overview of your runtime debugging activity.
              </p>
              {offline ? (
                <p className="font-label-sm text-label-sm text-error">
                  Brain offline — connect Brain to load overview.
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => navigate('/workspace')}
              className="flex shrink-0 items-center gap-space-xs rounded-lg bg-primary-container px-space-md py-2 font-label-md text-label-md font-semibold text-on-primary-container shadow-[0_0_16px_rgba(53,214,242,0.3)] transition-all hover:brightness-110"
            >
              <span className="material-symbols-outlined text-[16px]">play_arrow</span>
              Start Debugging
            </button>
          </div>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-1 gap-space-md sm:grid-cols-2 lg:grid-cols-5">
          <KpiCard
            label="Total Investigations"
            icon="code"
            value={loading ? '—' : total}
            trend={null}
            footer="Across all languages"
            visual={<SparkBars tone="primary" />}
          />
          <KpiCard
            label="Active Investigation"
            icon="radar"
            value={loading ? '—' : active}
            footer="In progress"
            visual={<SparkLine tone="error" />}
          />
          <KpiCard
            label="Verified Fixes"
            icon="check_circle"
            value={loading ? '—' : verified}
            footer="Successfully resolved"
            visual={<SparkLine tone="tertiary" />}
          />
          <KpiCard
            label="Most Common Error"
            icon="warning"
            value={loading ? '—' : common.label || '—'}
            suffix={common.count ? `${common.count}×` : null}
            footer={common.count ? `${common.count} occurrences` : 'No errors yet'}
            visual={<SparkBars tone="error" />}
            fitValue
          />
          <KpiCard
            label="Avg. Execution Time"
            icon="schedule"
            value={loading && !status ? '—' : avgExecution || '—'}
            footer={
              executionCount > 0
                ? `Mean of ${executionCount} run${executionCount === 1 ? '' : 's'}`
                : 'Run code to measure'
            }
            visual={<SparkLine tone="primary" />}
          />
        </div>

        {/* Recent + Last error */}
        <div className="grid grid-cols-1 gap-space-md lg:grid-cols-12">
          <section className="flex flex-col gap-space-md rounded-xl bg-surface-container-low p-space-md shadow-sm lg:col-span-7">
            <div className="flex items-center justify-between pb-space-xs">
              <div className="flex items-center gap-space-xs">
                <div className="flex h-6 w-6 items-center justify-center rounded bg-primary-container/20 text-primary">
                  <span className="material-symbols-outlined text-[15px]">history</span>
                </div>
                <h2 className="font-headline-sm text-headline-sm text-on-surface">
                  Recent Investigations
                </h2>
              </div>
              <button
                type="button"
                onClick={() => navigate('/history')}
                className="font-label-sm text-label-sm text-primary hover:underline"
              >
                View All →
              </button>
            </div>

            {!loading && items.length === 0 ? (
              <EmptyBlock
                icon="inbox"
                title="No investigations yet"
                detail="Run code in Debugging Workspace to build history."
              />
            ) : (
              <div className="overflow-x-auto rounded-lg bg-surface-container">
                <table className="w-full min-w-[520px] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-outline-variant/30 font-label-sm text-label-sm text-outline">
                      <th className="px-3 py-2 font-medium">Error Type</th>
                      <th className="px-3 py-2 font-medium">File</th>
                      <th className="px-3 py-2 font-medium">Summary</th>
                      <th className="px-3 py-2 font-medium">Time</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(loading ? [] : tableRows).map((row) => {
                      const tone = statusTone(row.status);
                      return (
                        <tr
                          key={row.session_id}
                          className="cursor-pointer border-b border-outline-variant/15 transition-colors last:border-0 hover:bg-surface-container-high"
                          onClick={() => openSession(row.session_id)}
                        >
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-2">
                              <span
                                className={`h-2 w-2 shrink-0 rounded-full ${errorDotClass(row.error_type)}`}
                              />
                              <span className="font-code-compact text-code-compact font-medium text-on-surface">
                                {displayErrorType(row.error_type)}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 font-code-compact text-code-compact text-on-surface-variant">
                            {row.file_name || '—'}
                          </td>
                          <td className="max-w-[220px] truncate px-3 py-2.5 font-body-sm text-body-sm text-outline">
                            {row.error_summary || row.root_cause || '—'}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 font-label-sm text-label-sm text-outline">
                            {relativeTime(row.created_at)}
                          </td>
                          <td className="px-3 py-2.5">
                            <span
                              className={`inline-flex rounded px-2 py-0.5 font-label-sm text-label-sm font-semibold ${statusPillClass(tone)}`}
                            >
                              {formatStatus(row.status)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                    {loading
                      ? Array.from({ length: 3 }).map((_, i) => (
                          <tr key={`sk-${i}`} className="border-b border-outline-variant/15">
                            <td colSpan={5} className="px-3 py-3">
                              <div className="h-3 w-2/3 animate-pulse rounded bg-surface-container-high" />
                            </td>
                          </tr>
                        ))
                      : null}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="flex flex-col gap-space-md rounded-xl bg-surface-container-low p-space-md shadow-sm lg:col-span-5">
            <div className="flex items-center justify-between pb-space-xs">
              <div className="flex items-center gap-space-xs">
                <span className="material-symbols-outlined text-[16px] text-error">crisis_alert</span>
                <h2 className="font-headline-sm text-headline-sm text-on-surface">
                  Last Error Snapshot
                </h2>
              </div>
              <button
                type="button"
                onClick={() => openSession(latest?.session_id)}
                className="font-label-sm text-label-sm text-primary hover:underline"
                disabled={!latest?.session_id}
              >
                View Details →
              </button>
            </div>

            {!latest ? (
              <EmptyBlock
                icon="bug_report"
                title="No error snapshot"
                detail="A failed run will show code and stack here."
              />
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-space-sm">
                  <span className="font-headline-md text-headline-md font-semibold text-error">
                    {displayErrorType(latest.error_type)}
                  </span>
                  <span className="font-label-sm text-label-sm text-outline">
                    {relativeTime(latest.created_at)}
                  </span>
                  <span
                    className={`inline-flex rounded px-2 py-0.5 font-label-sm text-label-sm font-semibold ${statusPillClass(statusTone(latest.status))}`}
                  >
                    {formatStatus(latest.status)}
                  </span>
                </div>

                <div className="overflow-x-auto rounded-lg bg-surface-container-lowest p-space-sm font-code-body text-code-body">
                  <div className="mb-1 font-label-sm text-label-sm text-outline">
                    {latest.file_name || 'snippet.py'}
                    {lines.length ? ` · lines ${lines[0].n}–${lines[lines.length - 1].n}` : ''}
                  </div>
                  {lines.length ? (
                    lines.map((ln) => (
                      <div
                        key={ln.n}
                        className={`flex items-start gap-space-md rounded px-1 ${
                          ln.hot ? 'bg-error-container/20 text-error' : 'text-on-surface-variant'
                        }`}
                      >
                        <span className="w-6 shrink-0 select-none text-right text-outline">
                          {ln.n}
                        </span>
                        <span className={`whitespace-pre ${ln.hot ? 'font-medium text-error' : ''}`}>
                          {ln.text}
                        </span>
                      </div>
                    ))
                  ) : (
                    <p className="font-code-compact text-code-compact text-outline">
                      No code snippet stored for this session.
                    </p>
                  )}
                </div>

                {stackFrag ? (
                  <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-surface-container p-space-sm font-code-compact text-code-compact text-outline">
                    {stackFrag}
                  </pre>
                ) : null}

                <div className="mt-auto flex justify-end pt-space-xs">
                  <button
                    type="button"
                    onClick={() => openSession(latest.session_id)}
                    className="flex items-center gap-1.5 rounded-lg bg-primary-container px-space-md py-1.5 font-label-md text-label-md font-semibold text-on-primary-container transition-all hover:brightness-110"
                  >
                    Open Debugging Workspace
                    <span className="material-symbols-outlined text-[15px]">arrow_forward</span>
                  </button>
                </div>
              </>
            )}
          </section>
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 gap-space-md lg:grid-cols-2">
          <section className="flex flex-col gap-space-md rounded-xl bg-surface-container-low p-space-md shadow-sm">
            <div className="flex items-center justify-between pb-space-xs">
              <div className="flex items-center gap-space-xs">
                <span className="material-symbols-outlined text-[16px] text-primary">show_chart</span>
                <h2 className="font-headline-sm text-headline-sm text-on-surface">
                  Activity (7 days)
                </h2>
              </div>
              <span className="font-label-sm text-label-sm text-outline">Sessions / day</span>
            </div>
            {loading ? (
              <div className="h-36 animate-pulse rounded-lg bg-surface-container" />
            ) : (
              <ActivityChart series={activity} />
            )}
          </section>

          <section className="flex flex-col gap-space-md rounded-xl bg-surface-container-low p-space-md shadow-sm">
            <div className="flex items-center justify-between pb-space-xs">
              <div className="flex items-center gap-space-xs">
                <span className="material-symbols-outlined text-[16px] text-error">bar_chart</span>
                <h2 className="font-headline-sm text-headline-sm text-on-surface">
                  Error distribution
                </h2>
              </div>
              <span className="font-label-sm text-label-sm text-outline">Top types</span>
            </div>
            {loading ? (
              <div className="h-36 animate-pulse rounded-lg bg-surface-container" />
            ) : (
              <ErrorMixChart rows={errorMix} />
            )}
          </section>
        </div>

        {/* Quick Access */}
        <section className="flex flex-col gap-space-md">
          <h2 className="font-headline-sm text-headline-sm text-on-surface">Quick Access</h2>
          <div className="grid grid-cols-1 gap-space-md sm:grid-cols-2 xl:grid-cols-4">
            {[
              {
                to: '/workspace',
                title: 'Debugging Workspace',
                detail: 'Write, run and debug your code',
                icon: 'terminal',
                accent: 'border-primary/40 bg-primary/10 text-primary',
              },
              {
                to: '/analysis',
                title: 'Analysis Results',
                detail: 'View detailed analysis, complexity and tests',
                icon: 'analytics',
                accent: 'border-secondary/40 bg-secondary/10 text-secondary',
              },
              {
                to: '/memory',
                title: 'Memory & Knowledge',
                detail: 'Reuse past fixes and learnings',
                icon: 'database',
                accent: 'border-tertiary/40 bg-tertiary/10 text-tertiary',
              },
              {
                to: '/history',
                title: 'Investigation History',
                detail: 'Browse and search past investigations',
                icon: 'schedule',
                accent: 'border-warning/40 bg-warning/10 text-warning',
              },
            ].map((card) => (
              <button
                key={card.to}
                type="button"
                onClick={() => navigate(card.to)}
                className="group flex min-h-[7.5rem] flex-col justify-between rounded-xl border border-outline-variant/25 bg-surface-container p-space-md text-left shadow-sm transition-colors hover:bg-surface-container-high"
              >
                <div className="flex items-start justify-between gap-space-sm">
                  <div
                    className={`flex h-9 w-9 items-center justify-center rounded-lg border ${card.accent}`}
                  >
                    <span className="material-symbols-outlined text-[18px]">{card.icon}</span>
                  </div>
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-container-high text-outline transition-colors group-hover:bg-primary-container group-hover:text-on-primary-container">
                    <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                  </span>
                </div>
                <div className="mt-space-md flex flex-col gap-0.5">
                  <span className="font-headline-sm text-headline-sm text-on-surface">
                    {card.title}
                  </span>
                  <span className="font-body-sm text-body-sm text-on-surface-variant">
                    {card.detail}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
