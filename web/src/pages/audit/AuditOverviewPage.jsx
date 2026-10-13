import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../api/client';
import { useEyra } from '../../context/EyraContext';
import { useStitchGate } from '../../hooks/useStitchGate.js';
import {
  assessmentStatusLabel,
  evaluateAssessmentCoverage,
} from '../../lib/assessmentCoverage.js';
import {
  replaceSubstring,
  relativeTime,
  setKpiByLabel,
  setText,
  shortSessionTag,
} from '../../lib/hydrateStitch.js';
import {
  auditedFileRiskRows,
  overviewKpis,
  recentAuditRows,
  remediationProgress,
  topPriorityFindings,
} from '../../lib/overviewMetrics.js';
import { scrubCommonDemoLabels, setPageNotice, zeroStitchKpis } from '../../lib/stitchEmpty.js';
import AuditOverviewStitch from '../stitch_raw/audit/AuditOverviewPage.jsx';

const ASSESSMENT_SLOT_ID = 'eyra-assessment-kpi-slot';
const FILE_SUMMARY_SLOT_ID = 'eyra-file-summary-slot';
const REMEDIATION_SLOT_ID = 'eyra-remediation-slot';
const PRIORITY_SLOT_ID = 'eyra-priority-slot';
const HISTORY_SLOT_ID = 'eyra-history-slot';

function hideRecommendedNextActions(root) {
  if (!root) return;
  const title = [...root.querySelectorAll('h2, h3, span')].find((el) =>
    /Recommended Next Actions/i.test(el.textContent || ''),
  );
  const card = title?.closest('.rounded-xl, [class*="rounded"]');
  if (card) card.style.display = 'none';
}

function restoreIssueCategoryDistribution(root) {
  if (!root) return;
  root.querySelectorAll('[data-eyra-assessment-hidden="1"]').forEach((el) => {
    el.style.display = '';
    delete el.dataset.eyraAssessmentHidden;
  });
}

function findSectionByTitle(root, pattern) {
  const title = [...root.querySelectorAll('h2, h3, span, p')].find((el) =>
    pattern.test(el.textContent || ''),
  );
  if (!title) return null;
  return (
    title.closest('.rounded-xl') ||
    title.closest('[class*="rounded"]') ||
    title.closest('section') ||
    title.parentElement?.parentElement
  );
}

function ensureSlotAfter(section, slotId) {
  if (!section?.parentElement) return null;
  let slot = section.parentElement.querySelector(`#${slotId}`);
  if (!slot) {
    slot = document.createElement('div');
    slot.id = slotId;
    slot.style.width = '100%';
    slot.style.minWidth = '0';
  }
  if (slot.previousElementSibling !== section) {
    section.parentElement.insertBefore(slot, section.nextSibling);
  }
  return slot;
}

function ensureSlotReplace(section, slotId) {
  if (!section?.parentElement) return null;
  let slot = section.parentElement.querySelector(`#${slotId}`);
  if (!slot) {
    slot = document.createElement('div');
    slot.id = slotId;
    slot.style.width = '100%';
    slot.style.minWidth = '0';
    section.parentElement.insertBefore(slot, section);
  }
  section.style.display = 'none';
  section.dataset.eyraReplaced = '1';
  return slot;
}

function prepareFileSummarySlot(root) {
  if (!root) return null;
  const existing = root.querySelector(`#${FILE_SUMMARY_SLOT_ID}`);
  if (existing) return existing;
  const section = findSectionByTitle(root, /Audited File Summary/i);
  if (section) return ensureSlotReplace(section, FILE_SUMMARY_SLOT_ID);
  return null;
}

function prepareAssessmentSlot(root) {
  if (!root) return null;
  restoreIssueCategoryDistribution(root);
  const existing = root.querySelector(`#${ASSESSMENT_SLOT_ID}`);
  const fileLive = root.querySelector(`#${FILE_SUMMARY_SLOT_ID}`);
  const fileSection = findSectionByTitle(root, /Audited File Summary/i);
  const anchor = fileLive || fileSection;
  if (existing) {
    if (anchor?.parentElement && existing.previousElementSibling !== anchor) {
      anchor.parentElement.insertBefore(existing, anchor.nextSibling);
    }
    return existing;
  }
  if (anchor) return ensureSlotAfter(anchor, ASSESSMENT_SLOT_ID);
  const main =
    root.querySelector('.px-space-lg.py-space-xl') ||
    root.querySelector('.flex.flex-col.w-full') ||
    root;
  const slot = document.createElement('div');
  slot.id = ASSESSMENT_SLOT_ID;
  main.appendChild(slot);
  return slot;
}

function prepareRemediationSlot(root) {
  if (!root) return null;
  const existing = root.querySelector(`#${REMEDIATION_SLOT_ID}`);
  if (existing) return existing;
  const section = findSectionByTitle(root, /Groq AST Architecture Engine|Architecture Engine/i);
  if (section) return ensureSlotReplace(section, REMEDIATION_SLOT_ID);
  return null;
}

