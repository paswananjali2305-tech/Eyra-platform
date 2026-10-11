import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, getBaseUrl } from '../api/client';
import { useEyra } from '../context/EyraContext';
import { qsa, replaceSubstring, setText } from '../lib/hydrateStitch.js';
import ConfigStitch from './stitch_raw/ConfigPage.jsx';

function hydrateConfig(root, { backendUrl, status, config }) {
  if (!root) return;
  const url = backendUrl || getBaseUrl();

  replaceSubstring(root, 'http://localhost:8000', url);
  replaceSubstring(root, 'localhost:8000/ws/telemetry', `${url.replace(/^https?:\/\//, '')}/api/health`);

  if (config?.project_name) {
    const projectLabels = Array.from(root.querySelectorAll('span, div')).filter((el) =>
      /backend-api|Active Project/i.test(el.textContent || ''),
    );
    for (const el of projectLabels.slice(0, 2)) {
      if ((el.textContent || '').trim() === 'backend-api') setText(el, config.project_name);
    }
  }

  if (status?.groq_model_runtime || status?.groq_model) {
    replaceSubstring(
      root,
      'FastAPI v0.111',
      `Brain ${status.version || ''} · ${status.groq_model_runtime || status.groq_model}`,
    );
  }

  // Prefer existing #api-endpoint if present (legacy); else annotate first URL-like text input.
  let endpoint = root.querySelector('#api-endpoint');
  if (!endpoint) {
    const inputs = qsa(root, 'input[type="text"]');
    endpoint = inputs.find((inp) => /http|localhost|endpoint/i.test(inp.placeholder || inp.value || ''));
    if (endpoint && !endpoint.id) endpoint.id = 'api-endpoint';
  }
  if (endpoint) {
    endpoint.value = url;
    endpoint.placeholder = url;
  }

  if (config?.preferred_language) {
    const langInput = qsa(root, 'input[type="text"]').find((inp) =>
      /py311|node20|language/i.test(inp.placeholder || ''),
    );
    if (langInput) langInput.value = config.preferred_language;
  }
}

export function ConfigPage() {
  const { setBackendUrl, refreshStatus, showToast, setMode, setAuditView, status, backendUrl } =
    useEyra();
  const navigate = useNavigate();
  const [note, setNote] = useState('');
  const hostRef = useRef(null);
  const configRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let config = null;
      try {
        config = await api.config();
        configRef.current = config;
      } catch {
        /* keep stitch defaults */
      }
      if (cancelled) return;
      const root = hostRef.current?.querySelector('.stitch-screen') || hostRef.current;
      hydrateConfig(root, { backendUrl, status, config });
    })();
    return () => {
      cancelled = true;
    };
  }, [backendUrl, status]);

  return (
    <div
      ref={hostRef}
      onClick={async (e) => {
        const el = e.target.closest('button, a');
        if (!el) return;
        const text = (el.textContent || '').trim();
        if (text.includes('Test Connection') || text.includes('Re-ping') || el.id === 'btn-reping') {
          e.preventDefault();
          const input = document.getElementById('api-endpoint');
          const url = input?.value || getBaseUrl();
          setBackendUrl(url);
          try {
            await api.health();
            await refreshStatus();
            setNote(`Connected to ${url}`);
            showToast?.('Brain connected', 'info');
            const root = hostRef.current?.querySelector('.stitch-screen') || hostRef.current;
            hydrateConfig(root, {
              backendUrl: url,
              status,
              config: configRef.current,
            });
          } catch (err) {
            setNote(err.message || String(err));
            showToast?.(err.message || 'Connection failed', 'error');
          }
        } else if (text.includes('Save Changes') || text.includes('Save Configuration') || el.id === 'btn-save') {
          e.preventDefault();
          const input = document.getElementById('api-endpoint');
          if (input?.value) setBackendUrl(input.value);
          try {
            const body = {};
            if (configRef.current?.project_name) body.project_name = configRef.current.project_name;
            const langInput = hostRef.current?.querySelector(
              'input[placeholder*="py311"], input[placeholder*="node20"]',
            );
            if (langInput?.value) body.preferred_language = langInput.value;
            const saved = await api.updateConfig(body);
            configRef.current = saved;
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
