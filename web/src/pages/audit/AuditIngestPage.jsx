import { api } from '../../api/client';
import { useEyra } from '../../context/EyraContext';
import AuditIngestStitch from '../stitch_raw/audit/AuditIngestPage.jsx';

export function AuditIngestPage() {
  const { setAuditView, showToast, pushNotification } = useEyra();

  async function startSample(sampleId) {
    try {
      showToast?.('Uploading sample…', 'info');
      const result = await api.loadSample(sampleId);
      const scanId = result.scanId || result.scan?.id;
      if (scanId) await api.startScan(scanId);
      pushNotification?.({
        title: 'Audit started',
        body: `Sample ${sampleId}${scanId ? ` · ${scanId.slice(0, 8)}…` : ''}`,
        href: 'audit:progress',
      });
      showToast?.('Scan started', 'info');
      setAuditView('progress');
    } catch (err) {
      showToast?.(err.message || 'Ingest failed — opening progress UI', 'error');
      setAuditView('progress');
    }
  }

  return (
    <div
      onClick={(e) => {
        const el = e.target.closest('button, a, [role="button"]');
        if (!el) return;
        const text = (el.textContent || '').trim();
        if (text.includes('Start Codebase Audit') || text.includes('Start Audit')) {
          e.preventDefault();
          startSample('novapay');
        } else if (/PyCrypto|pycrypto/i.test(text)) {
          e.preventDefault();
          startSample('pycrypto');
        } else if (/NovaPay|novapay|Sample/i.test(text)) {
          e.preventDefault();
          startSample('novapay');
        } else if (text.includes('Browse') || text.includes('Upload') || text.includes('Drop')) {
          e.preventDefault();
          showToast?.('Starting NovaPay sample (ZIP picker UI demo)', 'info');
          startSample('novapay');
        } else if (text.includes('Cancel')) {
          e.preventDefault();
          setAuditView('overview');
        } else if (text.includes('Codebase Audit')) {
          e.preventDefault();
          setAuditView('overview');
        } else if (text.includes('GitHub')) {
          e.preventDefault();
          showToast?.('GitHub ingest uses sample fallback', 'info');
          startSample('novapay');
        }
      }}
    >
      <AuditIngestStitch />
    </div>
  );
}
