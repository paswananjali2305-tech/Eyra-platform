import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, getBaseUrl } from '../api/client';
import { useEyra } from '../context/EyraContext';
import ConfigStitch from './stitch_raw/ConfigPage.jsx';

export function ConfigPage() {
  const { setBackendUrl, refreshStatus, showToast, setMode, setAuditView } = useEyra();
  const navigate = useNavigate();
  const [note, setNote] = useState('');

  return (
    <div
      onClick={async (e) => {
        const el = e.target.closest('button, a');
        if (!el) return;
        const text = (el.textContent || '').trim();
        if (text.includes('Test Connection')) {
          e.preventDefault();
          const input = document.getElementById('api-endpoint');
          const url = input?.value || getBaseUrl();
          setBackendUrl(url);
          try {
            await api.health();
            await refreshStatus();
            setNote(`Connected to ${url}`);
            showToast?.('Brain connected', 'info');
          } catch (err) {
            setNote(err.message || String(err));
            showToast?.(err.message || 'Connection failed', 'error');
          }
        } else if (text.includes('Save Changes') || text.includes('Save Configuration')) {
          e.preventDefault();
          const input = document.getElementById('api-endpoint');
          if (input?.value) setBackendUrl(input.value);
          try {
            await api.updateConfig({});
            await refreshStatus();
            setNote('Configuration saved.');
            showToast?.('Configuration saved', 'info');
          } catch (err) {
            setNote(err.message || String(err));
            showToast?.(err.message || 'Save failed', 'error');
          }
        } else if (text.includes('Open Workspace') || text.includes('Debugging')) {
          e.preventDefault();
          setMode('runtime');
          navigate('/workspace');
        } else if (text.includes('Audit') || text.includes('Ingest')) {
          e.preventDefault();
          setMode('audit');
          setAuditView('ingest');
        }
      }}
    >
      <ConfigStitch />
      {note ? (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded bg-surface-container-highest px-space-md py-space-sm font-body-sm text-body-sm text-on-surface shadow-xl">
          <span className="material-symbols-outlined text-[16px] text-tertiary">check_circle</span>
          <span>{note}</span>
        </div>
      ) : null}
    </div>
  );
}
