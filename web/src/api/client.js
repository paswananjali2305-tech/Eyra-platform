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

  startScan(scanId) {
    return request(`/api/audit/scan/${encodeURIComponent(scanId)}/start`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },

  getScan(scanId) {
    return request(`/api/audit/scan/${encodeURIComponent(scanId)}`);
  },
};
