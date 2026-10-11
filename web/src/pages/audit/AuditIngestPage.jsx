import { useRef, useState } from 'react';
import { api } from '../../api/client';
import { useEyra } from '../../context/EyraContext';
import AuditIngestStitch from '../stitch_raw/audit/AuditIngestPage.jsx';

const MAX_ZIP_BYTES = 50 * 1024 * 1024;

export function AuditIngestPage() {
  const { setAuditView, showToast, adoptScan } = useEyra();
  const fileRef = useRef(null);
  const [uploadPct, setUploadPct] = useState(null);

  async function afterIngest(result, label) {
    const scanId = result?.scanId || result?.scan?.id;
    if (!scanId) {
      throw new Error('Upload succeeded but no scanId was returned');
    }
    adoptScan({
      id: scanId,
      projectName: result.projectName || label,
      status: 'pending',
      progress: 0,
      currentStage: 'Queued',
      meta: result.meta,
    });
    await api.startScan(scanId);
    adoptScan(
      {
        id: scanId,
        projectName: result.projectName || label,
        status: 'analyzing',
        progress: 0,
        currentStage: 'Scan processing started',
        meta: result.meta,
      },
      { notify: true, title: 'Audit started' },
    );
    showToast?.(`Scan started · ${scanId.slice(0, 8)}…`, 'info');
    setAuditView('progress');
  }

  async function startSample(sampleId) {
    try {
      showToast?.(`Uploading sample ${sampleId}…`, 'info');
      const result = await api.loadSample(sampleId);
      await afterIngest(result, `Sample ${sampleId}`);
    } catch (err) {
      showToast?.(err.message || 'Sample ingest failed', 'error');
    }
  }

  async function uploadZipFile(file) {
    if (!file) return;
    if (!/\.zip$/i.test(file.name || '')) {
      showToast?.('Only .zip archives are supported (max 50 MB)', 'error');
      return;
    }
    if (file.size > MAX_ZIP_BYTES) {
      showToast?.('ZIP exceeds 50 MB backend limit', 'error');
      return;
    }
    try {
      setUploadPct(0);
      showToast?.(`Uploading ${file.name}…`, 'info');
      const result = await api.uploadZip(file, {
        onProgress: (pct) => setUploadPct(pct),
      });
      setUploadPct(null);
      await afterIngest(result, file.name.replace(/\.zip$/i, ''));
    } catch (err) {
      setUploadPct(null);
      showToast?.(err.message || 'ZIP upload failed', 'error');
    }
  }

  async function startGithubMock() {
    const input =
      document.querySelector('input[placeholder*="github.com"]') ||
      document.querySelector('input[placeholder*="organization/repository"]');
    const repoUrl = (input?.value || '').trim() || 'https://github.com/example/novapay-demo.git';
    try {
      showToast?.(
        'GitHub ingest is mock-only on the audit engine — loading NovaPay sample under that name',
        'info',
      );
      const result = await api.uploadGithubMock(repoUrl);
      await afterIngest(result, `GitHub mock · ${result.projectName || 'repo'}`);
    } catch (err) {
      showToast?.(err.message || 'GitHub mock ingest failed', 'error');
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
          const pending = fileRef.current?.files?.[0];
          if (pending) {
            uploadZipFile(pending);
          } else {
            startSample('novapay');
          }
        } else if (/PyCrypto|pycrypto/i.test(text)) {
          e.preventDefault();
          startSample('pycrypto');
        } else if (/NovaPay|novapay/i.test(text) && text.includes('Sample')) {
          e.preventDefault();
          startSample('novapay');
        } else if (
          text.includes('Browse') ||
          text.includes('Upload') ||
          text.includes('Drop') ||
          text.includes('Choose')
        ) {
          e.preventDefault();
          fileRef.current?.click();
        } else if (text.includes('Cancel')) {
          e.preventDefault();
          setAuditView('overview');
        } else if (text.includes('Codebase Audit') && !text.includes('Start')) {
          e.preventDefault();
          setAuditView('overview');
        } else if (text.includes('GitHub') || text.includes('Clone')) {
          e.preventDefault();
          startGithubMock();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer?.files?.[0];
        if (file) uploadZipFile(file);
      }}
    >
      <input
        ref={fileRef}
        type="file"
        accept=".zip,application/zip"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) uploadZipFile(file);
          e.target.value = '';
        }}
      />
      <AuditIngestStitch />
      {uploadPct != null ? (
        <div className="fixed bottom-6 right-6 z-[90] rounded bg-surface-container-highest px-space-md py-space-sm font-body-sm text-body-sm text-on-surface shadow-xl">
          Uploading ZIP… {uploadPct}%
        </div>
      ) : null}
    </div>
  );
}
