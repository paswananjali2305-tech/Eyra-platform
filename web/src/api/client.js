/**
 * Typed EYRA Brain API client (JSDoc types).
 * Base URL is configurable; secrets never live here.
 */

import { inflightEpoch, isStaleEpoch } from '../lib/userSessionState';

/** @typedef {'needs_review'|'hypothesis'|'verified'|'unverified'|'failed'} SessionStatus */

/**
 * @typedef {Object} AnalyzeRequest
 * @property {string} file_name
 * @property {string} [language]
 * @property {string} code_snippet
 * @property {string} [terminal_output]
 * @property {string} [stack_trace]
 * @property {string} [error_type]
 * @property {string} [project_name]
 */

/**
 * @typedef {Object} AnalyzeResponse
 * @property {string} session_id
 * @property {SessionStatus} status
 * @property {string} error_type
 * @property {string} error_summary
 * @property {string} root_cause
 * @property {string} explanation
 * @property {Array<{kind:string,detail:string,location?:string}>} evidence
 * @property {Array<{step:string,detail:string,status:string}>} execution_timeline
 * @property {{summary:string,corrected_code:string,diff_unified?:string,apply_mode:string}} suggested_correction
 * @property {{status:string,method:string,detail:string,is_hypothesis_only:boolean}} verification
 * @property {string[]} related_session_ids
 * @property {'groq'|'local_heuristic'} reasoning_source
 * @property {string} reasoning_note
 * @property {string} file_name
 * @property {string} language
 * @property {string} code_snippet
 * @property {string} terminal_output
 * @property {string} stack_trace
 * @property {string} project_name
 * @property {string} created_at
 * @property {number|null} [confidence]
 */

const STORAGE_KEY = 'eyra.backendBaseUrl';
const TOKEN_KEY = 'eyra.authToken';
const DEFAULT_BASE = import.meta.env.VITE_EYRA_API_BASE || 'http://127.0.0.1:8000';
const DEFAULT_TIMEOUT_MS = 60_000;

export function getAuthToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function setAuthToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, String(token));
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export function clearAuthToken() {
  setAuthToken('');
}

export function getBaseUrl() {
  try {
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_BASE;
  } catch {
    return DEFAULT_BASE;
  }
}

export function setBaseUrl(url) {
  const cleaned = String(url || '').trim().replace(/\/$/, '');
  localStorage.setItem(STORAGE_KEY, cleaned || DEFAULT_BASE);
}

