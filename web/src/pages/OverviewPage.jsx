import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useEyra } from '../context/EyraContext';
import {
  formatStatus,
  qsa,
  relativeTime,
  replaceSubstring,
  setKpiByLabel,
  setText,
} from '../lib/hydrateStitch.js';
import OverviewStitch from './stitch_raw/OverviewPage.jsx';

function hydrateOverview(root, status, historyItems) {
  if (!root) return;

  if (status) {
    setKpiByLabel(root, 'Runtime Sessions', status.session_count ?? 0);
    setKpiByLabel(root, 'AST Patterns', status.session_count ?? 0);

    replaceSubstring(root, '3 active', `${status.open_investigations ?? 0} active`);
    replaceSubstring(root, '89 verified', `${status.verified_count ?? 0} verified`);
  }

  const items = historyItems || [];
  if (!items.length) return;

  const recentHeading = Array.from(root.querySelectorAll('span, h2')).find(
    (el) => (el.textContent || '').trim() === 'Recent Sessions',
  );
  const recentBox = recentHeading?.closest('.flex.flex-col') || recentHeading?.parentElement;
  const sessionRows = recentBox
    ? qsa(recentBox, '.cursor-pointer, .rounded-lg.bg-surface-container').filter((el) =>
        /Error|Timeout|KeyError|Exception|Needs Review|Verified/i.test(el.textContent || ''),
      )
    : [];

  items.slice(0, 3).forEach((item, i) => {
    const row = sessionRows[i];
    if (!row) return;
    row.dataset.sessionId = item.session_id;
    const errEl = row.querySelector('.font-code-compact.font-medium, .text-error.font-medium');
    if (errEl) setText(errEl, item.error_type || 'Session');
    const fileEl = row.querySelector('.truncate');
    if (fileEl && fileEl !== errEl) {
      setText(fileEl, `${item.file_name || 'snippet.py'} · ${(item.root_cause || '').slice(0, 48)}`);
    }
    const timeEl = Array.from(row.querySelectorAll('span')).find((s) =>
      /\d+[mhd]\s*ago|mins ago|just now/i.test(s.textContent || ''),
    );
    if (timeEl && item.created_at) setText(timeEl, relativeTime(item.created_at));
    const statusEl = Array.from(row.querySelectorAll('span')).find((s) =>
      /Needs Review|Verified|Hypothesis|Failed/i.test((s.textContent || '').trim()),
    );
    if (statusEl) setText(statusEl, formatStatus(item.status));
  });

  // Incident focus / priority attention — first item
  const first = items[0];
  if (first) {
    if (first.error_type) replaceSubstring(root, 'ZeroDivisionError', first.error_type);
    if (first.file_name) replaceSubstring(root, 'test.py:3', first.file_name);
    if (first.root_cause) {
      const preview = Array.from(root.querySelectorAll('p.font-body-sm, p')).find((p) =>
        /Divisor|divisor|b=0|null-guard/i.test(p.textContent || ''),
      );
      if (preview) setText(preview, first.root_cause);
    }
  }
}

export function OverviewPage() {
  const navigate = useNavigate();
  const { setMode, setAuditView, showToast, status } = useEyra();
  const hostRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const hist = await api.history({ limit: 5 });
        if (cancelled) return;
        const root = hostRef.current?.querySelector('.stitch-screen') || hostRef.current;
        hydrateOverview(root, status, hist.items || []);
      } catch {
        const root = hostRef.current?.querySelector('.stitch-screen') || hostRef.current;
        hydrateOverview(root, status, []);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status]);

  return (
    <div
      ref={hostRef}
      onClick={(e) => {
        const el = e.target.closest('button, a');
        if (!el) return;
        const text = (el.textContent || '').trim();
        if (text.includes('Start Debugging') || text.includes('Open Debugging Workspace')) {
          e.preventDefault();
          navigate('/workspace');
        } else if (text.includes('Audit Codebase') || text.includes('View Audit Results')) {
          e.preventDefault();
          setMode('audit');
          setAuditView(text.includes('View Audit') ? 'code' : 'ingest');
        } else if (text.includes('Inspect') || text.includes('Review')) {
          e.preventDefault();
          navigate('/analysis');
        } else if (text.includes('History') || text.includes('View All')) {
          e.preventDefault();
          navigate('/history');
        } else if (text.includes('Pin')) {
          e.preventDefault();
          showToast?.('Session pinned locally', 'info');
        } else if (text.includes('Memory')) {
          e.preventDefault();
          navigate('/memory');
        }
      }}
    >
      <OverviewStitch />
    </div>
  );
}
