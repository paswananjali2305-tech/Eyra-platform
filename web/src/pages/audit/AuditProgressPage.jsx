import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client';
import { useEyra } from '../../context/EyraContext';
import { mapIssueToFinding } from '../../lib/auditScanMap.js';
import AuditProgressStitch from '../stitch_raw/audit/AuditProgressPage.jsx';

/**
 * Repository assessment pipeline — eight stages with explicit completion intent.
 * Labels describe what the stage should verify; UI does not claim every check
 * already runs until scan evidence marks the stage complete.
 */
const PIPELINE_STAGES = [
  {
    id: 1,
    title: 'Repository Intake & Integrity',
    idle: 'Waiting for ZIP / Git ingest',
    doneAt: 8,
    checks: 'Validate source, structure, inventory, extraction safety',
  },
  {
    id: 2,
    title: 'File Discovery & Language Detection',
    idle: 'Not started',
    doneAt: 18,
    checks: 'Supported languages, source/config/tests, generated & excluded files',
  },
  {
    id: 3,
    title: 'Parsing & Syntax Validation',
    idle: 'Not started',
    doneAt: 32,
    checks: 'Parse supported files; surface syntax errors and parser failures',
  },
  {
    id: 4,
    title: 'Static Code Quality Analysis',
    idle: 'Not started',
    doneAt: 48,
    checks: 'Complexity, long functions, smells, maintainability rules',
  },
  {
    id: 5,
    title: 'Security & Dependency Audit',
    idle: 'Not started',
    doneAt: 64,
    checks: 'Insecure patterns, secrets, manifests, known vulnerabilities',
  },
  {
    id: 6,
    title: 'AI-Assisted Code Review',
    idle: 'Not started',
    doneAt: 80,
    checks: 'Evidence-backed review; flag uncertain / possible false positives',
  },
  {
    id: 7,
    title: 'Finding Correlation & Prioritization',
    idle: 'Not started',
    doneAt: 92,
    checks: 'Deduplicate, map file/line, impact & confidence, prioritize',
  },
  {
    id: 8,
    title: 'Report, Patch & Validation',
    idle: 'Not started',
    doneAt: 100,
    checks: 'Report + proposed diffs; run tests/re-analysis; report outcomes',
  },
];

/** Classify finding provenance for the snapshot (rule vs AI). */
function findingOrigin(iss) {
  const blob = `${iss?.source || ''} ${iss?.engine || ''} ${iss?.type || ''} ${iss?.ruleId || ''} ${iss?.origin || ''}`;
  if (/ai|groq|llm|gpt|semantic|assist/i.test(blob)) return 'AI';
  if (/live|rule|static|bandit|semgrep|cve|dep|security|syntax|metric/i.test(blob)) return 'Rule';
  if (iss?.ruleId) return 'Rule';
  return 'Review';
}

function findingEvidence(iss) {
  const path = String(iss?.file || '').replace(/\\/g, '/');
  const line = iss?.line != null ? `:${iss.line}` : '';
  const snip = String(iss?.snippet || iss?.evidence || '')
    .trim()
    .split('\n')[0]
    .slice(0, 72);
  if (path && snip) return `${path}${line} · ${snip}`;
  if (path) return `${path}${line}`;
  return snip || 'No source evidence attached';
}

function isRunningScan(scan) {
  const st = String(scan?.status || '').toLowerCase();
  return st === 'analyzing' || st === 'pending';
}

/** Live or finished scan still worth showing on Progress (not a blank idle shell). */
function isDisplayableScan(scan) {
  if (!scan?.id) return false;
  const st = String(scan.status || '').toLowerCase();
  return (
    st === 'analyzing' ||
    st === 'pending' ||
    st === 'completed' ||
    st === 'cancelled' ||
    st === 'failed'
  );
}

function severityCounts(scan) {
  const fromSummary = scan?.summary?.severity;
  if (fromSummary && typeof fromSummary === 'object') {
    return {
      critical: Number(fromSummary.Critical || 0),
      high: Number(fromSummary.High || 0),
      medium: Number(fromSummary.Medium || 0),
      low: Number(fromSummary.Low || 0),
    };
  }
  const issues = Array.isArray(scan?.issues) ? scan.issues : [];
  const out = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const iss of issues) {
    const s = String(iss.severity || '').toLowerCase();
    if (s.startsWith('crit')) out.critical += 1;
    else if (s.startsWith('high')) out.high += 1;
    else if (s.startsWith('med')) out.medium += 1;
    else out.low += 1;
  }
  return out;
}

