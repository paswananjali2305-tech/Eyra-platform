import { useNavigate } from 'react-router-dom';
import { useEyra } from '../context/EyraContext';
import OverviewStitch from './stitch_raw/OverviewPage.jsx';

export function OverviewPage() {
  const navigate = useNavigate();
  const { setMode, setAuditView, showToast } = useEyra();

  return (
    <div
      onClick={(e) => {
        const el = e.target.closest('button, a');
        if (!el) return;
        const text = (el.textContent || '').trim();
        if (text.includes('Start Debugging') || text.includes('Open Debugging Workspace')) {
          e.preventDefault();
          navigate('/workspace');
        } else if (text.includes('Audit Codebase')) {
          e.preventDefault();
          setMode('audit');
          setAuditView('ingest');
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
