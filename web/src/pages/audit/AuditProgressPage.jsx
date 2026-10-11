import { useEyra } from '../../context/EyraContext';
import AuditProgressStitch from '../stitch_raw/audit/AuditProgressPage.jsx';

export function AuditProgressPage() {
  const { setAuditView, showToast } = useEyra();

  return (
    <div
      onClick={(e) => {
        const el = e.target.closest('button, a');
        if (!el) return;
        const text = (el.textContent || '').trim();
        if (text.includes('Cancel Audit') || text.includes('Cancel')) {
          e.preventDefault();
          setAuditView('overview');
          showToast?.('Audit cancelled (UI)', 'info');
        } else if (
          text.includes('View Partial Findings') ||
          text.includes('Partial Findings') ||
          text.includes('Open Code') ||
          text.includes('Code Audit') ||
          text.includes('View Findings') ||
          text.includes('Report')
        ) {
          e.preventDefault();
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
    </div>
  );
}
