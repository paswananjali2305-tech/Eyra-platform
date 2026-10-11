import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useEyra } from '../context/EyraContext';
import MemoryStitch from './stitch_raw/MemoryPage.jsx';

export function MemoryPage() {
  const navigate = useNavigate();
  const { adoptResult, showToast } = useEyra();

  return (
    <div
      onClick={async (e) => {
        const el = e.target.closest('button, a');
        if (!el) return;
        const text = (el.textContent || '').trim();
        if (text.includes('Copy Fix') || text.includes('Copy')) {
          e.preventDefault();
          try {
            await navigator.clipboard.writeText(
              'if divisor != 0:\n    result = dividend / divisor\nelse:\n    result = handle_zero_case()\n',
            );
            showToast?.('Fix copied', 'info');
          } catch {
            showToast?.('Clipboard blocked', 'error');
          }
        } else if (text.includes('#') || text.includes('Session') || text.includes('Open')) {
          e.preventDefault();
          try {
            const data = await api.memory({ limit: 1 });
            const first = data.items?.[0];
            if (first) {
              const detail = await api.historyDetail(first.session_id);
              adoptResult(detail);
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
