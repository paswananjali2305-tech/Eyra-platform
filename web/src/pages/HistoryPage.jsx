import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useEyra } from '../context/EyraContext';
import { useStitchGate } from '../hooks/useStitchGate.js';
import { downloadHistoryExport } from '../lib/auditReportExport.js';
import {
  formatStatus,
  qs,
  qsa,
  relativeTime,
  setText,
  shortSessionTag,
} from '../lib/hydrateStitch.js';
import HistoryStitch from './stitch_raw/HistoryPage.jsx';

const HISTORY_UI_VERSION = 6;

/** Map runtime session status / verification → severity chip (audit-style). */
function runtimeSeverity(item) {
  const st = String(item?.status || '').toLowerCase();
  const ver = String(item?.verification_status || '').toLowerCase();
  if (/fail|error/.test(st) || /fail/.test(ver)) return 'CRITICAL';
  if (/needs_review|hypothesis|pending/.test(st)) return 'HIGH';
  if (/unverified/.test(ver)) return 'MEDIUM';
  if (/verif/.test(st) || /pass|verif/.test(ver)) return 'LOW';
  const c = Number(item?.confidence);
  if (!Number.isNaN(c) && c > 0) {
    if (c < 0.4) return 'HIGH';
    if (c < 0.7) return 'MEDIUM';
    return 'LOW';
  }
  return 'MEDIUM';
}

function runtimeScopeLabel(item) {
  const lang = (item.language || '').trim();
  const file = (item.file_name || 'snippet').trim();
  if (lang && file) return `${lang} · ${file}`;
  return file || lang || 'snippet';
}

function runtimeSubtitle(item) {
  const parts = [
    item.root_cause || item.error_summary || '',
    item.verification_status
      ? `verify ${formatStatus(item.verification_status)}`
      : null,
    item.reasoning_source ? String(item.reasoning_source).replace(/_/g, ' ') : null,
    item.confidence != null && !Number.isNaN(Number(item.confidence))
      ? `${Math.round(Number(item.confidence) * 100)}% conf`
      : null,
  ].filter(Boolean);
  return parts.join(' · ') || '—';
}

/** Hidden template so we can rebuild rows even when stitch ships empty. */
const ROW_TEMPLATE_HTML = `
<div class="investigation-row grid grid-cols-12 gap-space-sm px-space-md py-3 items-center hover:bg-surface-container-high/60 transition-colors group cursor-pointer" data-project="" data-severity="" data-status="" data-type="">
  <div class="col-span-2 flex items-center gap-2 min-w-0">
    <span class="px-1.5 py-0.5 rounded font-label-sm text-label-sm uppercase font-semibold bg-primary-container/15 text-primary">RUNTIME</span>
    <span class="font-code-compact text-code-compact text-on-surface font-medium truncate">#—</span>
  </div>
  <div class="col-span-3 flex items-center gap-1.5 min-w-0">
    <span class="material-symbols-outlined text-[14px] text-outline shrink-0">code</span>
    <span class="font-code-compact text-code-compact text-outline truncate">— /</span>
    <span class="font-code-compact text-code-compact text-primary truncate font-medium">—</span>
  </div>
  <div class="col-span-3 min-w-0 pr-2">
    <div class="font-body-sm text-body-sm text-on-surface font-medium truncate">—</div>
    <div class="font-code-compact text-[10px] text-outline truncate">—</div>
  </div>
  <div class="col-span-1">
    <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container-high text-on-surface-variant font-label-sm text-label-sm">
      <span class="w-1 h-1 rounded-full bg-outline"></span>
      <span>—</span>
    </span>
  </div>
  <div class="col-span-1">
    <span class="px-1.5 py-0.5 rounded bg-surface-container-high text-outline font-label-sm text-label-sm font-semibold tracking-wider">—</span>
  </div>
  <div class="col-span-1 flex flex-col justify-center">
    <span class="font-code-compact text-code-compact text-on-surface">—</span>
    <span class="font-label-sm text-[10px] text-outline">—</span>
  </div>
  <div class="col-span-1 flex items-center justify-end gap-1">
    <button type="button" class="px-2 py-1 rounded bg-surface-container-high hover:bg-primary-container hover:text-on-primary-container text-primary font-label-sm text-label-sm flex items-center gap-1 transition-all">
      <span>Inspect</span>
      <span class="material-symbols-outlined text-[13px]">arrow_forward</span>
    </button>
  </div>
</div>`;

