import { useEffect, useRef } from 'react';
import { api } from '../../api/client';
import { useEyra } from '../../context/EyraContext';
import { qs, replaceSubstring, setText } from '../../lib/hydrateStitch.js';
import AuditProgressStitch from '../stitch_raw/audit/AuditProgressPage.jsx';

function hydrateProgress(root, scan) {
  if (!root || !scan) return;
  const idShort = String(scan.id || '').slice(0, 8);
  replaceSubstring(root, '#SC-089 (In Progress)', `#${idShort} (${scan.status || '…'})`);
  replaceSubstring(root, '#SC-089', `#${idShort}`);
  replaceSubstring(root, 'SC-089', idShort);

  if (scan.projectName) {
    const title = root.querySelector('.font-headline-md, .font-headline-lg');
    if (title) setText(title, scan.projectName);
  }

  const pct = typeof scan.progress === 'number' ? Math.max(0, Math.min(100, scan.progress)) : null;
  if (pct != null) {
    const pctLabels = Array.from(root.querySelectorAll('span, div')).filter((el) =>
      /^\d{1,3}%$/.test((el.textContent || '').trim()),
    );
    pctLabels.slice(0, 3).forEach((el) => setText(el, `${pct}%`));

    const bars = qsa(root, '[style*="width"], .bg-primary, .bg-primary-container');
    for (const bar of bars) {
      const style = bar.getAttribute('style') || '';
      if (/width\s*:/.test(style) || bar.className.includes('h-')) {
        if (bar.tagName === 'DIV' && (style.includes('width') || bar.classList.contains('h-2') || bar.classList.contains('h-1.5') || /h-\d/.test(bar.className))) {
          bar.style.width = `${pct}%`;
        }
      }
    }
  }

  if (scan.currentStage) {
    const stageEl = Array.from(root.querySelectorAll('span, p, div')).find((el) =>
      /Parsing AST|Auditing|Unpacking|semantic|In Progress|current stage/i.test(el.textContent || ''),
    );
    if (stageEl && (stageEl.textContent || '').length < 120) {
      setText(stageEl, scan.currentStage);
    } else {
      replaceSubstring(root, 'Parsing AST and syntax tree', scan.currentStage);
    }
  }

  if (scan.status === 'failed' && scan.error) {
    replaceSubstring(root, 'Audit report finalized', `Failed: ${scan.error}`);
    replaceSubstring(root, 'In Progress', 'Failed');
  }
  if (scan.status === 'completed') {
    replaceSubstring(root, 'In Progress', 'Completed');
  }
}

export function AuditProgressPage() {
  const { setAuditView, showToast, activeScanId, activeScan, adoptScan, refreshScan } = useEyra();
  const hostRef = useRef(null);
  const esRef = useRef(null);
  const pollRef = useRef(null);

  useEffect(() => {
    const root = hostRef.current?.querySelector('.stitch-screen') || hostRef.current;
    if (activeScan) hydrateProgress(root, activeScan);
  }, [activeScan]);

  useEffect(() => {
    const scanId = activeScanId;
    if (!scanId) {
      showToast?.('No active scan — ingest a ZIP or sample first', 'info');
      return undefined;
    }

    let cancelled = false;

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
        },
        { notify: partial.status === 'completed' || partial.status === 'failed' },
      );
      if (partial.status === 'completed') {
        refreshScan(scanId);
      }
    }

    // Prefer SSE via Brain proxy
    try {
      const es = new EventSource(api.scanEventsUrl(scanId));
      esRef.current = es;
      es.onmessage = (ev) => {
        try {
          applyPartial(JSON.parse(ev.data));
        } catch {
          /* ignore malformed */
        }
      };
      es.onerror = () => {
        /* fall through to polling; keep EventSource — browser retries */
      };
    } catch {
      /* SSE unavailable */
    }

    // Polling backup (always) — honest status from GET /scan/:id
    const tick = async () => {
      try {
        const data = await api.getScan(scanId);
        if (cancelled) return;
        const scan = data?.scan || data;
        if (scan) {
          adoptScan(scan);
          if (scan.status === 'completed' || scan.status === 'failed') {
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
        if (!cancelled) showToast?.(err.message || 'Scan poll failed', 'error');
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bind to scan id only
  }, [activeScanId]);

  return (
    <div
      ref={hostRef}
      onClick={async (e) => {
        const el = e.target.closest('button, a');
        if (!el) return;
        const text = (el.textContent || '').trim();
        if (text.includes('Cancel Audit') || (text.includes('Cancel') && !text.includes('Partial'))) {
          e.preventDefault();
          setAuditView('overview');
          showToast?.('Left progress view (scan may still run on server)', 'info');
        } else if (
          text.includes('View Partial Findings') ||
          text.includes('Partial Findings') ||
          text.includes('Open Code') ||
          text.includes('Code Audit') ||
          text.includes('View Findings') ||
          text.includes('Report')
        ) {
          e.preventDefault();
          if (activeScanId) {
            try {
              await refreshScan(activeScanId);
            } catch {
              /* ignore */
            }
          }
          if (text.includes('Report') && activeScanId) {
            try {
              const blob = await api.downloadReport(activeScanId, 'markdown');
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `codeaudit-report-${activeScanId}.md`;
              a.click();
              URL.revokeObjectURL(url);
              showToast?.('Report downloaded', 'info');
            } catch (err) {
              showToast?.(err.message || 'Report export failed', 'error');
            }
          }
          setAuditView('code');
        } else if (text.includes('Codebase Audit') || text.includes('Scans')) {
          e.preventDefault();
          setAuditView('overview');
        } else if (text.includes('Ingest')) {
          e.preventDefault();
          setAuditView('ingest');
        }
      }}
    >
      <AuditProgressStitch />
      {!activeScanId ? (
        <div className="fixed bottom-6 left-1/2 z-[80] -translate-x-1/2 rounded bg-surface-container-highest px-space-md py-space-sm font-body-sm text-body-sm text-on-surface shadow-xl">
          No active scan ID — use Ingest to upload a ZIP or sample.
        </div>
      ) : null}
    </div>
  );
}
