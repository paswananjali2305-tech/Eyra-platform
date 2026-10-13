import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, getBaseUrl } from '../api/client';
import { useEyra } from '../context/EyraContext';
import { useStitchGate } from '../hooks/useStitchGate.js';
import {
  buildConfigProjects,
  hydrateConfigProjects,
  scrollConfigProjects,
  syncConfigProjectArrows,
} from '../lib/configProjects.js';
import { qsa, replaceSubstring, setText } from '../lib/hydrateStitch.js';
import ConfigStitch from './stitch_raw/ConfigPage.jsx';

function brainLabel(status) {
  if (!status) return null;
  const model = status.groq_model_runtime || status.groq_model;
  if (status.version && model) return `Brain ${status.version} · ${model}`;
  if (model) return String(model);
  if (status.version) return `Brain ${status.version}`;
  return null;
}

function normalizeScans(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.scans)) return data.scans;
  return [];
}

function setLlmHealth(root, state, message) {
  const statusEl = root?.querySelector?.('#eyra-groq-status');
  const hintEl = root?.querySelector?.('#eyra-groq-hint');
  const dot = root?.querySelector?.('#eyra-groq-dot');
  const map = {
    ok: {
      text: 'Healthy',
      badge:
        'px-2 py-0.5 rounded font-label-sm text-label-sm bg-tertiary/15 text-tertiary uppercase font-semibold shrink-0',
      dot: 'w-2.5 h-2.5 mt-1.5 rounded-full bg-tertiary shadow-[0_0_8px_rgba(108,249,187,0.7)] shrink-0',
    },
    fail: {
      text: 'Failed',
      badge:
        'px-2 py-0.5 rounded font-label-sm text-label-sm bg-error/15 text-error uppercase font-semibold shrink-0',
      dot: 'w-2.5 h-2.5 mt-1.5 rounded-full bg-error shrink-0',
    },
    checking: {
      text: 'Checking',
      badge:
        'px-2 py-0.5 rounded font-label-sm text-label-sm bg-surface-container-high text-outline uppercase font-semibold shrink-0',
      dot: 'w-2.5 h-2.5 mt-1.5 rounded-full bg-outline animate-pulse shrink-0',
    },
    idle: {
      text: 'Not set',
      badge:
        'px-2 py-0.5 rounded font-label-sm text-label-sm bg-surface-container-high text-outline uppercase font-semibold shrink-0',
      dot: 'w-2.5 h-2.5 mt-1.5 rounded-full bg-outline shrink-0',
    },
  };
  const s = map[state] || map.idle;
  if (statusEl) {
    statusEl.textContent = s.text;
    statusEl.className = s.badge;
  }
  if (dot) dot.className = s.dot;
  if (hintEl && message != null) setText(hintEl, message);
}

function setKeyEditMode(root, editing) {
  const view = root?.querySelector?.('#eyra-key-view');
  const edit = root?.querySelector?.('#eyra-key-edit');
  if (view) view.classList.toggle('hidden', editing);
  if (edit) {
    edit.classList.toggle('hidden', !editing);
    edit.classList.toggle('flex', editing);
  }
  if (editing) {
    const input = root?.querySelector?.('#eyra-groq-api-key');
    if (input) {
      input.value = '';
      input.focus();
    }
  }
}

function setAutoModel(root, modelId, modelLabel) {
  const hidden = root?.querySelector?.('#eyra-groq-model');
  const display = root?.querySelector?.('#eyra-model-display');
  if (hidden) hidden.value = modelId || '';
  if (display) setText(display, modelLabel || modelId || '—');
}

function modelLabelFromConfig(config, modelId) {
  if (!modelId) return '—';
  const list = Array.isArray(config?.llm_models) ? config.llm_models : [];
  const hit = list.find((m) => (m?.id || m) === modelId);
  if (hit?.label) return hit.label;
  if (hit?.tier === 'balanced') return `${modelId} [Best balanced]`;
  if (hit?.tier === 'fast') return `${modelId} [Fast]`;
  if (hit?.tier === 'best') return `${modelId} [Best quality]`;
  return modelId;
}

