const DEFAULT_TIMEOUT_MS = 20_000;

export class BrainHttpError extends Error {
  readonly status: number;
  readonly unauthorized: boolean;
  readonly timedOut: boolean;
  readonly cancelled: boolean;

  constructor(message: string, status: number, timedOut = false, cancelled = false) {
    super(message);
    this.name = 'BrainHttpError';
    this.status = status;
    this.unauthorized = status === 401;
    this.timedOut = timedOut;
    this.cancelled = cancelled;
  }
}

export function apiUrl(baseUrl: string, path: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return new URL(suffix, `${base}/`).toString();
}

function detailMessage(body: unknown): string {
  if (!body || typeof body !== 'object') {
    return '';
  }
  const detail = (body as { detail?: unknown }).detail;
  if (typeof detail === 'string') {
    return detail;
  }
  if (!Array.isArray(detail)) {
    return '';
  }
  return detail
    .map((item) => {
      if (item && typeof item === 'object' && 'msg' in item) {
        return String((item as { msg?: unknown }).msg || '');
      }
      return '';
    })
    .filter(Boolean)
    .join('; ');
}

export async function requestJson(options: {
  baseUrl: string;
  path: string;
  method?: 'GET' | 'POST';
  body?: unknown;
  token?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<unknown> {
  let url: string;
  try {
    url = apiUrl(options.baseUrl, options.path);
  } catch {
    throw new BrainHttpError(`eyra.backendUrl is not a valid URL: ${options.baseUrl}`, 0);
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  const local = new AbortController();
  let abortReason: 'timeout' | 'user' | null = null;
  const timer = setTimeout(() => {
    abortReason = 'timeout';
    local.abort();
  }, timeoutMs);

  const onExternalAbort = (): void => {
    abortReason = 'user';
    local.abort();
  };
  if (options.signal) {
    if (options.signal.aborted) {
      abortReason = 'user';
      local.abort();
    } else {
      options.signal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  try {
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      signal: local.signal,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    const text = await response.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        if (!response.ok) {
          throw new BrainHttpError(`Brain returned HTTP ${response.status} from ${url}.`, response.status);
        }
        throw new BrainHttpError(`Brain at ${url} returned a 2xx response that is not JSON.`, response.status);
      }
    }
    if (!response.ok) {
      const detail = detailMessage(parsed);
      const prefix = response.status === 401
        ? 'The Brain rejected this session (HTTP 401). It may have expired.'
        : `Brain returned HTTP ${response.status}.`;
      throw new BrainHttpError(detail ? `${prefix} ${detail}` : prefix, response.status);
    }
    return parsed;
  } catch (err) {
    if (err instanceof BrainHttpError) {
      throw err;
    }
    const aborted = err instanceof Error && err.name === 'AbortError';
    if (aborted && abortReason === 'user') {
      throw new BrainHttpError('EYRA request cancelled.', 0, false, true);
    }
    if (aborted) {
      throw new BrainHttpError(`Timed out after ${timeoutMs}ms waiting for ${url}.`, 0, true, false);
    }
    const detail = err instanceof Error ? err.message : String(err);
    throw new BrainHttpError(`Cannot reach EYRA Brain at ${url}. ${detail}`, 0);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onExternalAbort);
  }
}