function findKpiCard(root, label) {
  const lab = [...root.querySelectorAll('span')].find(
    (el) => (el.textContent || '').trim() === label,
  );
  return lab?.closest('.p-space-sm, [class*="rounded"]') || null;
}

function setKpiCard(root, label, { value, unit, detail, barPct, trend } = {}) {
  const card = findKpiCard(root, label);
  if (!card) return;
  const valueEl = card.querySelector('.font-headline-md');
  if (valueEl && value !== undefined) setText(valueEl, value);
  if (unit !== undefined) {
    const afterValue = valueEl?.parentElement?.querySelector('.font-label-sm');
    if (afterValue) setText(afterValue, unit);
  }
  if (detail !== undefined) {
    const detailEl = card.querySelector('.font-code-compact');
    if (detailEl) detailEl.innerHTML = detail;
  }
  if (trend !== undefined) {
    const labels = valueEl?.parentElement?.querySelectorAll('.font-label-sm') || [];
    if (labels[0]) setText(labels[0], trend);
  }
  if (barPct !== undefined) {
    const bar = card.querySelector('.bg-tertiary.h-full, [style*="width"]');
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, Number(barPct) || 0))}%`;
  }
}

/** Hide All / Runtime / Audit tabs beside search — mode already scopes the list. */
function hideTypeFilterTabs(root) {
  if (!root) return;
  const group =
    root.querySelector('[data-eyra-type-filters]') ||
    root.querySelector('.type-filter-btn')?.closest('.inline-flex');
  if (group) {
    group.setAttribute('data-eyra-type-filters', '1');
    group.style.display = 'none';
  }
}

function findHistoryPager(root) {
  if (!root) return null;
  const tagged = root.querySelector('[data-eyra-history-pager]');
  if (tagged) return tagged;
  const label = [...root.querySelectorAll('span')].find((s) =>
    /Showing\s+\d+\s+entries/i.test(s.textContent || ''),
  );
  const pager = label?.closest('.flex.items-center.gap-space-xs') || label?.parentElement;
  if (pager) pager.setAttribute('data-eyra-history-pager', '1');
  return pager || null;
}

/** Update "Showing N entries"; hide strip when empty; hide mock 1…30 controls (no client paging yet). */
function setFooterCount(root, n) {
  const count = Math.max(0, Number(n) || 0);
  const pager = findHistoryPager(root);
  const label = pager
    ? [...pager.querySelectorAll('span')].find((s) =>
        /Showing\s+\d+\s+entr/i.test(s.textContent || ''),
      )
    : [...root.querySelectorAll('span')].find((s) =>
        /Showing\s+\d+\s+entr/i.test(s.textContent || ''),
      );
  if (label) setText(label, `Showing ${count} ${count === 1 ? 'entry' : 'entries'}`);
  if (!pager) return;

  // No rows → hide the whole footer pager (count + fake pages)
  if (count <= 0) {
    pager.style.display = 'none';
    return;
  }

  pager.style.display = '';
  // We render all rows in one list — don't show mock multi-page controls
  [...pager.querySelectorAll('button, span.px-1')].forEach((el) => {
    el.style.display = 'none';
  });
}

function scanSeverity(scan) {
  const sev = scan?.summary?.severity || {};
  if ((sev.Critical || 0) > 0) return 'CRITICAL';
  if ((sev.High || 0) > 0) return 'HIGH';
  if ((sev.Medium || 0) > 0) return 'MEDIUM';
  if ((sev.Low || 0) > 0) return 'LOW';
  return 'INFO';
}

function severityClass(sev) {
  const s = String(sev || '').toUpperCase();
  if (s === 'CRITICAL') {
    return 'px-1.5 py-0.5 rounded bg-error text-on-error font-label-sm text-label-sm font-semibold tracking-wider';
  }
  if (s === 'HIGH') {
    return 'px-1.5 py-0.5 rounded bg-primary-container text-on-primary-container font-label-sm text-label-sm font-semibold tracking-wider';
  }
  if (s === 'MEDIUM') {
    return 'px-1.5 py-0.5 rounded bg-surface-container-highest text-on-surface-variant font-label-sm text-label-sm font-semibold tracking-wider';
  }
  return 'px-1.5 py-0.5 rounded bg-surface-container-high text-outline font-label-sm text-label-sm font-semibold tracking-wider';
}

function statusBadgeClass(status) {
  const s = String(status || '').toLowerCase();
  if (/complet|verif/.test(s)) {
    return 'inline-flex items-center gap-1 px-2 py-0.5 rounded bg-tertiary/10 text-tertiary font-label-sm text-label-sm';
  }
  if (/fail|cancel|error/.test(s)) {
    return 'inline-flex items-center gap-1 px-2 py-0.5 rounded bg-error/10 text-error font-label-sm text-label-sm';
  }
  if (/analyz|pending|review|hypothesis/.test(s)) {
    return 'inline-flex items-center gap-1 px-2 py-0.5 rounded bg-secondary/10 text-secondary font-label-sm text-label-sm';
  }
  return 'inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container-high text-on-surface-variant font-label-sm text-label-sm';
}

function buildHistoryItems(sessions, scans) {
  const runtime = (sessions || []).map((item) => {
    const source = item.meta?.sourceType || item.source_type;
    const srcHint =
      source === 'github' || source === 'zip'
        ? String(source).toUpperCase()
        : null;
    return {
      kind: 'runtime',
      id: item.session_id,
      sessionId: item.session_id,
      project: item.project_name || 'default',
      scope: runtimeScopeLabel(item),
      title: item.error_type
        ? `${item.error_type}${item.error_summary ? `: ${item.error_summary}` : ''}`
        : item.error_summary || 'Debug session',
      subtitle: runtimeSubtitle(item),
      status: formatStatus(item.status),
      severity: runtimeSeverity(item),
      latency:
        item.confidence != null && !Number.isNaN(Number(item.confidence))
          ? `${Math.round(Number(item.confidence) * 100)}%`
          : item.reasoning_source === 'groq'
            ? 'Groq'
            : item.reasoning_source === 'local_heuristic'
              ? 'Local'
              : '—',
      when: item.created_at,
      language: item.language || '',
      verification: item.verification_status || '',
      sourceHint: srcHint,
    };
  });

  const audit = (scans || []).map((scan) => {
    const sev = scan.summary?.severity || {};
    const files = scan.summary?.totalFiles ?? scan.meta?.totalFilesCount ?? scan.fileInventory?.listed;
    const src =
      scan.sourceType ||
      scan.meta?.sourceType ||
      (scan.meta?.repoUrl ? 'github' : 'zip');
    const srcLabel = src === 'github' ? 'GitHub' : src === 'sample' ? 'Sample' : 'ZIP';
    return {
      kind: 'audit',
      id: scan.id,
      scanId: scan.id,
      project: scan.projectName || 'codebase',
      scope: files != null ? `${srcLabel} · ${files} files` : `${srcLabel} codebase`,
      title: `${scan.status || 'scan'} · health ${scan.summary?.healthScore ?? '—'}`,
      subtitle: `C${sev.Critical || 0} H${sev.High || 0} M${sev.Medium || 0} L${sev.Low || 0}${
        scan.meta?.repoUrl ? ` · ${String(scan.meta.repoUrl).replace(/^https?:\/\/(www\.)?github\.com\//i, '')}` : ''
      }`,
      status: scan.status || 'unknown',
      severity: scanSeverity(scan),
      latency: scan.summary?.grade || '—',
      when: scan.createdAt || scan.updatedAt,
    };
  });

  return [...runtime, ...audit].sort((a, b) => {
    const ta = a.when ? new Date(a.when).getTime() : 0;
    const tb = b.when ? new Date(b.when).getTime() : 0;
    return tb - ta;
  });
}

/** Wipe stitch mock numbers / rows immediately (keep table chrome). */
function paintHistoryIdle(root, { auditOnly = false } = {}) {
  if (!root) return;
  hideTypeFilterTabs(root);
  setKpiCard(root, 'Total Indexed', {
    value: '0',
    unit: auditOnly ? 'Audits' : 'Sessions',
    detail: auditOnly ? '0 ZIP / GitHub audits' : '0 Brain debug sessions',
  });
  setKpiCard(root, 'Resolution Rate', {
    value: '0%',
    trend: '—',
    barPct: 0,
  });
  setKpiCard(root, 'Engine Persistence', {
    value: '—',
    unit: auditOnly ? 'API store' : 'SQLite',
    detail: auditOnly ? 'No codebase audits yet' : 'No Brain sessions yet',
  });
  setKpiCard(root, 'Active Triage Needs', {
    value: '0',
    unit: 'None',
    detail: '0 Critical <span class="text-outline">•</span> 0 High',
  });

  const heatCard = findKpiCard(root, '30-Day Activity Heat');
  if (heatCard) {
    const rateEl = heatCard.querySelector('.font-code-compact.text-primary, .text-primary.font-code-compact');
    if (rateEl) setText(rateEl, '0/day');
    qsa(heatCard, '.w-1\\.5').forEach((bar) => {
      bar.className = (bar.className || '').replace(/h-\[\d+%\]/g, '').trim();
      bar.style.height = '10%';
      bar.style.opacity = '0.3';
    });
  }

  setFooterCount(root, 0);

  // Drop mock project options — keep All only
  const projectSelect = qs(root, '#projectSelect');
  if (projectSelect) {
    projectSelect.innerHTML = '<option class="bg-surface-container" value="all">All Projects</option>';
  }

  const body = qs(root, '#investigationTableBody');
  if (body) {
    qsa(body, '.investigation-row').forEach((row) => row.remove());
    let empty = body.querySelector('[data-eyra-history-empty]');
    if (!empty) {
      empty = document.createElement('div');
      empty.className =
        'px-space-md py-10 text-center font-body-sm text-body-sm text-on-surface-variant';
      empty.setAttribute('data-eyra-history-empty', '1');
      body.appendChild(empty);
    }
    empty.textContent = auditOnly
      ? 'No codebase audits yet — upload a ZIP or link a GitHub repo, then start a scan.'
      : 'No past sessions yet — run a debug investigation to populate history.';
    empty.style.display = '';
  }
}

function paintHistoryOffline(root, { auditOnly = false } = {}) {
  paintHistoryIdle(root, { auditOnly });
  const body = qs(root, '#investigationTableBody');
  const empty = body?.querySelector?.('[data-eyra-history-empty]');
  if (empty) {
    empty.textContent =
      'Brain offline — cannot load investigation history. Start the backend and refresh.';
  }
}

function hydrateHistoryKpis(root, sessions, scans, { auditOnly = false } = {}) {
  if (!root) return;
  hideTypeFilterTabs(root);
  const sessionCount = auditOnly ? 0 : sessions?.length || 0;
  const auditCount = scans?.length || 0;
  const total = sessionCount + auditCount;

  if (!total) {
    paintHistoryIdle(root, { auditOnly });
    return;
  }

  const completed =
    (auditOnly ? [] : sessions || [])
      .filter((s) => /verif|complet/i.test(s.status || '')).length +
    (scans || []).filter((s) => /complet/i.test(s.status || '')).length;
  const rate = Math.round((completed / total) * 1000) / 10;

  const triageScans = (scans || []).filter((s) => {
    const sev = s.summary?.severity || {};
    return (
      /pending|analyz|review/i.test(s.status || '') ||
      (sev.Critical || 0) + (sev.High || 0) > 0
    );
  });
  const triageSessions = auditOnly
    ? []
    : (sessions || []).filter((s) =>
        /needs_review|hypothesis|pending|analyz/i.test(s.status || ''),
      );
  const triage = triageScans.length + triageSessions.length;
  let crit = 0;
  let high = 0;
  for (const s of scans || []) {
    const sev = s.summary?.severity || {};
    if ((sev.Critical || 0) > 0) crit += 1;
    else if ((sev.High || 0) > 0) high += 1;
  }
  if (!auditOnly) {
    for (const s of sessions || []) {
      const sev = String(s.severity || '').toUpperCase();
      if (sev === 'CRITICAL') crit += 1;
      else if (sev === 'HIGH') high += 1;
    }
  }

  const now = Date.now();
  const dayMs = 86400000;
  const pool = auditOnly
    ? [...(scans || [])]
    : [...(sessions || []), ...(scans || [])];
  const last30 = pool.filter((item) => {
    const t = new Date(item.created_at || item.createdAt || 0).getTime();
    return t && now - t < 30 * dayMs;
  });
  const perDay = last30.length ? (last30.length / 30).toFixed(1) : '0';

  const verifiedSessions = auditOnly
    ? 0
    : (sessions || []).filter(
        (s) =>
          /verif/i.test(s.status || '') ||
          /pass|verif/i.test(s.verification_status || ''),
      ).length;
  const avgConf = (() => {
    if (auditOnly) return null;
    const vals = (sessions || [])
      .map((s) => Number(s.confidence))
      .filter((n) => !Number.isNaN(n) && n >= 0);
    if (!vals.length) return null;
    return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100);
  })();

  setKpiCard(root, 'Total Indexed', {
    value: String(total),
    unit: auditOnly
      ? total === 1
        ? 'Audit'
        : 'Audits'
      : total === 1
        ? 'Session'
        : 'Sessions',
    detail: auditOnly
      ? `${auditCount} ZIP / GitHub audits`
      : `${sessionCount} Brain debug session${sessionCount === 1 ? '' : 's'}`,
  });
  setKpiCard(root, 'Resolution Rate', {
    value: `${rate}%`,
    trend: auditOnly
      ? `${completed}/${total}`
      : `${verifiedSessions}/${total}${avgConf != null ? ` · ${avgConf}% avg` : ''}`,
    barPct: rate,
  });
  setKpiCard(root, 'Engine Persistence', {
    value: 'Live',
    unit: auditOnly ? 'API store' : 'SQLite',
    detail: auditOnly ? 'Past ZIP & GitHub audits' : 'Brain investigation sessions',
  });
  setKpiCard(root, 'Active Triage Needs', {
    value: String(triage),
    unit: triage ? 'Pending Action' : 'None',
    detail: `${crit} Critical <span class="text-outline">•</span> ${high} High`,
  });

  const heatCard = findKpiCard(root, '30-Day Activity Heat');
  if (heatCard) {
    const rateEl = heatCard.querySelector('.font-code-compact.text-primary, .text-primary.font-code-compact');
    if (rateEl) setText(rateEl, `${perDay}/day`);
    const bars = qsa(heatCard, '.w-1\\.5');
    const buckets = Array.from({ length: Math.max(bars.length, 1) }, () => 0);
    for (const item of last30) {
      const t = new Date(item.created_at || item.createdAt || 0).getTime();
      const ageDays = Math.min(buckets.length - 1, Math.floor((now - t) / dayMs));
      buckets[buckets.length - 1 - ageDays] += 1;
    }
    const max = Math.max(1, ...buckets);
    bars.forEach((bar, i) => {
      const h = Math.max(10, Math.round(((buckets[i] || 0) / max) * 100));
      bar.className = (bar.className || '').replace(/h-\[\d+%\]/g, '').trim();
      bar.style.height = `${h}%`;
      bar.style.opacity = '1';
    });
  }

  setFooterCount(root, total);

  // Rebuild project filter from real data
  const projectSelect = qs(root, '#projectSelect');
  if (projectSelect) {
    const names = new Set();
    if (!auditOnly) {
      for (const s of sessions || []) if (s.project_name) names.add(s.project_name);
    }
    for (const s of scans || []) if (s.projectName) names.add(s.projectName);
    projectSelect.innerHTML =
      '<option class="bg-surface-container" value="all">All Projects</option>' +
      [...names]
        .sort()
        .map((n) => `<option class="bg-surface-container" value="${n}">${n}</option>`)
        .join('');
  }
}

function fillHistoryRow(row, item, index) {
  row.dataset.type = item.kind;
  row.dataset.project = item.project;
  row.dataset.status = item.status;
  row.dataset.severity = item.severity;
  if (item.kind === 'audit') {
    row.dataset.scanId = item.scanId;
    delete row.dataset.sessionId;
  } else {
    row.dataset.sessionId = item.sessionId;
    delete row.dataset.scanId;
  }
  row.style.display = '';
  row.classList.toggle('bg-surface-container-low/40', index % 2 === 1);

  const typeBadge = row.querySelector('.uppercase');
  if (typeBadge) {
    setText(typeBadge, item.kind === 'audit' ? 'AUDIT' : 'RUNTIME');
    typeBadge.className =
      item.kind === 'audit'
        ? 'px-1.5 py-0.5 rounded font-label-sm text-label-sm uppercase font-semibold bg-secondary-container/20 text-secondary'
        : 'px-1.5 py-0.5 rounded font-label-sm text-label-sm uppercase font-semibold bg-primary-container/15 text-primary';
  }

  const tag = row.querySelector('.col-span-2 .font-code-compact');
  if (tag) setText(tag, shortSessionTag(item.id, index));

  const icon = row.querySelector('.col-span-3 .material-symbols-outlined');
  if (icon) {
    const lang = String(item.language || '').toLowerCase();
    let glyph = 'code';
    if (item.kind === 'audit') glyph = 'folder_zip';
    else if (/python|py/.test(lang)) glyph = 'terminal';
    else if (/javascript|typescript|js|ts|jsx|tsx/.test(lang)) glyph = 'javascript';
    else if (/java/.test(lang)) glyph = 'coffee';
    setText(icon, glyph);
  }

  const fileSpans = qsa(row, '.col-span-3 .font-code-compact');
  if (fileSpans[0]) setText(fileSpans[0], `${item.project} /`);
  if (fileSpans[1]) setText(fileSpans[1], item.scope);

  const errTitle = row.querySelector('.col-span-3 .font-body-sm');
  const errSub = row.querySelector('.col-span-3 [class*="text-[10px]"]');
  if (errTitle) setText(errTitle, item.title);
  if (errSub) setText(errSub, item.subtitle || '—');

  const statusWrap = row.querySelector('.col-span-1 .inline-flex');
  const statusLabel = statusWrap?.querySelector('span:last-child');
  if (statusWrap) statusWrap.className = statusBadgeClass(item.status);
  if (statusLabel) setText(statusLabel, item.status);

  const sevCol = qsa(row, '.col-span-1')[1];
  const sevEl = sevCol?.querySelector('span');
  if (sevEl) {
    setText(sevEl, item.severity);
    sevEl.className = severityClass(item.severity);
  }

  const latencyCol = qsa(row, '.col-span-1')[2];
  const latencyMain = latencyCol?.querySelector('.font-code-compact');
  const latencySub = latencyCol?.querySelector('[class*="text-[10px]"]');
  if (latencyMain) setText(latencyMain, item.latency);
  if (latencySub) {
    const when = item.when ? relativeTime(item.when) : '—';
    setText(
      latencySub,
      item.kind === 'runtime' && /%$/.test(String(item.latency || ''))
        ? `conf · ${when}`
        : when,
    );
  }
}

function hydrateHistoryTable(root, items, { auditOnly = false } = {}) {
  const body = qs(root, '#investigationTableBody');
  if (!body) return;

  // Always strip stitch mock rows first
  qsa(body, '.investigation-row').forEach((row) => row.remove());

  const empty = body.querySelector('[data-eyra-history-empty]');
  if (!items.length) {
    if (empty) {
      empty.style.display = '';
      empty.textContent = auditOnly
        ? 'No codebase audits yet — upload a ZIP or link a GitHub repo, then start a scan.'
        : 'No past sessions yet — run a debug investigation to populate history.';
    } else {
      paintHistoryIdle(root, { auditOnly });
    }
    return;
  }

  if (empty) empty.style.display = 'none';

  const wrap = document.createElement('div');
  wrap.innerHTML = ROW_TEMPLATE_HTML.trim();
  const tmpl = wrap.firstElementChild;
  if (!tmpl) return;

  items.forEach((item, i) => {
    const row = tmpl.cloneNode(true);
    fillHistoryRow(row, item, i);
    body.appendChild(row);
  });
}

function ExportFormatDialog({ open, busy, onClose, onChoose }) {
  if (!open) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[220] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="eyra-export-format-title"
      onClick={() => !busy && onClose?.()}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl border border-outline-variant/25 bg-surface-container-lowest shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-outline-variant/20 px-5 py-4">
          <h3
            id="eyra-export-format-title"
            className="font-headline-sm text-[18px] font-semibold text-on-surface"
          >
            Export history report
          </h3>
          <p className="mt-1 font-body-sm text-[12px] text-on-surface-variant">
            Choose a format. CSV opens in Excel; JSON is for tools and full structure.
            Includes findings, packages/CVEs, and open vs solved status.
          </p>
        </div>
        <div className="flex flex-col gap-2 p-4">
          <button
            type="button"
            disabled={busy}
            onClick={() => onChoose?.('csv')}
            className="flex items-start gap-3 rounded-xl border border-outline-variant/20 bg-surface-container/50 px-4 py-3 text-left transition-colors hover:border-primary/40 hover:bg-surface-container disabled:opacity-50"
          >
            <span className="material-symbols-outlined mt-0.5 text-[22px] text-tertiary">
              table_view
            </span>
            <span>
              <span className="block font-label-sm text-[13px] font-semibold text-on-surface">
                CSV (Excel)
              </span>
              <span className="mt-0.5 block font-body-sm text-[11px] text-on-surface-variant">
                UTF-8 spreadsheet — open directly in Microsoft Excel / Sheets
              </span>
            </span>
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onChoose?.('json')}
            className="flex items-start gap-3 rounded-xl border border-outline-variant/20 bg-surface-container/50 px-4 py-3 text-left transition-colors hover:border-primary/40 hover:bg-surface-container disabled:opacity-50"
          >
            <span className="material-symbols-outlined mt-0.5 text-[22px] text-primary">
              data_object
            </span>
            <span>
              <span className="block font-label-sm text-[13px] font-semibold text-on-surface">
                JSON
              </span>
              <span className="mt-0.5 block font-body-sm text-[11px] text-on-surface-variant">
                Complete structured report for debugging tools and APIs
              </span>
            </span>
          </button>
        </div>
        <div className="flex justify-end border-t border-outline-variant/20 px-4 py-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => onClose?.()}
            className="rounded-xl px-3 py-2 font-label-sm text-[12px] text-outline hover:text-on-surface disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function HistoryPage() {
  const navigate = useNavigate();
  const {
    adoptResult,
    showToast,
    setMode,
    mode,
    setAuditView,
    adoptScan,
    refreshScanList,
  } = useEyra();
  const hostRef = useRef(null);
  const itemsRef = useRef([]);
  const scansRef = useRef([]);
  const sessionsRef = useRef([]);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  // Codebase Audit mode → only ZIP / GitHub audit scans (never runtime sessions)
  const auditOnly = mode === 'audit';

  const scrubHistory = useCallback(
    (root) => {
      paintHistoryIdle(root, { auditOnly });
      const drawer = root?.querySelector?.('#inspectorDrawer');
      if (drawer) {
        drawer.style.display = 'none';
        drawer.classList.add('hidden');
      }
    },
    [auditOnly],
  );
  const { reveal, hold, gateClassName, gateProps } = useStitchGate(hostRef, {
    scrub: scrubHistory,
  });

  // Before paint: strip any leftover stitch mock rows / KPI numbers
  useLayoutEffect(() => {
    const root = hostRef.current?.querySelector('.stitch-screen') || hostRef.current;
    scrubHistory(root);
  }, [auditOnly, HISTORY_UI_VERSION, scrubHistory]);

  useEffect(() => {
    let cancelled = false;
    hold();
    const root = hostRef.current?.querySelector('.stitch-screen') || hostRef.current;
    scrubHistory(root);

    (async () => {
      let sessions = [];
      let scans = [];
      let historyFailed = false;
      let scansFailed = false;
      if (!auditOnly) {
        try {
          const data = await api.history({ limit: 50 });
          sessions = data?.items || [];
        } catch {
          historyFailed = true;
          sessions = [];
        }
      }
      try {
        scans = (await refreshScanList()) || [];
      } catch {
        scansFailed = true;
        scans = [];
      }
      if (cancelled) return;

      const liveRoot = hostRef.current?.querySelector('.stitch-screen') || hostRef.current;
      const offline = auditOnly ? scansFailed : historyFailed;
      if (offline) {
        paintHistoryOffline(liveRoot, { auditOnly });
        sessionsRef.current = [];
        scansRef.current = [];
        itemsRef.current = [];
        if (!cancelled) reveal();
        return;
      }

      sessionsRef.current = sessions;
      scansRef.current = scans;
      // Audit shell: ZIP/GitHub scans only. Runtime shell: sessions only.
      const items = auditOnly
        ? buildHistoryItems([], scans)
        : buildHistoryItems(sessions, []);
      itemsRef.current = items;

      hydrateHistoryKpis(liveRoot, sessions, auditOnly ? scans : [], { auditOnly });
      hydrateHistoryTable(liveRoot, items, { auditOnly });
      if (!cancelled) reveal();
    })();

    return () => {
      cancelled = true;
    };
  }, [refreshScanList, auditOnly, scrubHistory, hold, reveal]);

  return (
    <div
      key={`history-host-${HISTORY_UI_VERSION}-${auditOnly ? 'audit' : 'runtime'}`}
      ref={hostRef}
      className={gateClassName}
      {...gateProps}
      onClick={async (e) => {
        const btn = e.target.closest('button, a');
        const row = e.target.closest('.investigation-row');
        const text = (btn?.textContent || '').trim();
        const wantsInspect =
          (btn &&
            (text.includes('Inspect') ||
              text.includes('Open Session') ||
              text.includes('Open'))) ||
          (row && !btn);

        if (wantsInspect) {
          e.preventDefault();
          const scanId = row?.dataset?.scanId;
          if (scanId || row?.dataset?.type === 'audit') {
            const id = scanId || scansRef.current[0]?.id;
            if (!id) {
              showToast?.('No audit scan to open', 'error');
              return;
            }
            try {
              const data = await api.getScan(id);
              const scan = data?.scan || data;
              adoptScan(scan, { notify: false });
              setMode('audit');
              setAuditView(scan?.status === 'completed' ? 'code' : 'progress');
            } catch (err) {
              showToast?.(err.message || 'Failed to load scan', 'error');
            }
            return;
          }

          setMode('runtime');
          const sid = row?.dataset?.sessionId;
          try {
            if (sid) {
              const detail = await api.historyDetail(sid);
              adoptResult(detail);
              navigate('/analysis');
              return;
            }
          } catch (err) {
            showToast?.(err.message || 'Failed to load session', 'error');
          }
          showToast?.('No session to open', 'info');
          return;
        }

        if (btn?.classList?.contains('type-filter-btn')) {
          e.preventDefault();
          return;
        }

        if (text.includes('Workspace') || text.includes('Debug')) {
          e.preventDefault();
          setMode('runtime');
          navigate('/workspace');
        } else if (text.includes('Export') || text.includes('Download') || text.includes('Report')) {
          e.preventDefault();
          if (!itemsRef.current.length && !scansRef.current.length) {
            showToast?.('Nothing to export yet', 'info');
            return;
          }
          setExportOpen(true);
        } else if (text.includes('Clear Stale') || text.includes('Clear')) {
          e.preventDefault();
          const root = hostRef.current?.querySelector('.stitch-screen') || hostRef.current;
          if (!auditOnly) {
            try {
              const result = await api.clearHistory();
              sessionsRef.current = [];
              itemsRef.current = [];
              paintHistoryIdle(root, { auditOnly });
              showToast?.(
                `Cleared ${result?.cleared ?? 0} Brain sessions — History stays empty until you debug again`,
                'info',
              );
            } catch (err) {
              showToast?.(err.message || 'Failed to clear session history', 'error');
            }
            return;
          }
          try {
            const result = await api.clearScans();
            await refreshScanList();
            scansRef.current = [];
            sessionsRef.current = [];
            itemsRef.current = [];
            paintHistoryIdle(root, { auditOnly: true });
            showToast?.(
              `Cleared ${result?.cleared ?? 0} past audits — History is empty until you scan again`,
              'info',
            );
          } catch (err) {
            showToast?.(err.message || 'Failed to clear audit history', 'error');
          }
        } else if (text.includes('Reset')) {
          e.preventDefault();
          const root = hostRef.current?.querySelector('.stitch-screen') || hostRef.current;
          hydrateHistoryTable(root, itemsRef.current, { auditOnly });
          setFooterCount(root, itemsRef.current.length);
          showToast?.('Filters reset', 'info');
        }
      }}
    >
      <HistoryStitch />
      <ExportFormatDialog
        open={exportOpen}
        busy={exportBusy}
        onClose={() => !exportBusy && setExportOpen(false)}
        onChoose={async (format) => {
          if (exportBusy) return;
          setExportBusy(true);
          try {
            const list = scansRef.current || [];
            const detailed = [];
            const sessionDetails = [];

            if (auditOnly) {
              // Load full scan payloads (findings, deps) for up to 12 recent audits
              const candidates = list.slice(0, 12);
              for (const row of candidates) {
                const id = row?.id;
                if (!id) continue;
                try {
                  const data = await api.getScan(id);
                  const scan = data?.scan || data;
                  if (scan) detailed.push(scan);
                } catch {
                  if (row.issues || row.summary) detailed.push(row);
                }
              }
            } else {
              // Load full Brain session payloads for up to 12 recent runtime rows
              const candidates = (sessionsRef.current || []).slice(0, 12);
              for (const row of candidates) {
                const id = row?.session_id;
                if (!id) continue;
                try {
                  const detail = await api.historyDetail(id);
                  if (detail) sessionDetails.push(detail);
                } catch {
                  sessionDetails.push(row);
                }
              }
            }

            downloadHistoryExport({
              historyItems: itemsRef.current || [],
              scans: auditOnly ? (detailed.length ? detailed : list) : [],
              sessions: auditOnly ? [] : sessionDetails,
              format,
            });
            setExportOpen(false);
            showToast?.(
              format === 'csv'
                ? 'History report downloaded (CSV — open in Excel)'
                : 'History report downloaded (JSON)',
              'info',
            );
          } catch (err) {
            showToast?.(err.message || 'Export failed', 'error');
          } finally {
            setExportBusy(false);
          }
        }}
      />
    </div>
  );
}