function hydrateGroqPanel(root, config, status) {
  if (!root) return false;
  const maskedEl = root.querySelector('#eyra-key-masked');
  const modelDisplay = root.querySelector('#eyra-model-display');
  if (!maskedEl || !modelDisplay) return false;

  const configured = Boolean(config?.groq_configured ?? status?.groq_configured);
  const model =
    config?.groq_model_runtime ||
    config?.groq_model ||
    status?.groq_model_runtime ||
    status?.groq_model ||
    '';
  const masked = config?.groq_api_key_masked || '';
  const providerLabel = config?.llm_provider_label || config?.llm_provider || 'LLM';
  const providerEl = root.querySelector('#eyra-llm-provider');
  const label = modelLabelFromConfig(config, model);

  setText(maskedEl, masked || (configured ? 'Configured (masked)' : 'Not configured'));
  setAutoModel(root, model, label);
  setKeyEditMode(root, false);

  if (providerEl) {
    if (config?.llm_provider) providerEl.dataset.provider = config.llm_provider;
    setText(providerEl, `Provider: ${providerLabel}`);
  }

  if (configured && (masked || model)) {
    setLlmHealth(
      root,
      'ok',
      `Active key ${masked || '(saved)'} · ${label}`,
    );
  } else if (configured) {
    setLlmHealth(root, 'ok', 'Key configured');
  } else {
    setLlmHealth(root, 'idle', 'No API key — click Edit to add one');
  }
  return true;
}

/** Retry until stitch LLM nodes exist, then paint saved key + model. */
function paintLlmPanel(root, config, status) {
  if (!root) return false;
  return hydrateGroqPanel(root, config, status);
}

/**
 * Validate key against provider, auto-pick model, optionally persist.
 * @returns {Promise<object|null>}
 */
async function applyLlmKey(root, { persist = true, showToast, refreshStatus } = {}) {
  const input = root?.querySelector?.('#eyra-groq-api-key');
  const key = (input?.value || '').trim();
  if (!key || /•|\*/.test(key) || key.length < 8) {
    setLlmHealth(root, 'fail', 'Enter a valid API key');
    return null;
  }

  setLlmHealth(root, 'checking', 'Verifying API key…');
  try {
    const data = await api.llmModels({ api_key: key });
    const providerEl = root.querySelector('#eyra-llm-provider');
    if (providerEl) {
      providerEl.dataset.provider = data?.provider || '';
      setText(
        providerEl,
        `Provider: ${data?.provider_label || data?.provider || 'LLM'}`,
      );
    }

    if (!data?.ok) {
      setLlmHealth(root, 'fail', data?.error || 'API key failed');
      setAutoModel(root, '', '—');
      showToast?.(data?.error || 'API key failed', 'error');
      return data;
    }

    const modelId = data.selected_model || data.models?.[0]?.id || '';
    const modelLabel = data.selected_label || modelId;
    setAutoModel(root, modelId, modelLabel);
    setLlmHealth(root, 'ok', data.hint || `Key OK · ${modelLabel}`);

    if (persist) {
      const body = {
        groq_api_key: key,
        groq_model: modelId,
        groq_model_runtime: modelId,
        llm_provider: data.provider,
      };
      const saved = await api.updateConfig(body);
      if (refreshStatus) await refreshStatus();
      const maskedEl = root.querySelector('#eyra-key-masked');
      if (maskedEl) setText(maskedEl, saved?.groq_api_key_masked || 'Configured');
      setKeyEditMode(root, false);
      if (input) input.value = '';
      showToast?.('LLM key verified & saved', 'info');
      return { ...data, saved };
    }
    return data;
  } catch (err) {
    setLlmHealth(root, 'fail', err.message || 'API key failed');
    setAutoModel(root, '', '—');
    showToast?.(err.message || 'API key failed', 'error');
    return null;
  }
}

function readGroqForm(root) {
  const input = root?.querySelector?.('#eyra-groq-api-key');
  const modelHidden = root?.querySelector?.('#eyra-groq-model');
  const rawKey = (input?.value || '').trim();
  const body = {};
  // Only send key when edit panel is open and a new key was typed
  const editing = !root?.querySelector?.('#eyra-key-edit')?.classList?.contains('hidden');
  if (editing && rawKey && !/•|\*/.test(rawKey)) {
    body.groq_api_key = rawKey;
  }
  if (modelHidden?.value) {
    body.groq_model = modelHidden.value;
    body.groq_model_runtime = modelHidden.value;
  }
  const provider = root?.querySelector?.('#eyra-llm-provider')?.dataset?.provider;
  if (provider) body.llm_provider = provider;
  return body;
}