function preparePrioritySlot(root) {
  if (!root) return null;
  const existing = root.querySelector(`#${PRIORITY_SLOT_ID}`);
  if (existing) return existing;
  const section = findSectionByTitle(root, /Highest-Priority Findings/i);
  if (section) return ensureSlotReplace(section, PRIORITY_SLOT_ID);
  return null;
}

function prepareHistorySlot(root) {
  if (!root) return null;
  const existing = root.querySelector(`#${HISTORY_SLOT_ID}`);
  if (existing) return existing;
  const section = findSectionByTitle(root, /Recent Audit History/i);
  if (section) return ensureSlotReplace(section, HISTORY_SLOT_ID);
  return null;
}

/** KPI strip only — never touch live portal panels (Remediation / Priority / History). */
function kpiStripRoot(root) {
  if (!root) return null;
  const health = [...root.querySelectorAll('span, div, p')].find((el) =>
    /^(Health Score|Code Health Score|Files Audited|Critical & High)$/.test(
      (el.textContent || '').trim(),
    ),
  );
  const card = health?.closest('.rounded-xl, .rounded-lg, [class*="rounded"]');
  const strip =
    card?.parentElement?.classList?.contains('grid')
      ? card.parentElement
      : card?.parentElement;
  return strip || null;
}

function setKpiSubtitle(scope, labelText, subtitle) {
  if (!scope || subtitle == null) return;
  const labels = [...scope.querySelectorAll('span, div, p')];
  for (const lab of labels) {
    if ((lab.textContent || '').trim() !== labelText) continue;
    // Skip anything inside our live portal mounts
    if (lab.closest('[id^="eyra-"]')) continue;
    const card = lab.closest('.rounded-xl, .rounded-lg, [class*="rounded"]') || lab.parentElement;
    if (!card || card.closest('[id^="eyra-"]')) continue;
    const subs = [...card.querySelectorAll('.font-code-compact, .text-code-compact')].filter(
      (el) => !el.closest('[id^="eyra-"]'),
    );
    const last = subs.pop();
    if (last) setText(last, subtitle);
    return;
  }
}

function paintAuditOverviewIdle(root, { offline = false } = {}) {
  if (!root) return;
  hideRecommendedNextActions(root);
  prepareFileSummarySlot(root);
  scrubCommonDemoLabels(root);
  const strip = kpiStripRoot(root) || root;
  zeroStitchKpis(strip, [
    'Health Score',
    'Code Health Score',
    'Total Findings',
    'Critical & High',
    'Files Audited',
    'Files with Issues',
    'Dependency Vulns',
    'Security CVEs',
  ]);
  setKpiByLabel(strip, 'Scan Duration', '—');
  setKpiByLabel(strip, 'Incomplete Stubs', '—');
  setKpiSubtitle(strip, 'Total Findings', '0C / 0H / 0M / 0L');
  setKpiSubtitle(strip, 'Critical & High', 'No scan loaded');
  setKpiSubtitle(strip, 'Files Audited', 'No files yet');
  setKpiSubtitle(strip, 'Files with Issues', 'Unique files with findings');
  setKpiSubtitle(strip, 'Dependency Vulns', 'Unique files with findings');
  setKpiSubtitle(strip, 'Scan Duration', 'No scan');
  setKpiSubtitle(strip, 'Incomplete Stubs', 'No scan');
  setKpiSubtitle(strip, 'Health Score', '—/100');
  setKpiSubtitle(strip, 'Code Health Score', '—/100');
  setPageNotice(
    root.parentElement || root,
    offline
      ? 'Brain offline — sample Codebase Intelligence metrics are hidden.'
      : 'No live audit yet — ingest a repo to load Codebase Intelligence.',
    { error: offline },
  );
}