/** SVG donut for severity mix — zeros only when no scan / no findings. */
function SeverityDonut({ scan }) {
  const sev = severityCounts(isDisplayableScan(scan) ? scan : null);
  const segments = [
    { key: 'Critical', value: sev.critical, color: '#ff6b7a' },
    { key: 'High', value: sev.high, color: '#c4a0ff' },
    { key: 'Medium', value: sev.medium, color: '#8b9bb4' },
    { key: 'Low', value: sev.low, color: '#35d6f2' },
  ];
  const total = segments.reduce((a, s) => a + s.value, 0);
  // Thick ring + smaller center hole so segment colors read clearly
  const size = 168;
  const stroke = 38;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;

  const arcs =
    total === 0
      ? [
          {
            key: 'empty',
            color: 'rgba(255,255,255,0.45)',
            dash: c,
            gap: 0,
            offset: 0,
          },
        ]
      : segments
          .filter((s) => s.value > 0)
          .map((s) => {
            const len = (s.value / total) * c;
            const arc = { key: s.key, color: s.color, dash: len, gap: c - len, offset };
            offset += len;
            return arc;
          });

  return (
    <div className="flex flex-1 flex-col rounded-xl bg-surface-container-low p-space-md shadow-sm">
      <div className="mb-space-sm flex items-center justify-between">
        <span className="font-headline-sm text-headline-sm font-semibold text-on-surface">
          Severity Mix
        </span>
        <span className="font-code-compact text-code-compact text-outline">
          {total ? `${total} total` : 'No data'}
        </span>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-space-md sm:flex-row sm:items-center">
        <div className="relative shrink-0" style={{ width: size, height: size }}>
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
            {arcs.map((arc) => (
              <circle
                key={arc.key}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={arc.color}
                strokeWidth={stroke}
                strokeDasharray={`${arc.dash} ${arc.gap}`}
                strokeDashoffset={-arc.offset}
                strokeLinecap="butt"
              />
            ))}
          </svg>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[1.35rem] font-bold leading-none text-white">{total}</span>
            <span className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-white/70">
              findings
            </span>
          </div>
        </div>
        <div className="flex w-full max-w-[12rem] flex-col gap-space-xs">
          {segments.map((s) => (
            <div
              key={s.key}
              className="flex items-center justify-between font-code-compact text-code-compact text-white/80"
            >
              <span className="flex items-center gap-space-xs">
                <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                {s.key}
              </span>
              <span className="font-semibold text-white">{s.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function engineLabel(scan) {
  if (!scan) return 'Execution Engine: —';
  const e = scan.engines || {};
  const parts = [];
  if (e.ast !== false) parts.push('AST');
  if (e.cve !== false) parts.push('CVE');
  if (e.ai) parts.push('AI');
  if (e.offline) parts.push('offline');
  if (!parts.length) parts.push('configured');
  return `Execution Engine: ${parts.join(' + ')}`;
}

function sourceLine(scan) {
  if (!scan) return 'Source: none — upload a ZIP or connect a repo';
  if (scan.sourceLabel) return scan.sourceLabel;
  if (scan.sourceType === 'github') {
    return `Source: GitHub (${scan.archiveName || scan.projectName || 'repository'})`;
  }
  const zip = scan.archiveName || `${scan.projectName || 'archive'}.zip`;
  return `Source: ZIP Archive (${zip})`;
}

function statusPill(scan) {
  if (!scan) return 'ANALYZING (0%)';
  const pct = typeof scan.progress === 'number' ? Math.round(scan.progress) : 0;
  const st = String(scan.status || 'pending').toLowerCase();
  if (st === 'completed') return `COMPLETED (${pct || 100}%)`;
  if (st === 'cancelled') return `CANCELLED (${pct}%)`;
  if (st === 'failed') return `FAILED (${pct}%)`;
  if (st === 'pending') return `PENDING (${pct}%)`;
  if (st === 'analyzing') return `ANALYZING (${pct}%)`;
  return `${st.toUpperCase()} (${pct}%)`;
}

function speedLabel(scan) {
  if (!scan) return 'Speed: —';
  const loc = Number(scan.summary?.totalLoc || 0);
  const pct = typeof scan.progress === 'number' ? scan.progress : 0;
  if (scan.status === 'completed' && loc > 0) return `Speed: ${loc.toLocaleString()} LOC total`;
  if (scan.status === 'analyzing' && pct > 0) return `Progress: ${Math.round(pct)}%`;
  if (scan.status === 'cancelled') return 'Speed: stopped';
  return 'Speed: —';
}

function formatElapsed(scan) {
  if (!scan?.createdAt) return '—';
  const start = new Date(scan.createdAt).getTime();
  const end = scan.completedAt ? new Date(scan.completedAt).getTime() : Date.now();
  if (!Number.isFinite(start)) return '—';
  const sec = Math.max(0, (end - start) / 1000);
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(1);
  return `${m}:${String(s).padStart(4, '0')}s`;
}

function etaLabel(scan) {
  if (!scan) return 'ETA —';
  const st = scan.status;
  if (st === 'completed') return 'Done';
  if (st === 'cancelled') return 'Stopped';
  if (st === 'failed') return 'Failed';
  if (st === 'analyzing') return 'ETA —';
  return 'ETA —';
}

/** Hide entire Stitch mock body — live React owns header, KPIs, pipeline, findings. */
function hideAllStitchMock(root) {
  if (!root) return;
  const shell =
    root.querySelector('.flex.flex-col.w-full') ||
    root.querySelector(':scope > div') ||
    root.firstElementChild;
  if (!shell) return;
  if (!shell.dataset.eyraLiveHidden) {
    shell.style.display = 'none';
    shell.dataset.eyraLiveHidden = '1';
  }
}

function stageBand(stage) {
  const prevDone = stage.id === 1 ? 0 : PIPELINE_STAGES[stage.id - 2].doneAt;
  return { prevDone, width: Math.max(1, stage.doneAt - prevDone) };
}

function formatStageDuration(ms) {
  const sec = Math.max(0, Number(ms) || 0) / 1000;
  if (sec < 0.1) return '0.1s';
  return `${sec.toFixed(1)}s`;
}

/** Progress-band share of total scan elapsed — used when live cross timestamps unavailable. */
function estimateStageDurationsMs(scan) {
  if (!isDisplayableScan(scan)) return {};
  const start = Date.parse(scan.scanStartedAt || scan.createdAt);
  if (!Number.isFinite(start)) return {};
  const end = scan.completedAt ? Date.parse(scan.completedAt) : Date.now();
  const totalMs = Math.max(0, (Number.isFinite(end) ? end : Date.now()) - start);
  const pct = typeof scan.progress === 'number' ? scan.progress : 0;
  const status = String(scan.status || '').toLowerCase();
  const out = {};
  for (const stage of PIPELINE_STAGES) {
    const done = status === 'completed' || pct >= stage.doneAt;
    if (!done) continue;
    const { width } = stageBand(stage);
    out[stage.id] = (width / 100) * totalMs;
  }
  return out;
}

function stageState(scan, stage) {
  if (!isDisplayableScan(scan)) {
    return { kind: 'idle', label: 'NOT STARTED', detail: stage.idle || stage.checks };
  }
  const pct = typeof scan.progress === 'number' ? scan.progress : 0;
  const status = String(scan.status || '').toLowerCase();
  if (status === 'cancelled') {
    if (pct >= stage.doneAt) {
      return { kind: 'done', label: 'DONE', detail: scan.currentStage || 'Completed before cancel' };
    }
    if (pct + 20 >= stage.doneAt) {
      return { kind: 'cancelled', label: 'CANCELLED', detail: scan.currentStage || 'Cancelled by user' };
    }
    return { kind: 'idle', label: 'STOPPED', detail: 'Not started' };
  }
  if (status === 'failed') {
    if (pct >= stage.doneAt) return { kind: 'done', label: 'DONE', detail: 'Stage complete' };
    const { prevDone } = stageBand(stage);
    if (pct >= prevDone) {
      return { kind: 'cancelled', label: 'FAILED', detail: scan.error || scan.currentStage || 'Failed' };
    }
    return { kind: 'idle', label: 'STOPPED', detail: 'Not started' };
  }
  if (pct >= stage.doneAt || status === 'completed') {
    return {
      kind: 'done',
      label: 'DONE',
      detail: stage.checks || 'Stage completion criteria met for this run',
    };
  }
  // Active band: next incomplete stage (in-flight only)
  if (!isRunningScan(scan)) {
    return { kind: 'idle', label: 'NOT STARTED', detail: stage.idle || stage.checks };
  }
  const { prevDone, width } = stageBand(stage);
  if (pct >= prevDone) {
    const local = Math.round(((pct - prevDone) / width) * 100);
    const shown = Math.min(99, Math.max(1, local));
    return {
      kind: 'active',
      label: `ACTIVE (${shown}%)`,
      detail: scan.currentStage || stage.checks || 'Running…',
      barPct: shown,
    };
  }
  return { kind: 'queued', label: 'QUEUED', detail: 'Waiting for prior stages' };
}

function LivePipeline({ scan }) {
  const active = isDisplayableScan(scan);
  const running = isRunningScan(scan);
  const pct = typeof scan?.progress === 'number' ? scan.progress : 0;
  const status = String(scan?.status || '').toLowerCase();
  const doneCount = active
    ? PIPELINE_STAGES.filter((s) => pct >= s.doneAt || status === 'completed').length
    : 0;
  const evaluating = running && status === 'analyzing';
  const phaseLabel = evaluating
    ? 'EVALUATING'
    : running
      ? 'RUNNING'
      : status === 'completed'
        ? 'COMPLETE'
        : status === 'cancelled'
          ? 'CANCELLED'
          : status === 'failed'
            ? 'FAILED'
            : 'IDLE';

  // Live threshold crosses → per-step durations while watching; else band estimate
  const timingRef = useRef({ scanId: null, startMs: null, lastPct: null, crossedAt: {} });
  const [, setTimingTick] = useState(0);

  useEffect(() => {
    if (!scan?.id) return;
    const startMs = Date.parse(scan.scanStartedAt || scan.createdAt);
    if (timingRef.current.scanId !== scan.id) {
      timingRef.current = {
        scanId: scan.id,
        startMs: Number.isFinite(startMs) ? startMs : Date.now(),
        lastPct: null,
        crossedAt: {},
      };
    } else if (Number.isFinite(startMs) && !timingRef.current.startMs) {
      timingRef.current.startMs = startMs;
    }
    const now = Date.now();
    const progress = typeof scan.progress === 'number' ? scan.progress : 0;
    const prevPct = timingRef.current.lastPct;
    // Only stamp when we observe a live cross (not on hydrate of a finished scan)
    if (running && prevPct != null) {
      for (const stage of PIPELINE_STAGES) {
        if (
          prevPct < stage.doneAt &&
          progress >= stage.doneAt &&
          timingRef.current.crossedAt[stage.id] == null
        ) {
          timingRef.current.crossedAt[stage.id] = now;
        }
      }
    }
    timingRef.current.lastPct = progress;
  }, [scan?.id, scan?.progress, scan?.status, scan?.scanStartedAt, scan?.createdAt, running]);

  useEffect(() => {
    if (!running) return undefined;
    const id = window.setInterval(() => setTimingTick((n) => n + 1), 400);
    return () => window.clearInterval(id);
  }, [running, scan?.id]);

  const estimated = useMemo(() => estimateStageDurationsMs(scan), [scan]);

  function sideMeta(stage, st) {
    if (st.kind === 'done') {
      const crossed = timingRef.current.crossedAt[stage.id];
      const startMs = timingRef.current.startMs;
      if (crossed != null && startMs != null) {
        const prev = PIPELINE_STAGES[stage.id - 2];
        const prevAt =
          stage.id === 1
            ? startMs
            : timingRef.current.crossedAt[prev.id] != null
              ? timingRef.current.crossedAt[prev.id]
              : startMs;
        const liveMs = crossed - prevAt;
        if (liveMs >= 50) return formatStageDuration(liveMs);
      }
      if (estimated[stage.id] != null) return formatStageDuration(estimated[stage.id]);
    }
    return st.label;
  }

  return (
    <div className="flex flex-col gap-space-md rounded-xl bg-surface-container-low p-space-md shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-space-xs">
          <span className="material-symbols-outlined text-[18px] text-primary">account_tree</span>
          <span className="font-headline-sm text-headline-sm font-semibold text-on-surface">
            Repository Assessment Pipeline
          </span>
        </div>
        <span className="font-code-compact text-code-compact text-outline">
          STAGES {doneCount}/8 {phaseLabel}
        </span>
      </div>
      <p className="font-body-sm text-[11px] leading-snug text-outline">
        Stage rows are approximate progress bands mapped from backend percent updates — not
        verified per-engine completion. Tool statuses (AST / Ruff / Radon / deps / AI) on the
        scan payload are the authoritative check results. pytest is not run on untrusted uploads.
        {scan?.outcomeStatus === 'completed_with_limitations'
          ? ' This scan completed with documented analyzer limitations.'
          : ''}
        {scan?.summary?.analysisLimitation
          ? ` Limitation: ${scan.summary.analysisLimitation}`
          : ''}
      </p>
      <div className="flex flex-col gap-space-xs">
        {PIPELINE_STAGES.map((stage) => {
          const st = stageState(scan, stage);
          const meta = sideMeta(stage, st);
          const rowClass =
            st.kind === 'active'
              ? 'relative overflow-hidden rounded-lg bg-surface-container-high p-space-sm shadow-md'
              : st.kind === 'done'
                ? 'rounded-lg bg-surface-container-lowest/60 p-space-sm'
                : 'rounded-lg bg-surface-container-lowest/30 p-space-sm opacity-60';
          return (
            <div key={stage.id} className={`flex items-start gap-space-md ${rowClass}`}>
              {st.kind === 'active' ? (
                <div className="absolute bottom-0 left-0 top-0 w-1 bg-primary" />
              ) : null}
              <div
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                  st.kind === 'done'
                    ? 'bg-tertiary-container/20'
                    : st.kind === 'active'
                      ? 'bg-primary/20'
                      : 'bg-surface-container'
                }`}
              >
                <span
                  className={`material-symbols-outlined text-[16px] ${
                    st.kind === 'done'
                      ? 'text-tertiary'
                      : st.kind === 'active'
                        ? 'animate-spin text-primary'
                        : 'text-outline'
                  }`}
                >
                  {st.kind === 'done' ? 'check' : st.kind === 'active' ? 'sync' : 'hourglass_empty'}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-space-sm">
                  <span
                    className={`truncate font-body-md text-body-md ${
                      st.kind === 'active'
                        ? 'font-bold text-primary'
                        : st.kind === 'done'
                          ? 'font-medium text-on-surface'
                          : 'text-on-surface-variant'
                    }`}
                  >
                    {stage.id}. {stage.title}
                  </span>
                  <span
                    className={`shrink-0 font-code-compact text-code-compact ${
                      st.kind === 'active'
                        ? 'font-bold text-primary'
                        : st.kind === 'done'
                          ? 'font-semibold text-tertiary'
                          : 'text-outline'
                    }`}
                  >
                    {meta}
                  </span>
                </div>
                <p
                  className={`mt-space-2xs font-code-compact text-code-compact ${
                    st.kind === 'active' ? 'text-on-surface' : 'text-on-surface-variant'
                  }`}
                >
                  {st.detail}
                </p>
                {stage.checks && (st.kind === 'active' || st.kind === 'queued') ? (
                  <p className="mt-0.5 font-body-sm text-[10px] leading-snug text-outline">
                    Criteria: {stage.checks}
                  </p>
                ) : null}
                {st.kind === 'active' ? (
                  <div className="mt-space-xs h-1.5 w-full overflow-hidden rounded-full bg-surface-container-lowest">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-300"
                      style={{
                        width: `${Math.max(0, Math.min(100, st.barPct ?? pct))}%`,
                      }}
                    />
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LiveFindings({ scan, onOpen }) {
  const issues = Array.isArray(scan?.issues) ? scan.issues : [];
  const status = String(scan?.status || '').toLowerCase();
  const rows = issues.slice(0, 4).map((iss) => {
    const f = mapIssueToFinding(iss);
    const path = (iss.file || '').replace(/\\/g, '/');
    const line = iss.line != null ? `:${iss.line}` : '';
    const origin = findingOrigin(iss);
    return {
      id: iss.id || `${path}:${iss.line}:${f?.title}`,
      title: f?.title || 'Finding',
      loc: path ? `${path}${line}` : '—',
      badge: f?.cwe || iss.ruleId || iss.type || '—',
      severity: String(f?.severity || iss.severity || '').toLowerCase(),
      origin,
      evidence: findingEvidence(iss),
    };
  });
  const aiCount = issues.filter((i) => findingOrigin(i) === 'AI').length;
  const ruleCount = issues.filter((i) => findingOrigin(i) === 'Rule').length;
  const extra = Math.max(0, issues.length - rows.length);
  const snapLabel =
    !scan
      ? 'Empty'
      : status === 'completed'
        ? issues.length
          ? 'Final'
          : 'Empty'
        : issues.length
          ? 'Live'
          : 'Empty';

  return (
    <div className="flex flex-col gap-space-sm rounded-xl bg-surface-container-low p-space-md shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-headline-sm text-headline-sm font-semibold text-on-surface">
          Candidate Findings Snapshot
        </span>
        <span className="font-code-compact text-code-compact text-primary">{snapLabel}</span>
      </div>
      {issues.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 font-code-compact text-[10px]">
          <span className="rounded bg-tertiary/15 px-1.5 py-0.5 text-tertiary">
            {ruleCount} rule-based
          </span>
          <span className="rounded bg-secondary/15 px-1.5 py-0.5 text-secondary">
            {aiCount} AI-assisted
          </span>
          <span className="rounded bg-surface-container px-1.5 py-0.5 text-outline">
            {Math.max(0, issues.length - ruleCount - aiCount)} other
          </span>
        </div>
      ) : null}
      <div className="mt-space-2xs flex min-h-[7.5rem] flex-col gap-space-xs">
        {rows.length === 0 ? null : (
          rows.map((row) => (
            <div
              key={row.id}
              className="flex flex-col gap-1 rounded-lg bg-surface-container-lowest p-space-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-space-xs">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      row.severity.startsWith('crit') || row.severity.startsWith('high')
                        ? 'bg-error'
                        : 'bg-secondary'
                    }`}
                  />
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate font-body-sm text-body-sm font-semibold text-on-surface">
                      {row.title}
                    </span>
                    <span className="truncate font-code-compact text-code-compact text-on-surface-variant">
                      {row.loc}
                    </span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <span
                    className={`rounded px-1 py-px font-label-sm text-[9px] font-bold uppercase ${
                      row.origin === 'AI'
                        ? 'bg-secondary/20 text-secondary'
                        : row.origin === 'Rule'
                          ? 'bg-tertiary/20 text-tertiary'
                          : 'bg-surface-container text-outline'
                    }`}
                  >
                    {row.origin}
                  </span>
                  <span className="rounded bg-error/20 px-space-xs py-space-2xs font-label-sm text-label-sm font-bold uppercase text-error">
                    {row.badge}
                  </span>
                </div>
              </div>
              <p className="truncate font-code-compact text-[10px] text-outline" title={row.evidence}>
                Evidence: {row.evidence}
              </p>
            </div>
          ))
        )}
      </div>
      <div className="mt-space-xs flex items-center justify-between font-code-compact text-code-compact">
        <span className="text-on-surface-variant">
          {extra > 0 ? `+ ${extra} more issue${extra === 1 ? '' : 's'}` : issues.length ? 'All shown' : ''}
        </span>
        <button type="button" onClick={onOpen} className="text-primary hover:underline">
          Open in Code Audit →
        </button>
      </div>
    </div>
  );
}

function formatLogTs(ts) {
  if (!ts) return new Date().toLocaleTimeString();
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  return d.toLocaleTimeString();
}

function toneFromLogLevel(level, tag) {
  const lv = String(level || '').toLowerCase();
  const tg = String(tag || '').toUpperCase();
  if (lv === 'error' || tg === 'FAIL' || tg === 'ERROR') return 'error';
  if (lv === 'warn' || tg === 'WARN') return 'warn';
  if (lv === 'ok' || tg === 'DONE' || tg === 'OK') return 'ok';
  if (lv === 'exec' || tg === 'EXEC') return 'exec';
  if (lv === 'active') return 'active';
  return 'info';
}

function mapScanLogsToLines(logs) {
  if (!Array.isArray(logs) || !logs.length) return [];
  return logs.map((entry, idx) => {
    const tag = String(entry.tag || '').toUpperCase() || 'INFO';
    const tone = toneFromLogLevel(entry.level, tag);
    const message = String(entry.text || '').trim();
    return {
      key: `${entry.ts || idx}-${tag}-${message}`,
      ts: entry.elapsed || formatLogTs(entry.ts),
      tag,
      message,
      tone,
    };
  });
}

function daemonPidLabel(scanId) {
  if (!scanId) return 'audit-daemon';
  const digits = String(scanId).replace(/\D/g, '').slice(-4);
  const pid = digits || String(scanId).slice(0, 4);
  return `audit-daemon-pid-${pid}`;
}

function TerminalLine({ line }) {
  const ts = <span className="text-outline">[{line.ts}]</span>;
  if (line.tone === 'warn' || line.tone === 'error') {
    return (
      <div className="rounded bg-error/15 px-1.5 py-0.5 text-[#f2a4a4]">
        {ts}{' '}
        <span className="font-semibold">[{line.tag}]</span> {line.message}
      </div>
    );
  }
  if (line.tone === 'ok') {
    return (
      <div className="px-0.5 text-tertiary">
        {ts}{' '}
        <span className="font-semibold">[{line.tag}]</span> {line.message}
      </div>
    );
  }
  if (line.tone === 'exec') {
    return (
      <div className="px-0.5 text-on-surface-variant">
        {ts}{' '}
        <span className="text-outline">&gt;</span>{' '}
        <span className="font-semibold text-primary">[{line.tag}]</span>{' '}
        {line.message}
      </div>
    );
  }
  return (
    <div className="px-0.5 text-on-surface-variant">
      {ts}{' '}
      <span className="font-semibold text-on-surface/80">[{line.tag}]</span> {line.message}
    </div>
  );
}

/** STDOUT feed chrome matching design — real daemon logs from scan.logs. */
function LiveTerminal({ lines, running, statusLabel, scanId }) {
  const paneRef = useRef(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const feedLabel = statusLabel || (running ? 'LIVE' : 'IDLE');

  useEffect(() => {
    if (!autoScroll || !paneRef.current) return;
    paneRef.current.scrollTop = paneRef.current.scrollHeight;
  }, [lines, autoScroll]);

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-outline-variant/15 bg-[#0d1117] shadow-sm">
      <div className="flex items-center justify-between border-b border-white/5 px-space-md py-space-sm">
        <div className="flex items-center gap-space-sm">
          <div className="flex items-center gap-1">
            <div className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
            <div className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
            <div className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
          </div>
          <span className="font-code-compact text-[11px] font-semibold tracking-wide text-[#8b949e]">
            STDOUT FEED · {daemonPidLabel(scanId)}
          </span>
        </div>
        <div className="flex items-center gap-space-md font-code-compact text-[11px] text-[#8b949e]">
          <label className="flex cursor-pointer items-center gap-space-xs">
            <input
              type="checkbox"
              className="h-3 w-3 rounded accent-primary"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
            />
            <span>Auto-scroll</span>
          </label>
          <span
            className={`flex items-center gap-1.5 font-semibold uppercase tracking-wider ${
              feedLabel === 'FAILED'
                ? 'text-error'
                : feedLabel === 'DONE' || feedLabel === 'LIVE'
                  ? 'text-[#3fb950]'
                  : 'text-[#8b949e]'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                running
                  ? 'animate-pulse bg-[#3fb950]'
                  : feedLabel === 'FAILED'
                    ? 'bg-error'
                    : lines.length
                      ? 'bg-[#3fb950]'
                      : 'bg-[#484f58]'
              }`}
            />
            {feedLabel}
          </span>
        </div>
      </div>
      <div
        ref={paneRef}
        id="terminal-pane"
        className="min-h-[10.5rem] max-h-64 space-y-1 overflow-y-auto bg-[#010409] px-space-md py-space-sm font-code-compact text-[12px] leading-relaxed"
      >
        {!lines.length ? (
          <div className="text-[#8b949e]">
            <span className="text-[#484f58]">[—]</span> Waiting for audit output…
          </div>
        ) : (
          lines.map((line) => <TerminalLine key={line.key || `${line.ts}-${line.message}`} line={line} />)
        )}
      </div>
    </div>
  );
}

function LiveHeader({ scan, onPartial, onPrimary }) {
  const running = isRunningScan(scan);
  const shown = isDisplayableScan(scan);
  const status = String(scan?.status || '').toLowerCase();
  const completed = status === 'completed';
  const idShort = shown && scan?.id ? String(scan.id).slice(0, 8) : '—';
  const project = shown && scan?.projectName ? scan.projectName : 'No project';
  const issues = shown
    ? scan?.summary?.totalIssues != null
      ? Number(scan.summary.totalIssues)
      : Array.isArray(scan?.issues)
        ? scan.issues.length
        : 0
    : 0;
  const analyzing = status === 'analyzing';
  const findingsLabel = completed ? 'View Findings' : 'View Partial Findings';
  const primaryLabel = running
    ? 'Cancel Audit'
    : completed
      ? 'Open Code Audit'
      : status === 'cancelled' || status === 'failed'
        ? 'New Audit'
        : 'Start Audit';
  const primaryIcon = running
    ? 'power_settings_new'
    : completed
      ? 'fact_check'
      : 'play_arrow';

  return (
    <div className="flex flex-col gap-space-md md:flex-row md:items-center md:justify-between">
      <div className="flex flex-col gap-space-2xs">
        <div className="flex items-center gap-space-xs font-label-sm text-label-sm text-outline">
          <span>Codebase Audit</span>
          <span>/</span>
          <span>Scans</span>
          <span>/</span>
          <span className="font-semibold text-primary">
            #{idShort} ({shown ? status || 'idle' : 'idle'})
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-space-md">
          <div className="flex items-center gap-space-xs">
            <span className="font-headline-md text-headline-md font-bold tracking-tight text-on-surface">
              {project}
            </span>
            <span className="rounded bg-surface-container-high px-space-xs py-space-2xs font-code-compact text-code-compact text-on-surface-variant">
              {shown ? `id ${idShort}` : 'no scan'}
            </span>
          </div>
          <div className="flex items-center gap-space-xs rounded bg-surface-container-low px-space-sm py-space-2xs font-code-compact text-code-compact text-on-surface-variant">
            <span className="material-symbols-outlined text-[15px] text-outline">
              {shown && scan?.sourceType === 'github' ? 'cloud' : 'folder_zip'}
            </span>
            <span>{shown ? sourceLine(scan) : 'Source: none — upload a ZIP or connect a repo'}</span>
          </div>
          <div className="inline-flex items-center gap-space-xs rounded bg-primary/10 px-space-sm py-space-2xs font-label-sm text-label-sm font-semibold uppercase tracking-wider text-primary">
            {analyzing ? (
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary-container opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
              </span>
            ) : null}
            <span>{shown ? statusPill(scan) : 'IDLE'}</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-space-sm self-start md:self-auto">
        <button
          type="button"
          onClick={onPartial}
          className="group flex items-center gap-space-xs rounded bg-surface-container-high px-space-md py-space-2xs font-body-sm text-body-sm text-on-surface shadow-sm transition-all hover:bg-surface-container-highest"
        >
          <span className="material-symbols-outlined text-[16px] text-primary">visibility</span>
          <span>{findingsLabel}</span>
          <span className="ml-1 rounded bg-surface-container-lowest px-space-xs font-label-sm text-label-sm font-bold text-tertiary">
            {issues}
          </span>
        </button>
        {running ? (
          <button
            type="button"
            onClick={onPrimary}
            className="flex items-center gap-space-xs rounded bg-error-container/20 px-space-md py-space-2xs font-body-sm text-body-sm text-error shadow-sm transition-all hover:bg-error-container/40"
          >
            <span className="material-symbols-outlined text-[16px]">{primaryIcon}</span>
            <span>{primaryLabel}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onPrimary}
            className="flex items-center gap-space-xs rounded bg-primary-container/20 px-space-md py-space-2xs font-body-sm text-body-sm text-primary shadow-sm transition-all hover:bg-primary-container/40"
          >
            <span className="material-symbols-outlined text-[16px]">{primaryIcon}</span>
            <span>{primaryLabel}</span>
          </button>
        )}
      </div>
    </div>
  );
}

function LiveKpis({ scan }) {
  // In-flight + completed/cancelled/failed keep KPI snapshot; true idle → zeros
  const live = isDisplayableScan(scan) ? scan : null;
  const status = String(live?.status || '').toLowerCase();
  const rawPct = typeof live?.progress === 'number' ? live.progress : 0;
  const pct =
    status === 'completed'
      ? 100
      : Math.max(0, Math.min(100, rawPct));
  // Discovered = inventory; analyzed = files that reached analysis (or progress estimate)
  const filesDiscovered = Number(
    live?.meta?.discoveredFilesCount ??
      live?.meta?.totalFilesCount ??
      live?.summary?.totalFiles ??
      0,
  );
  const filesAnalyzedExplicit = Number(
    live?.meta?.analyzedFilesCount ?? live?.summary?.analyzedFiles ?? NaN,
  );
  const filesAnalyzed = Number.isFinite(filesAnalyzedExplicit)
    ? filesAnalyzedExplicit
    : status === 'completed' && filesDiscovered
      ? filesDiscovered
      : Math.min(filesDiscovered, Math.round((filesDiscovered * pct) / 100));
  // LOC is counted from inventory today — label as detected, not analyzed
  const locDetected = Number(live?.summary?.totalLoc ?? live?.meta?.totalLoc ?? 0);
  const locProgress =
    status === 'completed' && locDetected
      ? locDetected
      : Math.min(locDetected, Math.round((locDetected * pct) / 100));
  const totalIssues =
    live?.summary?.totalIssues != null
      ? Number(live.summary.totalIssues)
      : Array.isArray(live?.issues)
        ? live.issues.length
        : 0;
  const sev = severityCounts(live);
  const findingsBadge =
    status === 'completed'
      ? 'DONE'
      : status === 'cancelled'
        ? 'STOPPED'
        : status === 'failed'
          ? 'FAILED'
          : live
            ? 'LIVE'
            : 'IDLE';

  return (
    <div className="grid grid-cols-1 gap-gutter md:grid-cols-2 lg:grid-cols-5">
      <div className="relative flex flex-col justify-between overflow-hidden rounded-xl bg-surface-container-low p-space-md shadow-sm lg:col-span-2">
        <div className="mb-space-xs flex items-center justify-between">
          <span className="font-label-sm text-label-sm uppercase tracking-wider text-outline">
            Overall Progress
          </span>
          <span className="font-code-body text-headline-sm font-bold text-primary">{pct.toFixed(1)}%</span>
        </div>
        <div className="relative my-space-xs h-2 w-full overflow-hidden rounded-full bg-surface-container-lowest">
          <div
            className="h-full rounded-full bg-gradient-to-r from-secondary-container via-primary-container to-primary transition-all duration-500 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex items-center justify-between font-code-compact text-code-compact text-on-surface-variant">
          <span>{engineLabel(live)}</span>
          <span className="text-tertiary">{speedLabel(live)}</span>
        </div>
      </div>

      <div className="flex flex-col justify-between rounded-xl bg-surface-container-low p-space-md shadow-sm">
        <div className="flex items-center justify-between">
          <span className="font-label-sm text-label-sm uppercase tracking-wider text-outline">
            Files Processed
          </span>
          <span className="material-symbols-outlined text-[16px] text-on-surface-variant">description</span>
        </div>
        <div className="my-space-xs">
          <div className="font-headline-md text-headline-md font-bold text-on-surface">
            {filesAnalyzed}{' '}
            <span className="text-body-md font-normal text-outline">/ {filesDiscovered}</span>
          </div>
        </div>
        <div className="flex flex-col gap-0.5 font-code-compact text-code-compact text-tertiary">
          <span className="flex items-center gap-space-xs">
            <span className="material-symbols-outlined text-[14px]">check_circle</span>
            Analyzed / discovered
          </span>
          <span className="text-outline">
            {filesDiscovered
              ? `${Math.round(filesDiscovered ? (filesAnalyzed / filesDiscovered) * 100 : 0)}% of inventory reached analysis`
              : 'No file inventory yet'}
          </span>
        </div>
      </div>

      <div className="flex flex-col justify-between rounded-xl bg-surface-container-low p-space-md shadow-sm">
        <div className="flex items-center justify-between">
          <span className="font-label-sm text-label-sm uppercase tracking-wider text-outline">
            Lines of Code Detected
          </span>
          <span className="material-symbols-outlined text-[16px] text-on-surface-variant">code</span>
        </div>
        <div className="my-space-xs">
          <div className="font-headline-md text-headline-md font-bold text-on-surface">
            {locProgress.toLocaleString()}{' '}
            <span className="text-body-md font-normal text-outline">/ {locDetected.toLocaleString()}</span>
          </div>
        </div>
        <div className="flex flex-col gap-0.5 font-code-compact text-code-compact text-on-surface-variant">
          <span className="text-outline">Counted from inventory — not proof of deep analysis</span>
          <div className="flex items-center justify-between">
            <span>
              Elapsed:{' '}
              <span className="font-semibold text-on-surface">{formatElapsed(live)}</span>
            </span>
            <span className="font-semibold text-primary">{etaLabel(live)}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-col justify-between rounded-xl bg-surface-container-low p-space-md shadow-sm">
        <div className="flex items-center justify-between">
          <span className="font-label-sm text-label-sm uppercase tracking-wider text-outline">
            Findings Flagged
          </span>
          <span className="rounded bg-surface-container px-space-xs font-label-sm text-label-sm text-on-surface-variant">
            {findingsBadge}
          </span>
        </div>
        <div className="my-space-xs">
          <div className="font-headline-md text-headline-md font-bold text-on-surface">
            {totalIssues}{' '}
            <span className="text-body-sm font-normal text-outline">candidates</span>
          </div>
        </div>
        <div className="flex items-center gap-space-xs font-code-compact text-code-compact">
          <span className="rounded bg-error-container px-space-xs py-space-2xs font-bold text-white">
            {sev.critical} CRIT
          </span>
          <span className="rounded bg-surface-container-highest px-space-xs py-space-2xs font-bold text-white">
            {sev.high} HIGH
          </span>
          <span className="rounded bg-surface-container-high px-space-xs py-space-2xs font-bold text-white">
            {sev.medium} MED
          </span>
        </div>
      </div>
    </div>
  );
}

export function AuditProgressPage() {
  const {
    setAuditView,
    showToast,
    activeScanId,
    activeScan,
    adoptScan,
    refreshScan,
    refreshScanList,
  } = useEyra();
  const hostRef = useRef(null);
  const esRef = useRef(null);
  const pollRef = useRef(null);
  const failToastsRef = useRef(new Set());
  const pollErrorsRef = useRef(0);
  const logRef = useRef({ lines: [], keys: new Set(), scanId: null });
  const [termLines, setTermLines] = useState([]);

  // Header/KPIs/pipeline: live + completed/cancelled/failed. Idle only when no active scan.
  const displayScan = useMemo(() => {
    if (isDisplayableScan(activeScan)) return activeScan;
    return null;
  }, [activeScan]);

  // Findings from the same scan while running or after finish (real issues only).
  const findingsScan = useMemo(() => {
    if (!isDisplayableScan(activeScan)) return null;
    return activeScan;
  }, [activeScan]);

  useEffect(() => {
    refreshScanList?.();
  }, [refreshScanList]);

  // Terminal: prefer persisted audit-daemon logs from the engine; fallback to stage append
  useEffect(() => {
    if (!activeScan) {
      logRef.current = { lines: [], keys: new Set(), scanId: null };
      setTermLines([]);
      return;
    }
    if (!isDisplayableScan(activeScan)) return;

    if (logRef.current.scanId !== activeScan.id) {
      logRef.current = { lines: [], keys: new Set(), scanId: activeScan.id };
    }

    const persisted = mapScanLogsToLines(activeScan.logs);
    if (persisted.length) {
      logRef.current.lines = persisted;
      logRef.current.keys = new Set(persisted.map((l) => l.text));
      setTermLines(persisted);
      return;
    }

    // Older scans without tagged logs[] — keep appending unique stage strings while viewing
    const stage = activeScan.currentStage || activeScan.status;
    const st = String(activeScan.status || '').toLowerCase();
    const tag =
      st === 'failed'
        ? 'FAIL'
        : st === 'cancelled'
          ? 'WARN'
          : st === 'completed'
            ? 'DONE'
            : 'INFO';
    const key = `${tag}:${stage}`;
    if (!logRef.current.keys.has(key)) {
      logRef.current.keys.add(key);
      const tone =
        tag === 'FAIL' ? 'error' : tag === 'WARN' ? 'warn' : tag === 'DONE' ? 'ok' : 'info';
      const entry = {
        key: `${Date.now()}-${key}`,
        ts: new Date().toLocaleTimeString(),
        tag,
        message: String(stage),
        tone,
      };
      logRef.current.lines = [...logRef.current.lines, entry].slice(-50);
      setTermLines(logRef.current.lines);
    }
  }, [activeScan]);

  useEffect(() => {
    let raf = 0;
    const run = () => {
      const root = hostRef.current?.querySelector('.stitch-screen') || hostRef.current;
      if (!root?.firstElementChild) {
        raf = requestAnimationFrame(run);
        return;
      }
      hideAllStitchMock(root);
    };
    raf = requestAnimationFrame(run);
    return () => cancelAnimationFrame(raf);
  }, [displayScan, findingsScan]);

  useEffect(() => {
    if (activeScan?.status === 'failed' && activeScan.id && !failToastsRef.current.has(activeScan.id)) {
      failToastsRef.current.add(activeScan.id);
      showToast?.(activeScan.error || 'Scan failed', 'error');
    }
  }, [activeScan, showToast]);

  useEffect(() => {
    const scanId = activeScanId;
    if (!scanId) return undefined;

    let cancelled = false;
    pollErrorsRef.current = 0;

    function applyPartial(partial) {
      if (cancelled || !partial) return;
      if (partial.scan) {
        adoptScan(partial.scan, { notify: partial.status === 'completed' });
        return;
      }
      adoptScan(
        {
          id: scanId,
          status: partial.status,
          progress: partial.progress,
          currentStage: partial.currentStage,
          error: partial.error,
          summary: partial.summary,
          ...(Array.isArray(partial.logs) ? { logs: partial.logs } : {}),
        },
        { notify: false },
      );
      if (partial.status === 'completed') refreshScan(scanId);
      if (partial.status === 'failed' && partial.error && !failToastsRef.current.has(scanId)) {
        failToastsRef.current.add(scanId);
        showToast?.(partial.error, 'error');
      }
    }

    try {
      const es = new EventSource(api.scanEventsUrl(scanId));
      esRef.current = es;
      es.onmessage = (ev) => {
        try {
          applyPartial(JSON.parse(ev.data));
        } catch {
          /* ignore */
        }
      };
    } catch {
      /* SSE unavailable */
    }

    const tick = async () => {
      try {
        const data = await api.getScan(scanId);
        if (cancelled) return;
        pollErrorsRef.current = 0;
        const scan = data?.scan || data;
        if (scan) {
          adoptScan(scan, { notify: false });
          if (['completed', 'failed', 'cancelled'].includes(scan.status)) {
            if (pollRef.current) {
              clearInterval(pollRef.current);
              pollRef.current = null;
            }
            if (esRef.current) {
              esRef.current.close();
              esRef.current = null;
            }
          }
        }
      } catch (err) {
        if (cancelled) return;
        pollErrorsRef.current += 1;
        if (pollErrorsRef.current === 1) {
          showToast?.(err.message || 'Scan poll failed — retrying', 'error');
        }
        if (pollErrorsRef.current >= 5) {
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
          showToast?.('Stopped polling — audit backend unreachable or scan missing', 'error');
        }
      }
    };
    tick();
    pollRef.current = setInterval(tick, 2500);

    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeScanId]);

  async function handlePartial() {
    if (activeScanId) {
      try {
        await refreshScan(activeScanId);
      } catch {
        /* ignore */
      }
    }
    setAuditView('code');
  }

  async function handlePrimary() {
    if (isRunningScan(activeScan)) {
      if (!activeScanId) {
        showToast?.('No active scan to cancel', 'info');
        return;
      }
      try {
        const data = await api.cancelScan(activeScanId);
        const scan = data?.scan || {
          id: activeScanId,
          status: 'cancelled',
          currentStage: 'Cancelled by user',
          progress: activeScan?.progress,
        };
        adoptScan(scan, { notify: false });
        const cancelLine = {
          key: `cancel-${Date.now()}`,
          ts: new Date().toLocaleTimeString(),
          tag: 'WARN',
          message: 'Scan stopped by user',
          tone: 'warn',
        };
        logRef.current.lines = [...logRef.current.lines, cancelLine].slice(-50);
        setTermLines(logRef.current.lines);
        showToast?.('Audit cancelled — scan stopped', 'info');
      } catch (err) {
        showToast?.(err.message || 'Cancel failed', 'error');
      }
      return;
    }
    const st = String(activeScan?.status || '').toLowerCase();
    if (st === 'completed') {
      setAuditView('code');
      return;
    }
    setAuditView('ingest');
    showToast?.('Upload a ZIP (or repo), then Start Codebase Audit', 'info');
  }

  return (
    <div className="flex w-full flex-col gap-space-lg p-space-lg">
      <LiveHeader scan={displayScan} onPartial={handlePartial} onPrimary={handlePrimary} />
      <LiveKpis scan={displayScan} />
      <div className="grid grid-cols-1 items-stretch gap-gutter lg:grid-cols-12">
        <div className="lg:col-span-7">
          <LivePipeline scan={displayScan} />
        </div>
        <div className="flex flex-col gap-space-md lg:col-span-5">
          <LiveFindings scan={findingsScan} onOpen={handlePartial} />
          <SeverityDonut scan={findingsScan || displayScan} />
        </div>
      </div>
      <LiveTerminal
        lines={termLines}
        scanId={displayScan?.id || activeScanId}
        running={isRunningScan(displayScan)}
        statusLabel={
          isRunningScan(displayScan)
            ? 'LIVE'
            : displayScan?.status === 'completed'
              ? 'DONE'
              : displayScan?.status === 'cancelled'
                ? 'STOPPED'
                : displayScan?.status === 'failed'
                  ? 'FAILED'
                  : 'IDLE'
        }
      />
      {/* Stitch kept mounted but fully hidden — no Sandbox / mock findings */}
      <div ref={hostRef} className="hidden" aria-hidden="true">
        <AuditProgressStitch />
      </div>
    </div>
  );
}
