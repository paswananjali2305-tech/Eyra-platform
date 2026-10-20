/**
 * Shared URI parsing for the EYRA deep-link handler.
 * URI shape: vscode://eyra-runtime-debugger.eyra-runtime-debugger/open
 * (Cursor: cursor://eyra-runtime-debugger.eyra-runtime-debugger/open)
 *
 * Secrets must never appear in the query string. Auth stays on
 * EYRA: Connect from Web (paste one-time code).
 */

export const EYRA_EXTENSION_ID = 'eyra-runtime-debugger.eyra-runtime-debugger';

const FORBIDDEN_QUERY_KEYS = [
  'token',
  'access_token',
  'refresh_token',
  'code',
  'password',
  'secret',
  'authorization',
  'auth',
  'bearer',
  'api_key',
  'apikey',
] as const;

export type UriOpenDecision =
  | { kind: 'open' }
  | { kind: 'reject'; reason: string };

function normalizePath(path: string): string {
  if (!path || path === '/') {
    return '/open';
  }
  const trimmed = path.endsWith('/') && path.length > 1 ? path.slice(0, -1) : path;
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export function buildOpenExtensionUri(scheme: 'vscode' | 'cursor' = 'vscode'): string {
  return `${scheme}://${EYRA_EXTENSION_ID}/open`;
}

export function parseOpenUri(input: { path?: string; query?: string }): UriOpenDecision {
  const query = typeof input.query === 'string' ? input.query : '';
  if (query) {
    const params = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);
    for (const key of FORBIDDEN_QUERY_KEYS) {
      if (params.has(key)) {
        return {
          kind: 'reject',
          reason: `Refusing URI with sensitive query parameter "${key}". Use EYRA: Connect from Web instead.`,
        };
      }
    }
    let hasQuery = false;
    params.forEach(() => {
      hasQuery = true;
    });
    if (hasQuery) {
      return {
        kind: 'reject',
        reason: 'Open Extension URIs do not accept query parameters.',
      };
    }
  }

  const path = normalizePath(typeof input.path === 'string' ? input.path : '');
  if (path === '/open') {
    return { kind: 'open' };
  }
  return {
    kind: 'reject',
    reason: `Unsupported EYRA URI path "${path}". Use /open.`,
  };
}
