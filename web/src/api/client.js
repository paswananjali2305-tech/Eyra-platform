/**
 * Typed EYRA Brain API client (JSDoc types).
 * Base URL is configurable; secrets never live here.
 */

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
const DEFAULT_BASE = import.meta.env.VITE_EYRA_API_BASE || 'http://127.0.0.1:8000';
const DEFAULT_TIMEOUT_MS = 60_000;

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
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...init } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const url = `${getBaseUrl()}${path}`;

  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
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
      const detail =
        typeof data === 'object' && data && 'detail' in data
          ? typeof data.detail === 'string'
            ? data.detail
            : JSON.stringify(data.detail)
          : `HTTP ${res.status}`;
      throw new ApiError(detail, res.status, data);
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
    return request('/api/health', { timeoutMs: 5000 });
  },

  status() {
    return request('/api/status', { timeoutMs: 8000 });
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

  auditHealth() {
    return request('/api/audit/health', { timeoutMs: 5000 });
  },

  loadSample(sampleId) {
    return request('/api/audit/upload', {
      method: 'POST',
      body: JSON.stringify({ sampleId }),
      timeoutMs: 60_000,
    });
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
      const url = `${getBaseUrl()}/api/audit/upload`;
      xhr.open('POST', url);
      xhr.timeout = 120_000;
      xhr.responseType = 'text';
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable && opts.onProgress) {
          opts.onProgress(Math.round((ev.loaded / ev.total) * 100));
        }
      };
      xhr.onload = () => {
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
   * Eyraaaa GitHub path is mock-only (loads NovaPay sample). Prefer labeling in UI.
   * @param {string} repoUrl
   */
  uploadGithubMock(repoUrl) {
    return request('/api/audit/upload', {
      method: 'POST',
      body: JSON.stringify({ repoUrl }),
      timeoutMs: 60_000,
    });
  },

  startScan(scanId) {
    return request(`/api/audit/scan/${encodeURIComponent(scanId)}/start`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },

  getScan(scanId) {
    return request(`/api/audit/scan/${encodeURIComponent(scanId)}`);
  },

  listScans() {
    return request('/api/audit/scans', { timeoutMs: 15_000 });
  },

  /**
   * Download report (markdown|json). Returns Blob.
   * @param {string} scanId
   * @param {'markdown'|'json'} [format]
   */
  async downloadReport(scanId, format = 'markdown') {
    const qs = format === 'json' ? '?format=json' : '?format=markdown';
    const url = `${getBaseUrl()}/api/audit/scan/${encodeURIComponent(scanId)}/report${qs}`;
    const res = await fetch(url, { headers: { Accept: '*/*' } });
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
   * Sandboxed Python execute (Brain timeout + blocked network/process APIs).
   * @param {{code:string, language?:string, file_name?:string}} body
   */
  execute(body) {
    return request('/api/execute', {
      method: 'POST',
      body: JSON.stringify(body),
      timeoutMs: 15_000,
    });
  },
};
