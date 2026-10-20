import { brainBaseUrl } from './config';
import { BrainHttpError, requestJson } from './http';

const TIMEOUT_MS = 8000;

export type HealthSuccess = {
  ok: true;
  url: string;
  status: string;
  service: string;
  version: string;
  body: unknown;
};

export type HealthFailure = {
  ok: false;
  url: string;
  message: string;
};

export type HealthResult = HealthSuccess | HealthFailure;

export async function checkBrainHealth(): Promise<HealthResult> {
  const base = brainBaseUrl();
  let url = base;
  try {
    url = new URL('/api/health', `${base}/`).toString();
    const body = await requestJson({
      baseUrl: base,
      path: '/api/health',
      method: 'GET',
      timeoutMs: TIMEOUT_MS,
    });
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return { ok: false, url, message: `Brain at ${url} returned JSON that is not a health object.` };
    }
    const record = body as Record<string, unknown>;
    return {
      ok: true,
      url,
      status: typeof record.status === 'string' ? record.status : '',
      service: typeof record.service === 'string' ? record.service : '',
      version: typeof record.version === 'string' ? record.version : '',
      body,
    };
  } catch (err) {
    const message = err instanceof BrainHttpError
      ? err.message
      : `Cannot reach EYRA Brain at ${url}.`;
    return { ok: false, url, message };
  }
}
