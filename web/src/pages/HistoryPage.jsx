import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useEyra } from '../context/EyraContext';
import HistoryStitch from './stitch_raw/HistoryPage.jsx';

export function HistoryPage() {
  const navigate = useNavigate();
  const { adoptResult, showToast, setMode } = useEyra();

  return (
    <div
      onClick={async (e) => {
        const el = e.target.closest('button, a');
        if (!el) return;
        const text = (el.textContent || '').trim();
        if (text.includes('Inspect') || text.includes('Open') || text.includes('Session')) {
          e.preventDefault();
          setMode('runtime');
          try {
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
        } else if (text.includes('Export') || text.includes('Download')) {
          e.preventDefault();
          showToast?.('Export queued (demo)', 'info');
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
