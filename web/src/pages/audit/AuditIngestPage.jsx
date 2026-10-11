import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import { useEyra } from '../../context/EyraContext';
import AuditIngestStitch from '../stitch_raw/audit/AuditIngestPage.jsx';

const MAX_ZIP_BYTES = 50 * 1024 * 1024;

const TAB_ACTIVE =
  'flex items-center gap-space-xs px-space-md py-space-xs rounded-lg bg-primary-container text-on-primary-container font-headline-sm text-headline-sm shadow-sm transition-all';
const TAB_IDLE =
  'flex items-center gap-space-xs px-space-md py-space-xs rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all';

/**
 * Stitch markup calls window.switchTab(...) via inline onclick, but never defines it.
 * Provide a safe implementation so GitHub/Sample tab clicks do not throw / lock the UI.
 */
function installSwitchTab(host, setSource) {
  const apply = (tab) => {
    const next = tab === 'github' || tab === 'samples' || tab === 'upload' ? tab : 'upload';
    setSource(next);

    const buttons = {
      upload: host.querySelector('#tab-btn-upload'),
      github: host.querySelector('#tab-btn-github'),
      samples: host.querySelector('#tab-btn-samples'),
    };
    for (const [key, btn] of Object.entries(buttons)) {
      if (!btn) continue;
      btn.className = key === next ? TAB_ACTIVE : TAB_IDLE;
    }

    if (next === 'github') {
      const remote =
        [...host.querySelectorAll('span, h3, h2')].find((el) =>
          /Remote Ingestion Alternative|GitHub Repository/i.test(el.textContent || ''),
        ) || host.querySelector('#tab-btn-github');
      const input =
        host.querySelector('input[placeholder*="organization/repository"]') ||
        host.querySelector('input[placeholder*="github.com"]');
      if (input) {
        input.removeAttribute('readonly');
        input.classList.remove('cursor-pointer');
        if (!input.value || input.value === 'organization/repository') {
          input.value = '';
          input.placeholder = 'organization/repository';
        }
        try {
          input.focus();
        } catch {
          /* ignore */
        }
      }
      remote?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      return;
    }

    if (next === 'samples') {
      const sample =
        [...host.querySelectorAll('button, h3, span')].find((el) =>
          /NovaPay|PyCrypto|Sample Projects/i.test(el.textContent || ''),
        ) || host.querySelector('#tab-btn-samples');
      sample?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      return;
    }

    const uploadPanel = host.querySelector('#tab-content-upload');
    uploadPanel?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };

  window.switchTab = apply;
  return () => {
    if (window.switchTab === apply) {
      delete window.switchTab;
    }
  };
}

export function AuditIngestPage() {
  const { setAuditView, showToast, adoptScan } = useEyra();
  const fileRef = useRef(null);
  const hostRef = useRef(null);
  const busyRef = useRef(false);
  const [uploadPct, setUploadPct] = useState(null);
  const [source, setSource] = useState('upload');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    return installSwitchTab(host, setSource);
  }, []);

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

  async function withBusy(fn) {
    if (busyRef.current) {
      showToast?.('Ingest already in progress…', 'info');
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      await fn();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function startSample(sampleId) {
    await withBusy(async () => {
      try {
        showToast?.(`Uploading sample ${sampleId}…`, 'info');
        const result = await api.loadSample(sampleId);
        await afterIngest(result, `Sample ${sampleId}`);
      } catch (err) {
        showToast?.(err.message || 'Sample ingest failed', 'error');
      }
    });
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
    await withBusy(async () => {
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
    });
  }

  function readGithubRepoUrl() {
    const host = hostRef.current;
    const input =
      host?.querySelector('input[placeholder*="organization/repository"]') ||
      host?.querySelector('input[placeholder*="github.com"]') ||
      document.querySelector('input[placeholder*="organization/repository"]');
    const raw = (input?.value || '').trim();
    if (!raw || raw === 'organization/repository') {
      return 'https://github.com/example/novapay-demo.git';
    }
    if (/^https?:\/\//i.test(raw)) return raw;
    return `https://github.com/${raw.replace(/^\/+/, '')}`;
  }

  async function startGithubMock() {
    await withBusy(async () => {
      const repoUrl = readGithubRepoUrl();
      try {
        showToast?.(
          'GitHub ingest is mock-only — loading NovaPay sample under that repo name',
          'info',
        );
        const result = await api.uploadGithubMock(repoUrl);
        await afterIngest(result, `GitHub mock · ${result.projectName || 'repo'}`);
      } catch (err) {
        showToast?.(err.message || 'GitHub mock ingest failed', 'error');
      }
    });
  }

  async function startFromPrimaryAction() {
    const pending = fileRef.current?.files?.[0];
    if (source === 'github') {
      await startGithubMock();
      return;
    }
    if (pending) {
      await uploadZipFile(pending);
      return;
    }
    if (source === 'samples') {
      await startSample('novapay');
      return;
    }
    await startSample('novapay');
  }

  return (
    <div
      ref={hostRef}
      onClick={(e) => {
        const el = e.target.closest('button, a, [role="button"]');
        if (!el) return;
        const text = (el.textContent || '').trim();
        const id = el.id || '';

        // Tab buttons: let window.switchTab (inline onclick) handle UI only.
        if (
          id === 'tab-btn-github' ||
          id === 'tab-btn-upload' ||
          id === 'tab-btn-samples' ||
          text === 'GitHub Repository' ||
          text.includes('Upload ZIP Archive') ||
          (text.includes('Sample Projects') && !text.includes('NovaPay'))
        ) {
          // Ensure switchTab runs even if inline handler is stripped in some hosts.
          e.preventDefault();
          const tab = id.includes('github') || text.includes('GitHub')
            ? 'github'
            : id.includes('samples') || text.includes('Sample Projects')
              ? 'samples'
              : 'upload';
          window.switchTab?.(tab);
          if (tab === 'github') {
            showToast?.(
              'Enter org/repo, then Start Codebase Audit (mock GitHub — does not clone remote)',
              'info',
            );
          }
          return;
        }

        if (text.includes('Configure Remote')) {
          e.preventDefault();
          window.switchTab?.('github');
          showToast?.(
            'GitHub tab ready — edit the repo path, then Start Codebase Audit',
            'info',
          );
          return;
        }

        if (text.includes('Start Codebase Audit') || text.includes('Start Audit')) {
          e.preventDefault();
          startFromPrimaryAction();
        } else if (/PyCrypto|pycrypto/i.test(text)) {
          e.preventDefault();
          startSample('pycrypto');
        } else if (/NovaPay|novapay/i.test(text) && /Sample|Demo|Load/i.test(text)) {
          e.preventDefault();
          startSample('novapay');
        } else if (
          text.includes('Browse') ||
          (text.includes('Upload') && !text.includes('Upload ZIP')) ||
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
      {busy ? (
        <div className="fixed bottom-6 left-1/2 z-[90] -translate-x-1/2 rounded bg-surface-container-highest px-space-md py-space-sm font-body-sm text-body-sm text-on-surface shadow-xl">
          Starting ingest…
        </div>
      ) : null}
    </div>
  );
}