export class ApiError extends Error {
  /**
   * @param {string} message
   * @param {number} [status]
   * @param {unknown} [body]
   */
  constructor(message, status, body) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/**
 * @param {string} path
 * @param {RequestInit & { timeoutMs?: number }} [options]
 */
async function request(path, options = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, auth = true, ...init } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const url = `${getBaseUrl()}${path}`;
  const token = auth ? getAuthToken() : '';
  const started = inflightEpoch();

  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers || {}),
      },
    });

    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      if (data && typeof data === 'object') {
        if ('detail' in data) {
          detail =
            typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail);
        } else if (typeof data.error === 'string' && data.error.trim()) {
          // Eyraaaa audit engine uses { error: "..." }
          detail = data.error;
        } else if (typeof data.message === 'string' && data.message.trim()) {
          detail = data.message;
        }
      }
      throw new ApiError(detail, res.status, data);
    }

    if (isStaleEpoch(started)) {
      throw new ApiError('Request discarded because the signed-in user changed.', 401);
    }
    return data;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err?.name === 'AbortError') {
      throw new ApiError('Request timed out talking to EYRA Brain.', 408);
    }
    throw new ApiError(
      `Backend unreachable at ${getBaseUrl()}. Is FastAPI running? (${err.message || err})`,
      0,
    );
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  /** @returns {Promise<{status:string,service:string,version:string}>} */
  health() {
    return request('/api/health', { timeoutMs: 5000, auth: false });
  },

  status() {
    return request('/api/status', { timeoutMs: 8000 });
  },

  /**
   * @param {{email:string,username:string,password:string,display_name?:string}} body
   * @returns {Promise<{access_token:string,token_type:string,user:object}>}
   */
  register(body) {
    return request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(body),
      timeoutMs: 20_000,
      auth: false,
    });
  },

  /**
   * @param {{login:string,password:string}} body
   * @returns {Promise<{access_token:string,token_type:string,user:object}>}
   */
  login(body) {
    return request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(body),
      timeoutMs: 20_000,
      auth: false,
    });
  },

  /** @returns {Promise<{id:string,email:string,username:string,display_name:string}>} */
  me() {
    return request('/api/auth/me', { timeoutMs: 10_000 });
  },

  /** One-time code for the signed-in user. The caller must not store it. */
  extensionConnectCode() {
    return request('/api/auth/extension/code', { method: 'POST', timeoutMs: 20_000 });
  },

  /** Local VSIX install + open in VS Code (unpublished extension; no Marketplace). */
  extensionStatus(editor = 'vscode') {
    const qs = new URLSearchParams({ editor: String(editor || 'vscode') });
    return request(`/api/extension/status?${qs}`, { timeoutMs: 10_000, auth: false });
  },

  /**
   * @param {{ editor?: 'auto' | 'cursor' | 'vscode' }} [body]
   */
  openExtension(body = {}) {
    return request('/api/extension/open', {
      method: 'POST',
      body: JSON.stringify({ editor: body.editor || 'vscode' }),
      timeoutMs: 300_000,
      auth: false,
    });
  },

  /**
   * @param {AnalyzeRequest} body
   * @returns {Promise<AnalyzeResponse>}
   */
  analyze(body) {
    return request('/api/analyze', {
      method: 'POST',
      body: JSON.stringify(body),
      timeoutMs: 90_000,
    });
  },

  /**
   * @param {{q?:string,status?:string,language?:string,limit?:number,offset?:number}} [params]
   */
  history(params = {}) {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    });
    const suffix = qs.toString() ? `?${qs}` : '';
    return request(`/api/history${suffix}`);
  },

  /** @param {string} sessionId */
  historyDetail(sessionId) {
    return request(`/api/history/${encodeURIComponent(sessionId)}`);
  },

  /**
   * @param {{q?:string,limit?:number,offset?:number}} [params]
   */
  memory(params = {}) {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    });
    const suffix = qs.toString() ? `?${qs}` : '';
    return request(`/api/memory${suffix}`);
  },

  config() {
    return request('/api/config');
  },

  /** @param {Record<string, unknown>} body */
  updateConfig(body) {
    return request('/api/config', {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  },

  /**
   * Detect LLM provider from API key and return tagged model list.
   * @param {{ api_key?: string, provider?: string }} [body]
   */
  llmModels(body = {}) {
    return request('/api/config/llm-models', {
      method: 'POST',
      body: JSON.stringify(body),
      timeoutMs: 20_000,
    });
  },

  auditHealth() {
    return request('/api/audit/health', { timeoutMs: 5000 });
  },

  /** @deprecated Samples removed — use uploadZip or uploadGithub. */
  loadSample() {
    return Promise.reject(
      new ApiError(
        'Built-in samples were removed. Upload a ZIP or Configure & Index a public GitHub repo.',
        410,
      ),
    );
  },

  /**
   * Real ZIP upload — multipart field name must be `codebase` (Eyraaaa multer).
   * Max 50MB; .zip only. Do not set Content-Type (browser sets boundary).
   * @param {File} file
   * @param {{onProgress?:(pct:number)=>void}} [opts]
   */
  uploadZip(file, opts = {}) {
    const MAX = 50 * 1024 * 1024;
    if (!file) return Promise.reject(new ApiError('No file selected', 400));
    if (!/\.zip$/i.test(file.name || '')) {
      return Promise.reject(
        new ApiError('Invalid archive: only .zip files are accepted (Eyraaaa upload filter)', 400),
      );
    }
    if (file.size > MAX) {
      return Promise.reject(
        new ApiError('ZIP exceeds 50 MB backend limit — choose a smaller archive', 400),
      );
    }
    if (file.size === 0) {
      return Promise.reject(new ApiError('ZIP file is empty', 400));
    }

    const form = new FormData();
    form.append('codebase', file, file.name);

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const started = inflightEpoch();
      const url = `${getBaseUrl()}/api/audit/upload`;
      xhr.open('POST', url);
      const token = getAuthToken();
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.timeout = 120_000;
      xhr.responseType = 'text';
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable && opts.onProgress) {
          opts.onProgress(Math.round((ev.loaded / ev.total) * 100));
        }
      };
      xhr.onload = () => {
        if (isStaleEpoch(started)) {
          reject(new ApiError('Request discarded because the signed-in user changed.', 401));
          return;
        }
        let data = null;
        try {
          data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
        } catch {
          data = xhr.responseText;
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(data);
          return;
        }
        const detail =
          typeof data === 'object' && data
            ? data.error || data.detail || JSON.stringify(data)
            : `HTTP ${xhr.status}`;
        reject(new ApiError(String(detail), xhr.status, data));
      };
      xhr.onerror = () =>
        reject(new ApiError(`Upload failed — is Brain/Eyraaaa running at ${getBaseUrl()}?`, 0));
      xhr.ontimeout = () => reject(new ApiError('Upload timed out', 408));
      xhr.send(form);
    });
  },

  /**
   * Shallow-clone a public GitHub repo via Eyraaaa (requires git on the audit engine host).
   * @param {string} repoUrl
   * @param {{ branch?: string }} [opts]
   */
  uploadGithub(repoUrl, opts = {}) {
    return request('/api/audit/upload', {
      method: 'POST',
      body: JSON.stringify({
        repoUrl,
        ...(opts.branch ? { branch: opts.branch } : {}),
      }),
      timeoutMs: 180_000,
    });
  },

  /** @deprecated use uploadGithub — kept for older call sites */
  uploadGithubMock(repoUrl, opts = {}) {
    return this.uploadGithub(repoUrl, opts);
  },

  /**
   * List branches for a public GitHub repo (GitHub REST API, browser-side).
   * @param {string} owner
   * @param {string} repo
   * @returns {Promise<{ branches: string[], defaultBranch: string|null }>}
   */
  async listGithubBranches(owner, repo) {
    const o = encodeURIComponent(owner);
    const r = encodeURIComponent(repo.replace(/\.git$/i, ''));
    const headers = { Accept: 'application/vnd.github+json' };

    let defaultBranch = null;
    try {
      const metaRes = await fetch(`https://api.github.com/repos/${o}/${r}`, { headers });
      if (metaRes.ok) {
        const meta = await metaRes.json();
        defaultBranch = meta?.default_branch || null;
      } else if (metaRes.status === 404) {
        throw new ApiError('Repository not found (is it public?)', 404);
      } else if (metaRes.status === 403) {
        throw new ApiError('GitHub rate limit — try again shortly', 403);
      }
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(err?.message || 'Failed to reach GitHub', 0);
    }

    const branches = [];
    for (let page = 1; page <= 5; page += 1) {
      const res = await fetch(
        `https://api.github.com/repos/${o}/${r}/branches?per_page=100&page=${page}`,
        { headers },
      );
      if (!res.ok) {
        if (res.status === 404) throw new ApiError('Repository not found (is it public?)', 404);
        if (res.status === 403) throw new ApiError('GitHub rate limit — try again shortly', 403);
        throw new ApiError(`GitHub branches failed (${res.status})`, res.status);
      }
      const batch = await res.json();
      if (!Array.isArray(batch) || batch.length === 0) break;
      for (const b of batch) {
        if (b?.name) branches.push(String(b.name));
      }
      if (batch.length < 100) break;
    }

    if (!defaultBranch && branches.length) {
      defaultBranch = branches.includes('main')
        ? 'main'
        : branches.includes('master')
          ? 'master'
          : branches[0];
    }

    return { branches, defaultBranch };
  },

  /**
   * @param {string} scanId
   * @param {{ engines?: { ast?: boolean, cve?: boolean, partials?: boolean, ai?: boolean, offline?: boolean } }} [opts]
   */
  startScan(scanId, opts = {}) {
    return request(`/api/audit/scan/${encodeURIComponent(scanId)}/start`, {
      method: 'POST',
      body: JSON.stringify({
        engines: opts.engines || {},
      }),
    });
  },

  /** Stop an in-flight or pending scan; stays cancelled until restarted. */
  cancelScan(scanId) {
    return request(`/api/audit/scan/${encodeURIComponent(scanId)}/cancel`, {
      method: 'POST',
      body: JSON.stringify({}),
      timeoutMs: 15_000,
    });
  },

  getScan(scanId) {
    // Keep restore snappy — Eyraaaa 503/down must not block Code Audit for 60s.
    return request(`/api/audit/scan/${encodeURIComponent(scanId)}`, {
      timeoutMs: 12_000,
    });
  },

  listScans() {
    return request('/api/audit/scans', { timeoutMs: 15_000 });
  },

  /** Wipe persisted audit scans (History Clear Stale Cache). */
  clearScans() {
    return request('/api/audit/scans', {
      method: 'DELETE',
      timeoutMs: 15_000,
    });
  },

  /** Wipe Brain investigation sessions (runtime History Clear Stale Cache). */
  clearHistory() {
    return request('/api/history', {
      method: 'DELETE',
      timeoutMs: 15_000,
    });
  },

  /**
   * Download report (markdown|json|csv). Returns Blob.
   * @param {string} scanId
   * @param {'markdown'|'json'|'csv'} [format]
   * @param {string[]} [resolvedKeys] optional solved finding keys
   */
  async downloadReport(scanId, format = 'markdown', resolvedKeys = null) {
    const params = new URLSearchParams();
    params.set('format', format === 'csv' || format === 'json' ? format : 'markdown');
    if (Array.isArray(resolvedKeys) && resolvedKeys.length) {
      params.set('resolvedKeys', JSON.stringify(resolvedKeys));
    }
    const url = `${getBaseUrl()}/api/audit/scan/${encodeURIComponent(scanId)}/report?${params}`;
    const token = getAuthToken();
    const res = await fetch(url, {
      headers: {
        Accept: '*/*',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new ApiError(text || `Report HTTP ${res.status}`, res.status);
    }
    return res.blob();
  },

  /** SSE URL for scan progress (Brain proxies Eyraaaa). */
  scanEventsUrl(scanId) {
    return `${getBaseUrl()}/api/audit/scan/${encodeURIComponent(scanId)}/events`;
  },

  /**
   * Multilingual sandbox execute (temp dir + timeout; language via runtime registry).
   * @param {{code:string, language?:string, file_name?:string}} body
   */
  execute(body) {
    return request('/api/execute', {
      method: 'POST',
      body: JSON.stringify(body),
      timeoutMs: 90_000,
    });
  },

  /** Registered language adapters + host availability. */
  runtimes() {
    return request('/api/runtimes', { timeoutMs: 10_000 });
  },

  /**
   * Performance / complexity analysis for editor buffer.
   * @param {{code:string, language?:string, file_name?:string, target_time?:string, target_space?:string, goal?:string}} body
   */
  performanceAnalyze(body) {
    return request('/api/performance/analyze', {
      method: 'POST',
      body: JSON.stringify(body),
      timeoutMs: 60_000,
    });
  },

  /**
   * Suggest optimized code toward target complexities.
   * @param {{code:string, language?:string, file_name?:string, target_time?:string, target_space?:string, goal?:string}} body
   */
  performanceOptimize(body) {
    return request('/api/performance/optimize', {
      method: 'POST',
      body: JSON.stringify(body),
      timeoutMs: 90_000,
    });
  },

  /**
   * @param {{code:string, language?:string, file_name?:string, function_name?:string}} body
   */
  performanceGenerateTests(body) {
    return request('/api/performance/tests/generate', {
      method: 'POST',
      body: JSON.stringify(body),
      timeoutMs: 30_000,
    });
  },

  /**
   * @param {{code:string, language?:string, file_name?:string, cases?:object[], case_ids?:number[]}} body
   */
  performanceRunTests(body) {
    return request('/api/performance/tests/run', {
      method: 'POST',
      body: JSON.stringify(body),
      timeoutMs: 120_000,
    });
  },
};
