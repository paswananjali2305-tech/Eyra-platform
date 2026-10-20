/**
 * Open the local EYRA extension in VS Code via the Brain.
 * EYRA is not on the Marketplace — deep links alone cause "extension not found".
 * The Brain packages/installs the repo VSIX into VS Code. No tokens in URIs.
 */

export const EYRA_EXTENSION_ID = 'eyra-runtime-debugger.eyra-runtime-debugger';

const FORBIDDEN_QUERY_KEYS = new Set([
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
]);

/**
 * @param {'vscode' | 'cursor'} [scheme]
 * @returns {string}
 */
export function buildOpenExtensionUri(scheme = 'vscode') {
  if (scheme !== 'vscode' && scheme !== 'cursor') {
    throw new Error(`Unsupported URI scheme: ${scheme}`);
  }
  return `${scheme}://${EYRA_EXTENSION_ID}/open`;
}

/**
 * @param {string} uri
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function validateOpenExtensionUri(uri) {
  if (typeof uri !== 'string' || !uri.trim()) {
    return { ok: false, reason: 'URI is empty.' };
  }
  let parsed;
  try {
    parsed = new URL(uri);
  } catch {
    return { ok: false, reason: 'URI is not valid.' };
  }
  if (parsed.protocol !== 'vscode:' && parsed.protocol !== 'cursor:') {
    return { ok: false, reason: 'URI must use the vscode: or cursor: scheme.' };
  }
  if (parsed.hostname !== EYRA_EXTENSION_ID && parsed.host !== EYRA_EXTENSION_ID) {
    return { ok: false, reason: 'URI host must be the EYRA extension id.' };
  }
  const path = parsed.pathname === '/' || parsed.pathname === '' ? '/open' : parsed.pathname.replace(/\/$/, '') || '/open';
  if (path !== '/open') {
    return { ok: false, reason: 'URI path must be /open.' };
  }
  for (const key of parsed.searchParams.keys()) {
    if (FORBIDDEN_QUERY_KEYS.has(key)) {
      return { ok: false, reason: `Refusing sensitive query parameter "${key}".` };
    }
    return { ok: false, reason: 'Open Extension URIs do not accept query parameters.' };
  }
  return { ok: true };
}

/**
 * Prefer Brain-assisted local install. Marketplace deep links alone fail for unpublished extensions.
 * @param {{
 *   editor?: 'auto' | 'cursor' | 'vscode',
 *   openViaBrain?: (body: { editor: string }) => Promise<object>,
 * }} [options]
 * @returns {Promise<{
 *   ok: boolean,
 *   reason?: string,
 *   message?: string,
 *   mode?: string,
 *   editor?: string | null,
 *   uri?: string | null,
 *   installed?: boolean,
 *   opened?: boolean,
 * }>}
 */
export async function launchOpenExtension(options = {}) {
  const editor =
    options.editor === 'cursor' || options.editor === 'auto' ? options.editor : 'vscode';

  if (typeof options.openViaBrain === 'function') {
    try {
      const data = await options.openViaBrain({ editor });
      if (!data || data.ok !== true) {
        return {
          ok: false,
          reason:
            (data && (data.message || data.detail)) ||
            'The Brain could not install or open the local EYRA extension.',
          message: data?.message,
          detail: data?.detail,
          mode: data?.mode,
          editor: data?.editor ?? null,
          uri: data?.uri ?? null,
          installed: Boolean(data?.installed),
          opened: Boolean(data?.opened),
        };
      }
      return {
        ok: true,
        message: data.message || OPEN_EXTENSION_HINT,
        mode: data.mode,
        editor: data.editor ?? null,
        uri: data.uri ?? null,
        installed: Boolean(data.installed),
        opened: Boolean(data.opened),
      };
    } catch (err) {
      return {
        ok: false,
        reason: err?.message || 'Could not reach the Brain extension open API.',
      };
    }
  }

  return {
    ok: false,
    reason:
      'Open Extension requires the EYRA Brain (/api/extension/open). Direct Marketplace links are not used because EYRA is unpublished.',
  };
}

export const OPEN_EXTENSION_HINT =
  'EYRA is installed locally into VS Code (not Marketplace). Open the EYRA icon in the Activity Bar.';
