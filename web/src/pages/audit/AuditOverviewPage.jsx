import { useNavigate } from 'react-router-dom';
import { useEyra } from '../../context/EyraContext';
import AuditOverviewStitch from '../stitch_raw/audit/AuditOverviewPage.jsx';

export function AuditOverviewPage() {
  const { setAuditView, setMode, showToast } = useEyra();
  const navigate = useNavigate();

  return (
    <div
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
        } else if (text.includes('Send to Debugging') || text.includes('Debugging Workspace')) {
          e.preventDefault();
          setMode('runtime');
          navigate('/workspace');
        } else if (text.includes('Progress') || text.includes('Live Audit')) {
          e.preventDefault();
          setAuditView('progress');
        } else if (text.includes('refresh') || text.includes('Refresh')) {
          e.preventDefault();
          showToast?.('Audit overview refreshed', 'info');
        }
      }}
    >
      <AuditOverviewStitch />
    </div>
  );
}
