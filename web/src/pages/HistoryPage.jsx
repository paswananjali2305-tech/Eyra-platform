import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useEyra } from '../context/EyraContext';
import {
  formatStatus,
  qs,
  qsa,
  relativeTime,
  setText,
  shortSessionTag,
} from '../lib/hydrateStitch.js';
import HistoryStitch from './stitch_raw/HistoryPage.jsx';

function hydrateHistoryRows(root, items) {
  if (!root || !items?.length) return;
  const body = qs(root, '#investigationTableBody');
  if (!body) return;
  const rows = qsa(body, '.investigation-row');
  items.forEach((item, i) => {
    const row = rows[i];
    if (!row) return;
    row.dataset.sessionId = item.session_id;
    row.dataset.status = formatStatus(item.status);
    row.dataset.type = 'runtime';
    row.dataset.project = item.project_name || 'default';
    delete row.dataset.scanId;

    const tag = row.querySelector('.font-code-compact.font-medium, .font-code-compact.text-on-surface');
    if (tag && (tag.textContent || '').trim().startsWith('#')) {
      setText(tag, shortSessionTag(item.session_id, i));
    }
    const fileSpans = qsa(row, '.col-span-3 .font-code-compact');
    if (fileSpans[0]) setText(fileSpans[0], `${item.project_name || 'default'} /`);
    if (fileSpans[1]) setText(fileSpans[1], item.file_name || 'snippet.py');
    const errTitle = row.querySelector('.col-span-3 .font-body-sm, .font-body-sm');
    const errSub = row.querySelector(
      '.col-span-3 .font-code-compact.text-outline, .col-span-3 [class*="text-[10px]"]',
    );
    if (errTitle) {
      setText(
        errTitle,
        item.error_type
          ? `${item.error_type}${item.error_summary ? `: ${item.error_summary}` : ''}`
          : item.error_summary || 'Session',
      );
    }
    if (errSub) setText(errSub, item.root_cause || item.error_summary || '');
    const statusSpan = Array.from(row.querySelectorAll('span')).find((s) =>
      /Needs Review|Verified|Hypothesis|Completed|Failed|Unverified|Analyzing|Pending/i.test(
        (s.textContent || '').trim(),
      ),
    );
    if (statusSpan) setText(statusSpan, formatStatus(item.status));
    const timeEl = row.querySelector('.col-span-1 .font-label-sm, .col-span-1 [class*="text-[10px]"]');
    if (timeEl && item.created_at) setText(timeEl, relativeTime(item.created_at));
  });
}

function hydrateAuditScanRows(root, scans) {
  if (!root || !scans?.length) return;
  const body = qs(root, '#investigationTableBody');
  if (!body) return;
  const rows = qsa(body, '.investigation-row');
  scans.forEach((scan, i) => {
    const row = rows[i];
    if (!row) return;
    row.dataset.scanId = scan.id;
    delete row.dataset.sessionId;
    row.dataset.type = 'audit';
    row.dataset.status = scan.status || '';
    row.dataset.project = scan.projectName || 'codebase';

    const typeBadge = row.querySelector('.uppercase');
    if (typeBadge) setText(typeBadge, 'AUDIT');

    const tag = row.querySelector('.font-code-compact.font-medium, .font-code-compact.text-on-surface');
    if (tag) setText(tag, shortSessionTag(scan.id, i));

    const fileSpans = qsa(row, '.col-span-3 .font-code-compact');
    if (fileSpans[0]) setText(fileSpans[0], `${scan.projectName || 'codebase'} /`);
    if (fileSpans[1]) {
      setText(
        fileSpans[1],
        `${scan.summary?.totalFiles ?? scan.meta?.totalFilesCount ?? '?'} files`,
      );
    }
    const errTitle = row.querySelector('.col-span-3 .font-body-sm, .font-body-sm');
    const errSub = row.querySelector(
      '.col-span-3 .font-code-compact.text-outline, .col-span-3 [class*="text-[10px]"]',
    );
    if (errTitle) {
      setText(
        errTitle,
        `${scan.status || 'scan'} · health ${scan.summary?.healthScore ?? '—'}`,
      );
    }
    if (errSub) {
      const sev = scan.summary?.severity || {};
      setText(
        errSub,
        `C${sev.Critical || 0} H${sev.High || 0} M${sev.Medium || 0} L${sev.Low || 0}`,
      );
    }
    const statusSpan = Array.from(row.querySelectorAll('span')).find((s) =>
      /Needs Review|Verified|Hypothesis|Completed|Failed|Unverified|Analyzing|Pending/i.test(
        (s.textContent || '').trim(),
      ),
    );
    if (statusSpan) setText(statusSpan, scan.status || 'unknown');
    const timeEl = row.querySelector('.col-span-1 .font-label-sm, .col-span-1 [class*="text-[10px]"]');
    if (timeEl && scan.createdAt) setText(timeEl, relativeTime(scan.createdAt));
  });
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const root = hostRef.current?.querySelector('.stitch-screen') || hostRef.current;
      if (mode === 'audit') {
        try {
          const scans = await refreshScanList();
          if (cancelled) return;
          scansRef.current = scans || [];
          hydrateAuditScanRows(root, scansRef.current);
        } catch (err) {
          showToast?.(err.message || 'Audit history unavailable — showing demo rows', 'error');
        }
        return;
      }
      try {
        const data = await api.history({ limit: 20 });
        if (cancelled) return;
        itemsRef.current = data.items || [];
        hydrateHistoryRows(root, itemsRef.current);
      } catch (err) {
        showToast?.(err.message || 'History unavailable — showing demo rows', 'error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showToast, mode, refreshScanList]);

  return (
    <div
      ref={hostRef}
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
          if (mode === 'audit' || scanId) {
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
            const data = await api.history({ limit: 1 });
            const first = data.items?.[0];
            if (first) {
              const detail = await api.historyDetail(first.session_id);
              adoptResult(detail);
              navigate('/analysis');
              return;
            }
          } catch (err) {
            showToast?.(err.message || 'Failed to load session', 'error');
          }
          navigate('/analysis');
        } else if (text.includes('Workspace') || text.includes('Debug')) {
          e.preventDefault();
          setMode('runtime');
          navigate('/workspace');
        } else if (text.includes('Export') || text.includes('Download') || text.includes('Report')) {
          e.preventDefault();
          if (mode === 'audit') {
            const id =
              row?.dataset?.scanId ||
              scansRef.current[0]?.id;
            if (!id) {
              showToast?.('No scan available for report export', 'error');
              return;
            }
            try {
              const blob = await api.downloadReport(id, 'markdown');
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `codeaudit-report-${id}.md`;
              a.click();
              URL.revokeObjectURL(url);
              showToast?.('Audit report downloaded', 'info');
            } catch (err) {
              showToast?.(err.message || 'Report export failed', 'error');
            }
            return;
          }
          try {
            const blob = new Blob([JSON.stringify(itemsRef.current, null, 2)], {
              type: 'application/json',
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'eyra-history.json';
            a.click();
            URL.revokeObjectURL(url);
            showToast?.('History exported', 'info');
          } catch {
            showToast?.('Export queued (demo)', 'info');
          }
        } else if (text.includes('Search') || text.includes('Filter')) {
          e.preventDefault();
          showToast?.('Use header ⌘K to search sessions', 'info');
        }
      }}
    >
      <HistoryStitch />
    </div>
  );
}
