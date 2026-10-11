import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useEyra } from '../context/EyraContext';
import { formatStatus, qsa, setText, shortSessionTag } from '../lib/hydrateStitch.js';
import MemoryStitch from './stitch_raw/MemoryPage.jsx';

function hydrateMemoryCards(root, items) {
  if (!root || !items?.length) return;

  const cards = qsa(root, '.p-space-sm.rounded, [id^="item-"]');
  const targets = cards.filter((c) => {
    const t = c.textContent || '';
    return /#\d{3,}|ZeroDivision|Redis|KeyError|Error/i.test(t);
  });

  items.forEach((item, i) => {
    const card = targets[i] || (i === 0 ? root.querySelector('#item-0042') : null);
    if (!card) return;
    card.dataset.sessionId = item.session_id;

    const idEl = card.querySelector('.font-code-compact.font-semibold, .font-code-compact');
    if (idEl && /#/.test(idEl.textContent || '')) {
      setText(idEl, shortSessionTag(item.session_id, i));
    }
    const title =
      card.querySelector('.font-headline-sm, .font-body-md.font-semibold, .font-semibold.text-on-surface') ||
      Array.from(card.querySelectorAll('span')).find((s) =>
        /Error|Timeout|KeyError|Exception/i.test(s.textContent || ''),
      );
    if (title) setText(title, item.error_type || 'Session');

    const badge = Array.from(card.querySelectorAll('span')).find((s) =>
      /VERIFIED|NEEDS|HYPOTHESIS|FAILED|UNVERIFIED/i.test((s.textContent || '').trim()),
    );
    if (badge) setText(badge, formatStatus(item.status).toUpperCase());

    const desc = card.querySelector('p.font-body-sm, p');
    if (desc) setText(desc, item.root_cause || item.error_summary || '');
  });
}

export function MemoryPage() {
  const navigate = useNavigate();
  const { adoptResult, showToast } = useEyra();
  const hostRef = useRef(null);
  const itemsRef = useRef([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.memory({ limit: 20 });
        if (cancelled) return;
        itemsRef.current = data.items || [];
        if (!itemsRef.current.length) return;
        const root = hostRef.current?.querySelector('.stitch-screen') || hostRef.current;
        hydrateMemoryCards(root, itemsRef.current);
      } catch {
        /* keep Stitch fallback cards */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      ref={hostRef}
      onClick={async (e) => {
        const el = e.target.closest('button, a, [id^="item-"], [data-session-id]');
        if (!el) return;
        const text = (el.textContent || '').trim();
        if (text.includes('Copy Fix') || (text.includes('Copy') && el.id === 'copy-solution-btn')) {
          e.preventDefault();
          const sid =
            hostRef.current?.querySelector('[data-session-id]')?.dataset?.sessionId ||
            itemsRef.current[0]?.session_id;
          let patch =
            'if divisor != 0:\n    result = dividend / divisor\nelse:\n    result = handle_zero_case()\n';
          try {
            if (sid) {
              const detail = await api.historyDetail(sid);
              patch =
                detail.suggested_correction?.corrected_code ||
                detail.suggested_correction?.diff_unified ||
                patch;
            }
            await navigator.clipboard.writeText(patch);
            showToast?.('Fix copied', 'info');
          } catch {
            showToast?.('Clipboard blocked', 'error');
          }
        } else if (
          el.dataset?.sessionId ||
          el.id?.startsWith('item-') ||
          text.includes('#') ||
          text.includes('Session') ||
          text.includes('Open')
        ) {
          if (el.matches?.('button, a, [id^="item-"], [data-session-id]')) e.preventDefault();
          const sid =
            el.dataset?.sessionId ||
            el.closest?.('[data-session-id]')?.dataset?.sessionId ||
            itemsRef.current[0]?.session_id;
          try {
            if (sid) {
              const detail = await api.historyDetail(sid);
              adoptResult(detail);
            } else {
              const data = await api.memory({ limit: 1 });
              const first = data.items?.[0];
              if (first) {
                const detail = await api.historyDetail(first.session_id);
                adoptResult(detail);
              }
            }
          } catch {
            /* ignore */
          }
          navigate('/analysis');
        } else if (text.includes('Workspace')) {
          e.preventDefault();
          navigate('/workspace');
        }
      }}
    >
      <MemoryStitch />
    </div>
  );
}