const ENGINE_KEYS = ['ast', 'security', 'todos', 'deps'];

const ENGINE_CONFIG_FIELD = {
  ast: 'engine_ast',
  security: 'engine_security',
  todos: 'engine_todos',
  deps: 'engine_deps',
};

const BADGE_ON =
  'px-1.5 py-0.5 rounded font-label-sm text-label-sm bg-tertiary/15 text-tertiary';
const BADGE_OFF =
  'px-1.5 py-0.5 rounded font-label-sm text-label-sm bg-surface-container-highest text-outline';

function setEngineBadge(badge, enabled) {
  if (!badge) return;
  badge.textContent = enabled ? 'ENABLED' : 'DISABLED';
  badge.className = enabled ? BADGE_ON : BADGE_OFF;
}

function readEngineForm(root) {
  const out = {};
  for (const key of ENGINE_KEYS) {
    const box = root?.querySelector?.(`#eyra-engine-${key}, [data-eyra-engine="${key}"]`);
    out[ENGINE_CONFIG_FIELD[key]] = box ? Boolean(box.checked) : true;
  }
  return out;
}

function hydrateEngineToggles(root, config) {
  if (!root || !config) return false;
  let found = false;
  for (const key of ENGINE_KEYS) {
    const field = ENGINE_CONFIG_FIELD[key];
    const enabled = config[field] !== false;
    const box = root.querySelector(`#eyra-engine-${key}`) || root.querySelector(`[data-eyra-engine="${key}"]`);
    const badge =
      root.querySelector(`[data-eyra-engine-badge="${key}"]`) ||
      box?.closest?.('.p-space-md')?.querySelector?.('[data-eyra-engine-badge], span.px-1\\.5');
    if (box) {
      box.checked = enabled;
      found = true;
    }
    if (badge) setEngineBadge(badge, enabled);
  }
  return found;
}

function bindEngineToggleSync(root, { onPersist } = {}) {
  if (!root || root.dataset.eyraEngineBound === '1') return;
  root.dataset.eyraEngineBound = '1';
  root.addEventListener('change', (e) => {
    const box = e.target?.closest?.('[data-eyra-engine]');
    if (!box || box.type !== 'checkbox') return;
    const key = box.getAttribute('data-eyra-engine');
    const badge = root.querySelector(`[data-eyra-engine-badge="${key}"]`);
    setEngineBadge(badge, Boolean(box.checked));
    onPersist?.(readEngineForm(root));
  });
}

/** Keep Static Engine cards visible but clearly audit-only (shared Config page). */
function annotateStaticEngineSection(root) {
  if (!root || root.dataset.eyraEngineAnnotated === '1') return;
  const heading = Array.from(root.querySelectorAll('h2, h3, span')).find((el) =>
    /Codebase Audit Configuration/i.test(el.textContent || ''),
  );
  if (heading) {
    setText(heading, 'Codebase Audit Configuration (audit scans only)');
    root.dataset.eyraEngineAnnotated = '1';
  }
  const blurb = Array.from(root.querySelectorAll('p')).find((el) =>
    /Manage project workspaces/i.test(el.textContent || ''),
  );
  if (blurb && !/shared across/i.test(blurb.textContent || '')) {
    setText(
      blurb,
      'Shared across Runtime Debugging and Codebase Audit — LLM, privacy, and projects. Static engine toggles apply to audit scans only.',
    );
  }
}

function hydrateConfig(root, { backendUrl, status, config }) {
  if (!root) return;
  const url = backendUrl || getBaseUrl();

  annotateStaticEngineSection(root);
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

  hydrateGroqPanel(root, config, status);
  hydrateEngineToggles(root, config);

  const addBtn = root.querySelector('#open-add-project-modal');
  if (addBtn) {
    addBtn.setAttribute('data-action', 'add-project');
  }
}