function hydrateAuditOverview(root, scan, scans, { offline = false } = {}) {
  if (!root) return;
  hideRecommendedNextActions(root);
  prepareFileSummarySlot(root);
  prepareAssessmentSlot(root);
  prepareRemediationSlot(root);
  preparePrioritySlot(root);
  prepareHistorySlot(root);
  if (!scan && (!scans || !scans.length)) {
    paintAuditOverviewIdle(root, { offline });
    return;
  }
  setPageNotice(root.parentElement || root, null);

  const s = scan || scans[0];
  const k = overviewKpis(s);
  const sev = k.sev;
  const strip = kpiStripRoot(root) || root;

  // KPI strip only — never write into Remediation Progress legend
  setKpiByLabel(strip, 'Health Score', `${k.health}`);
  setKpiByLabel(strip, 'Code Health Score', `${k.health}`);
  setKpiByLabel(strip, 'Total Findings', k.totalIssues);
  setKpiByLabel(strip, 'Critical & High', k.critHigh);
  setKpiByLabel(strip, 'Files Audited', k.files || '—');
  setKpiByLabel(strip, 'Files with Issues', k.filesWithIssues);
  setKpiByLabel(strip, 'Dependency Vulns', k.filesWithIssues); // legacy stitch label fallback
  setKpiByLabel(strip, 'Scan Duration', k.scanDuration);
  setKpiByLabel(strip, 'Incomplete Stubs', k.scanDuration); // legacy stitch label fallback

  setKpiSubtitle(
    strip,
    'Total Findings',
    `${sev.critical}C / ${sev.high}H / ${sev.medium}M / ${sev.low}L`,
  );
  setKpiSubtitle(
    strip,
    'Critical & High',
    k.critHigh > 0 ? 'Immediate Action' : 'No critical/high',
  );
  setKpiSubtitle(
    strip,
    'Files Audited',
    k.loc ? `${k.loc.toLocaleString()} Total LOC` : 'Lines of code detected',
  );
  setKpiSubtitle(
    strip,
    'Files with Issues',
    k.filesWithIssues
      ? `${k.filesWithIssues} file${k.filesWithIssues === 1 ? '' : 's'} with findings`
      : 'No files with findings',
  );
  setKpiSubtitle(
    strip,
    'Dependency Vulns',
    k.filesWithIssues
      ? `${k.filesWithIssues} file${k.filesWithIssues === 1 ? '' : 's'} with findings`
      : 'No files with findings',
  );
  setKpiSubtitle(strip, 'Scan Duration', k.scanDurationDetail);
  setKpiSubtitle(strip, 'Incomplete Stubs', k.scanDurationDetail);
  setKpiSubtitle(strip, 'Health Score', k.grade ? `Grade ${k.grade}` : `${k.health}/100`);
  setKpiSubtitle(strip, 'Code Health Score', k.grade ? `Grade ${k.grade}` : `${k.health}/100`);

  // Ensure card titles match college KPI names even if stitch cache is stale
  replaceSubstring(root, 'Dependency Vulns', 'Files with Issues');
  replaceSubstring(root, 'Incomplete Stubs', 'Scan Duration');
  replaceSubstring(root, 'Security CVEs', 'Files with Issues');

  // Safe global renames (avoid Open Findings — clashes with remediation legend)
  replaceSubstring(root, '4 Crit', `${sev.critical} Crit`);
  replaceSubstring(root, '9 High', `${sev.high} High`);
  replaceSubstring(root, '11 Med', `${sev.medium} Med`);
  replaceSubstring(root, '4 Low', `${sev.low} Low`);
  replaceSubstring(root, '342 Files', `${k.files || 0} Files`);
  if (k.loc) replaceSubstring(root, '42,180 total LOC', `${k.loc.toLocaleString()} total LOC`);
  if (k.projectName) replaceSubstring(root, 'backend-api', k.projectName);
  if (s.id) replaceSubstring(root, '#SC-088', shortSessionTag(s.id));
  if (scans?.length) {
    replaceSubstring(root, 'View Previous Audits', `View Previous Audits (${scans.length})`);
  }
}

function statusStyles(status) {
  switch (status) {
    case 'pass':
      return { badge: 'bg-tertiary/20 text-tertiary', bar: 'bg-tertiary', row: 'bg-tertiary/10 ring-tertiary/25' };
    case 'partial':
      return { badge: 'bg-primary/20 text-primary', bar: 'bg-primary', row: 'bg-primary/10 ring-primary/25' };
    case 'fail':
    case 'gap':
      return { badge: 'bg-error/20 text-error', bar: 'bg-error', row: 'bg-error/10 ring-error/25' };
    case 'not_run':
    case 'idle':
    default:
      return {
        badge: 'bg-surface-container-high text-outline',
        bar: 'bg-outline-variant',
        row: 'bg-surface-container-lowest ring-outline-variant/20',
      };
  }
}

function itemIcon(status) {
  switch (status) {
    case 'pass':
      return 'check_circle';
    case 'partial':
      return 'pending';
    case 'fail':
      return 'cancel';
    default:
      return 'radio_button_unchecked';
  }
}

function assessmentGroupIcon(id) {
  switch (String(id || '')) {
    case 'security':
      return 'shield';
    case 'quality':
    case 'ast':
      return 'account_tree';
    case 'todos':
    case 'incomplete':
      return 'pending_actions';
    case 'ai':
      return 'psychology';
    case 'inventory':
    case 'coverage':
      return 'inventory_2';
    default:
      return 'fact_check';
  }
}

function AssessmentCoverageRing({ pct, toneClass }) {
  const size = 72;
  const stroke = 7;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct));
  const dash = (clamped / 100) * c;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          className={toneClass}
          stroke="currentColor"
          strokeWidth={stroke}
          strokeDasharray={`${dash} ${c - dash}`}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-headline-sm text-[18px] font-bold leading-none text-on-surface">
          {clamped}%
        </span>
      </div>
    </div>
  );
}