function paintProjects(root, projects, opts = {}) {
  if (!root) return false;
  hydrateConfigProjects(root, projects, opts);
  const heading = Array.from(root.querySelectorAll('span')).find((el) =>
    /Active Projects/i.test(el.textContent || ''),
  );
  if (heading) {
    if (opts.offline) setText(heading, 'Active Projects & Repositories (offline)');
    else if (opts.loading) setText(heading, 'Active Projects & Repositories…');
    else {
      setText(
        heading,
        projects?.length
          ? `Active Projects & Repositories (${projects.length}) · Runtime + Audit`
          : 'Active Projects & Repositories · Runtime + Audit',
      );
    }
  }
  syncConfigProjectArrows(root);
  const state = opts.offline ? 'offline' : opts.loading ? 'loading' : 'live';
  return Boolean(root.querySelector(`#eyra-config-projects[data-eyra-projects="${state}"]`));
}

/** Wipe stitch demo cards/labels immediately so offline never flashes mock projects. */
function stripConfigStitchMocks(root, { offline = false } = {}) {
  if (!root) return;
  paintProjects(root, [], offline ? { offline: true } : { loading: true });
  for (const key of ENGINE_KEYS) {
    const badge = root.querySelector(`[data-eyra-engine-badge="${key}"]`);
    if (badge) setEngineBadge(badge, false);
    const box = root.querySelector(`#eyra-engine-${key}, [data-eyra-engine="${key}"]`);
    if (box) box.checked = false;
  }
  replaceSubstring(root, 'backend-api', '—');
  replaceSubstring(root, '342', '—');
}