function AssessmentKpiCards({ scan, mountNode }) {
  const { groups } = useMemo(() => evaluateAssessmentCoverage(scan), [scan]);
  const [openId, setOpenId] = useState(null);
  const openGroup = groups.find((g) => g.id === openId) || null;
  const openPct = openGroup?.total
    ? Math.round((openGroup.met / openGroup.total) * 100)
    : 0;
  const openTone =
    openGroup?.status === 'pass'
      ? 'text-tertiary'
      : openGroup?.status === 'fail'
        ? 'text-error'
        : openGroup?.status === 'partial'
          ? 'text-primary'
          : 'text-outline';

  useEffect(() => {
    if (!openId) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setOpenId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openId]);

  if (!mountNode) return null;

  const cards = (
    <div className="mt-space-md w-full min-w-0 overflow-hidden rounded-2xl border border-outline-variant/20 bg-gradient-to-br from-surface-container-low via-surface-container-low to-surface-container/80 p-space-md shadow-md">
      <div className="mb-space-md flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-primary">verified_user</span>
            <h2 className="font-headline-sm text-headline-sm font-semibold text-on-surface">
              Assessment coverage
            </h2>
          </div>
          <p className="font-body-sm text-[12px] text-on-surface-variant">
            Live checklist from this scan — open a domain for evidence-backed detail.
          </p>
        </div>
        <span className="rounded-full bg-surface-container-highest/80 px-2.5 py-1 font-code-compact text-[10px] uppercase tracking-wider text-outline">
          {groups.length} domains
        </span>
      </div>
      <div className="grid w-full min-w-0 grid-cols-2 gap-space-sm lg:grid-cols-4">
        {groups.map((g) => {
          const styles = statusStyles(g.status);
          const pct = g.total ? Math.round((g.met / g.total) * 100) : 0;
          return (
            <button
              key={g.id}
              type="button"
              onClick={() => setOpenId(g.id)}
              className="group relative flex min-w-0 flex-col gap-2 overflow-hidden rounded-xl border border-outline-variant/15 bg-surface-container/60 p-space-sm text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/35 hover:bg-surface-container hover:shadow-lg"
            >
              <div className="pointer-events-none absolute -right-6 -top-6 h-16 w-16 rounded-full bg-primary/5 blur-xl transition-opacity group-hover:bg-primary/10" />
              <div className="relative flex items-center justify-between gap-1">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="material-symbols-outlined shrink-0 text-[15px] text-primary/80">
                    {assessmentGroupIcon(g.id)}
                  </span>
                  <span className="truncate font-label-sm text-[10px] font-semibold uppercase tracking-wide text-outline">
                    {g.title}
                  </span>
                </span>
                <span
                  className={`shrink-0 rounded-full px-1.5 py-0.5 font-label-sm text-[9px] font-bold uppercase ${styles.badge}`}
                >
                  {assessmentStatusLabel(g.status)}
                </span>
              </div>
              <div className="relative flex items-baseline gap-1">
                <span className="font-headline-sm text-[24px] font-bold leading-none tracking-tight text-on-surface">
                  {g.met}
                </span>
                <span className="font-code-compact text-[11px] text-outline">/ {g.total}</span>
                <span className="ml-auto font-code-compact text-[10px] text-outline">{pct}%</span>
              </div>
              <p className="relative line-clamp-2 min-h-[2.2em] font-body-sm text-[10px] leading-snug text-on-surface-variant">
                {g.description}
              </p>
              <div className="relative mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-container-lowest">
                <div
                  className={`h-full rounded-full transition-all ${styles.bar}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );

  const popup =
    openGroup != null
      ? createPortal(
          <div
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="eyra-assessment-dialog-title"
            onClick={() => setOpenId(null)}
          >
            <div
              className="flex max-h-[min(88vh,640px)] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-outline-variant/25 bg-surface-container-lowest shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="relative shrink-0 overflow-hidden border-b border-outline-variant/20 bg-gradient-to-br from-surface-container via-surface-container-low to-surface-container-lowest px-space-md py-space-md">
                <div className="pointer-events-none absolute -right-10 -top-16 h-40 w-40 rounded-full bg-primary/10 blur-3xl" />
                <div className="pointer-events-none absolute bottom-0 left-1/3 h-24 w-32 rounded-full bg-tertiary/5 blur-2xl" />
                <div className="relative flex items-start gap-space-md">
                  <AssessmentCoverageRing pct={openPct} toneClass={openTone} />
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-2 text-primary">
                      <span className="material-symbols-outlined text-[18px]">
                        {assessmentGroupIcon(openGroup.id)}
                      </span>
                      <span className="font-label-sm text-[10px] font-semibold uppercase tracking-[0.14em] text-outline">
                        Assessment domain
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3
                        id="eyra-assessment-dialog-title"
                        className="font-headline-sm text-[20px] font-semibold tracking-tight text-on-surface"
                      >
                        {openGroup.title}
                      </h3>
                      <span
                        className={`rounded-full px-2 py-0.5 font-label-sm text-[10px] font-bold uppercase ${
                          statusStyles(openGroup.status).badge
                        }`}
                      >
                        {assessmentStatusLabel(openGroup.status)}
                      </span>
                    </div>
                    <p className="mt-1.5 font-body-sm text-[13px] leading-snug text-on-surface-variant">
                      {openGroup.description}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className="rounded-lg bg-surface-container px-2.5 py-1 font-code-compact text-[11px] text-on-surface">
                        <span className="text-tertiary">{openGroup.met}</span>
                        <span className="text-outline"> / {openGroup.total} passed</span>
                      </span>
                      <span className="rounded-lg bg-surface-container px-2.5 py-1 font-code-compact text-[11px] text-outline">
                        {openGroup.total - openGroup.met} remaining
                      </span>
                      <span className="rounded-lg bg-surface-container px-2.5 py-1 font-code-compact text-[11px] text-outline">
                        Evidence from this scan
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOpenId(null)}
                    className="shrink-0 rounded-xl border border-outline-variant/25 bg-surface-container/80 p-1.5 text-outline transition-colors hover:border-outline hover:bg-surface-container-high hover:text-on-surface"
                    aria-label="Close"
                  >
                    <span className="material-symbols-outlined text-[20px]">close</span>
                  </button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-space-md py-space-md">
                <ol className="relative m-0 flex list-none flex-col gap-0 p-0">
                  {openGroup.items.map((check, idx) => {
                    const st = check.status || (check.met ? 'pass' : 'not_run');
                    const styles = statusStyles(st);
                    const iconTone =
                      st === 'pass'
                        ? 'text-tertiary bg-tertiary/15 ring-tertiary/30'
                        : st === 'fail'
                          ? 'text-error bg-error/15 ring-error/30'
                          : st === 'partial'
                            ? 'text-primary bg-primary/15 ring-primary/30'
                            : 'text-outline bg-surface-container-high ring-outline-variant/30';
                    const isLast = idx === openGroup.items.length - 1;
                    return (
                      <li key={check.label} className="relative flex gap-3 pb-4 last:pb-0">
                        {!isLast ? (
                          <span
                            className="absolute left-[15px] top-9 bottom-0 w-px bg-outline-variant/25"
                            aria-hidden
                          />
                        ) : null}
                        <div
                          className={`relative z-[1] flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-1 ${iconTone}`}
                        >
                          <span className="material-symbols-outlined text-[16px]">{itemIcon(st)}</span>
                        </div>
                        <div
                          className={`min-w-0 flex-1 rounded-xl border border-outline-variant/15 bg-surface-container/50 p-3 transition-colors hover:bg-surface-container ${styles.row.includes('ring') ? '' : ''}`}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-code-compact text-[10px] text-outline">
                              {String(idx + 1).padStart(2, '0')}
                            </span>
                            <p className="font-body-sm text-[13px] font-medium leading-snug text-on-surface">
                              {check.label}
                            </p>
                            <span
                              className={`ml-auto rounded-full px-1.5 py-0.5 font-label-sm text-[9px] font-bold uppercase ${styles.badge}`}
                            >
                              {assessmentStatusLabel(st)}
                            </span>
                          </div>
                          {check.reason ? (
                            <p className="mt-2 border-l-2 border-outline-variant/30 pl-2.5 font-body-sm text-[12px] leading-relaxed text-on-surface-variant">
                              {check.reason}
                            </p>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </div>

              <div className="flex shrink-0 items-center justify-between gap-3 border-t border-outline-variant/20 bg-surface-container-low/80 px-space-md py-space-sm">
                <p className="font-code-compact text-[10px] text-outline">
                  Esc to close · evidence only — no mock checklist
                </p>
                <button
                  type="button"
                  onClick={() => setOpenId(null)}
                  className="rounded-xl bg-primary-container px-4 py-2 font-label-sm text-[12px] font-semibold text-on-primary-container transition-opacity hover:opacity-90"
                >
                  Done
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      {createPortal(cards, mountNode)}
      {popup}
    </>
  );
}

function riskBandStyles(band) {
  switch (String(band || '').toUpperCase()) {
    case 'CRITICAL':
      return {
        badge: 'bg-error/20 text-error',
        icon: 'warning',
        iconTone: 'text-error',
      };
    case 'HIGH':
      return {
        badge: 'bg-primary/20 text-primary',
        icon: 'error',
        iconTone: 'text-primary',
      };
    case 'MEDIUM':
      return {
        badge: 'bg-secondary-container/30 text-secondary',
        icon: 'info',
        iconTone: 'text-secondary',
      };
    default:
      return {
        badge: 'bg-tertiary/15 text-tertiary',
        icon: 'check_circle',
        iconTone: 'text-tertiary',
      };
  }
}

function FileRiskSummaryPanel({ scan, mountNode, onInspect, onViewAll }) {
  const { rows, totalFiles } = useMemo(() => auditedFileRiskRows(scan, 4), [scan]);
  if (!mountNode) return null;

  return createPortal(
    <div className="flex flex-col gap-space-sm rounded-xl bg-surface-container-low p-space-md shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="font-headline-sm text-headline-sm font-semibold text-on-surface">
            Audited File Summary &amp; Risk Density
          </h2>
          <p className="font-body-sm text-[12px] text-outline">
            Modules with the highest live-finding concentration from this scan.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onViewAll?.()}
          className="shrink-0 font-code-compact text-code-compact text-primary hover:underline"
        >
          View All {totalFiles || 0} Files →
        </button>
      </div>
      {!scan ? (
        <p className="py-6 text-center font-body-sm text-body-sm text-outline">
          No live audit loaded — ingest and complete a scan to see file risk density.
        </p>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center font-body-sm text-body-sm text-outline">
          No per-file findings in this scan yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead>
              <tr className="border-b border-outline-variant/20 font-label-sm text-[10px] uppercase tracking-wider text-outline">
                <th className="px-2 py-2 font-medium">File Path</th>
                <th className="px-2 py-2 font-medium">Risk Score</th>
                <th className="px-2 py-2 font-medium">Severity Mix</th>
                <th className="px-2 py-2 font-medium">LOC</th>
                <th className="px-2 py-2 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const styles = riskBandStyles(row.band);
                const mix = [
                  row.critical ? `${row.critical} Crit` : null,
                  row.high ? `${row.high} High` : null,
                  row.medium ? `${row.medium} Med` : null,
                  row.low ? `${row.low} Low` : null,
                ]
                  .filter(Boolean)
                  .join(' · ');
                return (
                  <tr
                    key={row.path}
                    className="border-b border-outline-variant/10 last:border-0"
                  >
                    <td className="px-2 py-2.5">
                      <div className="flex items-center gap-2">
                        <span
                          className={`material-symbols-outlined text-[16px] ${styles.iconTone}`}
                        >
                          {styles.icon}
                        </span>
                        <span className="font-code-compact text-code-compact text-on-surface">
                          {row.path}
                        </span>
                      </div>
                    </td>
                    <td className="px-2 py-2.5">
                      <span
                        className={`rounded px-1.5 py-0.5 font-label-sm text-[10px] font-bold uppercase ${styles.badge}`}
                      >
                        {row.band} {row.score}
                      </span>
                    </td>
                    <td className="px-2 py-2.5 font-code-compact text-code-compact text-on-surface-variant">
                      {mix || 'No issues'}
                    </td>
                    <td className="px-2 py-2.5 font-code-compact text-code-compact text-on-surface-variant">
                      {row.loc || '—'}
                    </td>
                    <td className="px-2 py-2.5">
                      <button
                        type="button"
                        onClick={() => onInspect?.(row.path)}
                        className="rounded bg-surface-container-high px-2 py-1 font-label-sm text-[11px] text-on-surface hover:bg-surface-bright"
                      >
                        Inspect AST
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>,
    mountNode,
  );
}

function PriorityFindingsPanel({ scan, mountNode, onInspect }) {
  const rows = useMemo(() => topPriorityFindings(scan, 2), [scan]);
  if (!mountNode) return null;

  return createPortal(
    <div className="flex h-full flex-col gap-space-sm rounded-xl bg-surface-container-low p-space-md shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-space-xs font-headline-sm text-headline-sm font-semibold text-on-surface">
          <span className="material-symbols-outlined text-[18px] text-error">gpp_maybe</span>
          Highest-Priority Findings
        </h2>
        <span className="rounded bg-error/15 px-space-xs py-space-2xs font-label-sm text-label-sm font-bold text-error">
          TOP {rows.length || 0}
        </span>
      </div>
      <div className="flex min-h-[6rem] flex-col gap-space-sm">
        {rows.length === 0 ? (
          <p className="font-body-sm text-body-sm text-outline">
            No critical/high findings on this scan yet.
          </p>
        ) : (
          rows.map((row) => (
            <div
              key={row.id}
              className="flex flex-col gap-space-xs rounded-lg bg-surface-container p-space-sm transition-colors hover:bg-surface-container-high"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-body-sm text-body-sm font-semibold text-on-surface">{row.title}</p>
                  <p className="font-code-compact text-code-compact text-on-surface-variant">{row.loc}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onInspect?.(row)}
                  className="shrink-0 font-code-compact text-code-compact text-primary hover:underline"
                >
                  Inspect
                </button>
              </div>
              <div className="flex flex-wrap gap-1">
                <span className="rounded bg-error/20 px-1.5 py-px font-label-sm text-[10px] font-bold uppercase text-error">
                  {row.severity}
                </span>
                <span className="rounded bg-surface-container-highest px-1.5 py-px font-label-sm text-[10px] font-bold uppercase text-on-surface-variant">
                  {row.badge}
                </span>
              </div>
              {row.summary ? (
                <p className="line-clamp-2 font-body-sm text-[11px] text-outline">{row.summary}</p>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>,
    mountNode,
  );
}

function RecentHistoryPanel({ scans, mountNode, onOpenHistory }) {
  const rows = useMemo(() => recentAuditRows(scans, 3), [scans]);
  if (!mountNode) return null;

  return createPortal(
    <div className="flex flex-col gap-space-sm rounded-xl bg-surface-container-low p-space-md shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-headline-sm text-headline-sm font-semibold text-on-surface">
          Recent Audit History
        </h2>
        <span className="font-code-compact text-code-compact text-outline">Last {rows.length} Scans</span>
      </div>
      <div className="flex flex-col gap-space-xs">
        {rows.length === 0 ? (
          <p className="font-body-sm text-body-sm text-outline">No prior ZIP/GitHub audits yet.</p>
        ) : (
          rows.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => onOpenHistory?.(row)}
              className="flex w-full items-center justify-between rounded bg-surface-container p-space-xs text-left transition-colors hover:bg-surface-container-high"
            >
              <div className="min-w-0">
                <p className="truncate font-body-sm text-body-sm font-semibold text-on-surface">
                  {row.label}
                </p>
                <p className="font-code-compact text-[10px] text-outline">
                  {row.ref} · {row.when ? relativeTime(row.when) : row.status}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-0.5">
                <span className="font-code-compact text-[11px] text-on-surface-variant">
                  {row.findings} findings
                </span>
                <span className="font-label-sm text-[11px] font-bold text-primary">
                  Score {row.score}
                </span>
              </div>
            </button>
          ))
        )}
      </div>
    </div>,
    mountNode,
  );
}

/** Replaces Groq AST Architecture Engine — remediation funnel for this project. */
function RemediationProgressPanel({ scan, mountNode }) {
  const [tick, setTick] = useState(0);
  const data = useMemo(() => remediationProgress(scan), [scan, tick]);

  // Refresh when Code Audit Apply updates sessionStorage, or user returns to overview
  useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    window.addEventListener('focus', bump);
    window.addEventListener('storage', bump);
    const id = window.setInterval(bump, 2500);
    return () => {
      window.removeEventListener('focus', bump);
      window.removeEventListener('storage', bump);
      window.clearInterval(id);
    };
  }, []);

  if (!mountNode) return null;

  const size = 140;
  const stroke = 20;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const ringTotal = Math.max(
    1,
    data.segments.reduce((a, s) => a + s.value, 0),
  );
  let offset = 0;
  const arcs = data.segments
    .filter((s) => s.value > 0)
    .map((s) => {
      const len = (s.value / ringTotal) * c;
      const arc = { ...s, len, offset };
      offset += len;
      return arc;
    });

  return createPortal(
    <div
      id="eyra-remediation-card"
      className="flex flex-col gap-space-md rounded-xl bg-surface-container-low p-space-md shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-space-xs">
          <span className="material-symbols-outlined text-[22px] text-primary">track_changes</span>
          <div>
            <h2 className="font-headline-sm text-headline-sm font-semibold text-on-surface">
              Remediation Progress
            </h2>
            <p className="font-body-sm text-[12px] text-outline">
              Based on generated and verified fixes for this audit.
            </p>
          </div>
        </div>
        <span className="shrink-0 rounded bg-surface-container px-1.5 py-0.5 font-code-compact text-[10px] text-outline">
          {data.totalFindings} findings
        </span>
      </div>
      <div className="flex items-center gap-space-md">
        <div className="relative shrink-0" style={{ width: size, height: size }}>
          <svg width={size} height={size} className="-rotate-90" aria-hidden>
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke="rgba(255,255,255,0.08)"
              strokeWidth={stroke}
            />
            {arcs.length === 0 ? (
              <circle
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke="rgba(255,255,255,0.2)"
                strokeWidth={stroke}
              />
            ) : (
              arcs.map((arc) => (
                <circle
                  key={arc.key}
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  fill="none"
                  stroke={arc.color}
                  strokeWidth={stroke}
                  strokeDasharray={`${arc.len} ${c - arc.len}`}
                  strokeDashoffset={-arc.offset}
                  strokeLinecap="butt"
                />
              ))
            )}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-headline-sm text-[26px] font-bold leading-none text-on-surface">
              {data.resolvedPct}%
            </span>
            <span className="mt-1 font-label-sm text-[10px] uppercase tracking-wide text-outline">
              Resolved
            </span>
          </div>
        </div>
        <ul className="flex min-w-0 flex-1 flex-col gap-2.5">
          {data.segments.map((s) => (
            <li key={s.key} className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 flex-col">
                <span className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: s.color }}
                  />
                  <span className="truncate font-body-sm text-[13px] font-medium text-on-surface">
                    {s.key}
                  </span>
                </span>
                <span className="ml-4.5 pl-[18px] font-code-compact text-[10px] text-outline">
                  {s.hint}
                </span>
              </span>
              <span className="shrink-0 tabular-nums font-headline-sm text-[16px] font-bold text-on-surface">
                {Number(s.value) || 0}
              </span>
            </li>
          ))}
        </ul>
      </div>
      {data.appliedFromWorkspace > 0 ? (
        <p className="font-code-compact text-[10px] text-tertiary">
          {data.appliedFromWorkspace} fix{data.appliedFromWorkspace === 1 ? '' : 'es'} applied in
          Code Audit (synced)
        </p>
      ) : null}
    </div>,
    mountNode,
  );
}

export function AuditOverviewPage() {
  const { setAuditView, showToast, activeScan, adoptScan, refreshScanList, scanList } = useEyra();
  const hostRef = useRef(null);
  const [overviewScan, setOverviewScan] = useState(null);
  const [slots, setSlots] = useState({
    assessment: null,
    fileSummary: null,
    remediation: null,
    priority: null,
    history: null,
  });

  const scrubIdle = useCallback((root) => {
    paintAuditOverviewIdle(root, { offline: false });
  }, []);
  const { reveal, hold, gateClassName, gateProps } = useStitchGate(hostRef, {
    scrub: scrubIdle,
  });

  useEffect(() => {
    let cancelled = false;
    hold();

    (async () => {
      const rootOf = () => hostRef.current?.querySelector('.stitch-screen') || hostRef.current;
      let root = rootOf();
      let tries = 0;
      while (!root && tries < 40 && !cancelled) {
        await new Promise((r) => setTimeout(r, 40));
        root = rootOf();
        tries += 1;
      }
      if (cancelled || !root) {
        if (!cancelled) reveal();
        return;
      }

      paintAuditOverviewIdle(root, { offline: false });
      hideRecommendedNextActions(root);

      let scans = [];
      let offline = false;
      try {
        scans = (await refreshScanList()) || [];
      } catch {
        offline = true;
        scans = [];
      }
      if (cancelled) return;
      let scan = activeScan;
      if ((!scan || (scan.status !== 'completed' && !scan.issues?.length)) && scans?.[0]?.id) {
        try {
          const data = await api.getScan(scans[0].id);
          scan = data?.scan || data;
          if (scan) adoptScan(scan, { notify: false });
        } catch {
          /* leave idle — do not restore stitch demo metrics */
        }
      }
      if (!cancelled) setOverviewScan(scan || scans?.[0] || null);

      const liveRoot = rootOf() || root;
      try {
        hydrateAuditOverview(liveRoot, scan || scans?.[0], scans, { offline });
        if (!cancelled) {
          setSlots({
            fileSummary: prepareFileSummarySlot(liveRoot),
            assessment: prepareAssessmentSlot(liveRoot),
            remediation: prepareRemediationSlot(liveRoot),
            priority: preparePrioritySlot(liveRoot),
            history: prepareHistorySlot(liveRoot),
          });
        }
      } finally {
        if (!cancelled) reveal();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeScan?.id, activeScan?.status, refreshScanList, adoptScan, hold, reveal]);

  const assessmentScan = overviewScan || activeScan || scanList?.[0] || null;
  const historyScans = scanList?.length ? scanList : assessmentScan ? [assessmentScan] : [];

  return (
    <div
      ref={hostRef}
      className={gateClassName}
      {...gateProps}
      onClick={(e) => {
        const el = e.target.closest('button, a');
        if (!el) return;
        const text = (el.textContent || '').trim();
        if (text.includes('Audit New Codebase') || text.includes('Ingest')) {
          e.preventDefault();
          setAuditView('ingest');
        } else if (text.includes('View Previous Audits') || text.includes('View All')) {
          e.preventDefault();
          setAuditView('history');
        } else if (
          text.includes('Inspect AST') ||
          text.includes('Inspect') ||
          text.includes('Open Code') ||
          text.includes('heatmap')
        ) {
          e.preventDefault();
          setAuditView('code');
        } else if (text.includes('Progress') || text.includes('Live Audit')) {
          e.preventDefault();
          setAuditView('progress');
        } else if (text.includes('refresh') || text.includes('Refresh')) {
          e.preventDefault();
          refreshScanList().then(() => showToast?.('Audit overview refreshed', 'info'));
        }
      }}
    >
      <AuditOverviewStitch />
      <FileRiskSummaryPanel
        scan={assessmentScan}
        mountNode={slots.fileSummary}
        onInspect={() => setAuditView('code')}
        onViewAll={() => setAuditView('code')}
      />
      <AssessmentKpiCards scan={assessmentScan} mountNode={slots.assessment} />
      <PriorityFindingsPanel
        scan={assessmentScan}
        mountNode={slots.priority}
        onInspect={() => setAuditView('code')}
      />
      <RecentHistoryPanel
        scans={historyScans}
        mountNode={slots.history}
        onOpenHistory={() => setAuditView('history')}
      />
      <RemediationProgressPanel scan={assessmentScan} mountNode={slots.remediation} />
    </div>
  );
}