export function ConfigPage() {
  const {
    setBackendUrl,
    refreshStatus,
    showToast,
    setMode,
    setAuditView,
    status,
    backendUrl,
    activeScan,
    activeScanId,
    adoptScan,
    refreshScanList,
  } = useEyra();
  // Shared Config for Runtime + Audit: same LLM/privacy/projects list (not mode-sliced).
  const projectScope = 'all';
  const navigate = useNavigate();
  const [note, setNote] = useState('');
  const [projects, setProjects] = useState(null);
  const [projectsMeta, setProjectsMeta] = useState({ loading: true, offline: false });
  const [llmConfig, setLlmConfig] = useState(null);
  const hostRef = useRef(null);
  const configRef = useRef(null);
  const scrubIdle = useCallback((root) => {
    stripConfigStitchMocks(root, { offline: false });
  }, []);
  const { reveal, hold, gateClassName, gateProps } = useStitchGate(hostRef, {
    scrub: scrubIdle,
  });

  // Load real scans + history once per backend / active scan change (do NOT depend on scanList —
  // refreshScanList() would re-trigger and cancel paint forever).
  useEffect(() => {
    let cancelled = false;
    hold();
    setProjectsMeta({ loading: true, offline: false });
    (async () => {
      let config = null;
      let sessions = [];
      let scans = [];
      let brainReachable = false;
      let scansFailed = false;
      let sessionsFailed = false;
      try {
        config = await api.config();
        brainReachable = true;
        if (!cancelled) {
          configRef.current = config;
          setLlmConfig(config);
        }
      } catch {
        /* Brain down — do not keep stitch mock config */
      }
      // Always merge ZIP/GitHub audits + Brain debug sessions into one project list.
      try {
        const hist = await api.history({ limit: 80 });
        sessions = hist?.items || hist?.sessions || [];
      } catch {
        sessionsFailed = true;
        sessions = [];
      }
      try {
        const data = await api.listScans();
        scans = normalizeScans(data);
        if (!cancelled) refreshScanList?.();
      } catch {
        scansFailed = true;
        scans = [];
      }
      if (cancelled) return;

      const listFailed = scansFailed && sessionsFailed;
      const isOffline = !brainReachable && listFailed;

      const next = isOffline
        ? []
        : buildConfigProjects(scans, sessions, {
            activeScanId: activeScanId || activeScan?.id,
            brainLabel: brainLabel(status),
            scope: 'all',
          });
      setProjects(next);
      setProjectsMeta({ loading: false, offline: isOffline });

      try {
        const root = hostRef.current?.querySelector('.stitch-screen') || hostRef.current;
        if (isOffline) {
          stripConfigStitchMocks(root, { offline: true });
          setNote('Brain offline — mock / demo data is hidden.');
          return;
        }
        const merged = {
          ...config,
          project_name: activeScan?.projectName || config?.project_name || undefined,
          preferred_language:
            activeScan?.meta?.primaryLanguage || config?.preferred_language || undefined,
        };
        hydrateConfig(root, { backendUrl, status, config: merged });
        if (activeScan?.meta?.totalFilesCount != null) {
          replaceSubstring(root, '342', String(activeScan.meta.totalFilesCount));
        }
      } finally {
        if (!cancelled) reveal();
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: avoid scanList feedback loop
  }, [
    backendUrl,
    activeScanId,
    activeScan?.id,
    activeScan?.projectName,
    status?.version,
    status?.groq_model,
    projectScope,
    hold,
    reveal,
  ]);

  // Paint cards whenever projects arrive; retry until stitch mount exists.
  useEffect(() => {
    if (projects === null) return undefined;
    let tries = 0;
    let timer = 0;
    const rootOf = () => hostRef.current?.querySelector('.stitch-screen') || hostRef.current;
    const tick = () => {
      const ok = paintProjects(rootOf(), projects, {
        offline: projectsMeta.offline,
        loading: projectsMeta.loading,
      });
      if (ok || tries >= 40) return;
      tries += 1;
      timer = window.setTimeout(tick, 50);
    };
    tick();
    const onResize = () => syncConfigProjectArrows(rootOf());
    window.addEventListener('resize', onResize);
    return () => {
      if (timer) window.clearTimeout(timer);
      window.removeEventListener('resize', onResize);
    };
  }, [projects, projectsMeta.offline, projectsMeta.loading]);

  // Always show the currently saved API key (masked) + its model once stitch is mounted.
  useEffect(() => {
    if (!llmConfig) return undefined;
    let tries = 0;
    let timer = 0;
    const rootOf = () => hostRef.current?.querySelector('.stitch-screen') || hostRef.current;
    const tick = () => {
      const ok = paintLlmPanel(rootOf(), llmConfig, status);
      if (ok || tries >= 40) return;
      tries += 1;
      timer = window.setTimeout(tick, 50);
    };
    tick();
    return () => {
      if (timer) window.clearTimeout(timer);
    };
  }, [llmConfig, status?.groq_configured, status?.groq_model]);

  // Sync engine ENABLED/DISABLED badges from saved config; persist toggles immediately.
  useEffect(() => {
    if (!llmConfig) return undefined;
    let tries = 0;
    let timer = 0;
    const rootOf = () => hostRef.current?.querySelector('.stitch-screen') || hostRef.current;
    const tick = () => {
      const root = rootOf();
      const ok = hydrateEngineToggles(root, llmConfig);
      if (ok) {
        bindEngineToggleSync(root, {
          onPersist: async (engines) => {
            try {
              const saved = await api.updateConfig(engines);
              configRef.current = saved;
              setLlmConfig(saved);
              hydrateEngineToggles(root, saved);
            } catch (err) {
              showToast?.(err.message || 'Failed to save engine toggles', 'error');
            }
          },
        });
        return;
      }
      if (tries >= 40) return;
      tries += 1;
      timer = window.setTimeout(tick, 50);
    };
    tick();
    return () => {
      if (timer) window.clearTimeout(timer);
    };
  }, [llmConfig, showToast]);

  return (
    <div
      ref={hostRef}
      className={gateClassName}
      {...gateProps}
      onClick={async (e) => {
        const el = e.target.closest('button, a');
        if (!el) return;
        const text = (el.textContent || '').trim();
        const action = el.getAttribute('data-action');
        const scanId =
          el.getAttribute('data-scan-id') ||
          el.closest('[data-scan-id]')?.getAttribute('data-scan-id');

        if (action === 'scroll-projects-right' || action === 'scroll-projects-left') {
          e.preventDefault();
          e.stopPropagation();
          scrollConfigProjects(
            hostRef.current,
            action === 'scroll-projects-right' ? 1 : -1,
          );
          return;
        }

        if (action === 'add-project' || el.id === 'open-add-project-modal' || text.includes('Add New Project')) {
          e.preventDefault();
          setMode('audit');
          setAuditView('ingest');
          return;
        }

        if (action === 'open-audit' && scanId) {
          e.preventDefault();
          adoptScan(scanId);
          setMode('audit');
          try {
            const data = await api.getScan(scanId);
            const scan = data?.scan || data;
            if (scan) adoptScan(scan);
            const st = String(scan?.status || '').toLowerCase();
            setAuditView(st === 'completed' ? 'code' : 'progress');
          } catch {
            setAuditView('progress');
          }
          return;
        }

        if (action === 'open-runtime') {
          e.preventDefault();
          setMode('runtime');
          navigate('/workspace');
          return;
        }

        if (action === 'configure') {
          e.preventDefault();
          const target = Array.from(hostRef.current?.querySelectorAll('h2, span') || []).find((n) =>
            /Codebase Audit|Static Engine|API Endpoint|Brain/i.test(n.textContent || ''),
          );
          target?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
          return;
        }

        if (
          action === 'edit-llm-key' ||
          el.id === 'btn-edit-llm-key' ||
          (text === 'Edit' && el.closest('#eyra-llm-section'))
        ) {
          e.preventDefault();
          const root = hostRef.current?.querySelector('.stitch-screen') || hostRef.current;
          setKeyEditMode(root, true);
          return;
        }

        if (action === 'cancel-llm-key' || el.id === 'btn-cancel-llm-key') {
          e.preventDefault();
          const root = hostRef.current?.querySelector('.stitch-screen') || hostRef.current;
          setKeyEditMode(root, false);
          return;
        }

        if (
          action === 'apply-llm-key' ||
          el.id === 'btn-apply-llm-key' ||
          text.includes('Apply key')
        ) {
          e.preventDefault();
          const root = hostRef.current?.querySelector('.stitch-screen') || hostRef.current;
          const result = await applyLlmKey(root, {
            persist: true,
            showToast,
            refreshStatus,
          });
          if (result?.saved) {
            configRef.current = result.saved;
            setLlmConfig(result.saved);
            hydrateGroqPanel(root, result.saved, status);
            setNote(
              `Saved ${result.saved.groq_api_key_masked || 'key'} · ${result.selected_label || result.saved.groq_model}`,
            );
          } else if (result && result.ok === false) {
            setNote(result.error || 'API key failed');
          }
          return;
        }

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
            if (projects) paintProjects(root, projects);
          } catch (err) {
            setNote(err.message || String(err));
            showToast?.(err.message || 'Connection failed', 'error');
          }
        } else if (text.includes('Save Changes') || text.includes('Save Configuration') || el.id === 'btn-save') {
          e.preventDefault();
          const input = document.getElementById('api-endpoint');
          if (input?.value) setBackendUrl(input.value);
          try {
            const root = hostRef.current?.querySelector('.stitch-screen') || hostRef.current;
            // If user is mid-edit on LLM key, validate+save that first.
            const editing = !root?.querySelector?.('#eyra-key-edit')?.classList?.contains('hidden');
            if (editing) {
              const typed = (root?.querySelector?.('#eyra-groq-api-key')?.value || '').trim();
              if (typed) {
                const result = await applyLlmKey(root, {
                  persist: true,
                  showToast,
                  refreshStatus,
                });
                if (result?.saved) configRef.current = result.saved;
                if (result && result.ok === false) {
                  setNote(result.error || 'API key failed');
                  return;
                }
              }
            }
            const body = { ...readGroqForm(root), ...readEngineForm(root) };
            if (configRef.current?.project_name) body.project_name = configRef.current.project_name;
            const langInput = hostRef.current?.querySelector(
              'input[placeholder*="py311"], input[placeholder*="node20"]',
            );
            if (langInput?.value) body.preferred_language = langInput.value;
            // Avoid blanking LLM when not editing key
            delete body.groq_api_key;
            const saved = await api.updateConfig(body);
            configRef.current = saved;
            setLlmConfig(saved);
            await refreshStatus();
            hydrateGroqPanel(root, saved, status);
            hydrateEngineToggles(root, saved);
            setNote('Configuration saved.');
            showToast?.('Configuration saved', 'info');
          } catch (err) {
            setNote(err.message || String(err));
            showToast?.(err.message || 'Save failed', 'error');
          }
        } else if (text.includes('Open Workspace') || text.includes('Open Progress') || text.includes('Open Debugging')) {
          e.preventDefault();
          if (scanId) {
            adoptScan(scanId);
            setMode('audit');
            try {
              const data = await api.getScan(scanId);
              const scan = data?.scan || data;
              if (scan) adoptScan(scan);
              const st = String(scan?.status || '').toLowerCase();
              setAuditView(st === 'completed' ? 'code' : 'progress');
            } catch {
              setAuditView('progress');
            }
          } else {
            setMode('runtime');
            navigate('/workspace');
          }
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
