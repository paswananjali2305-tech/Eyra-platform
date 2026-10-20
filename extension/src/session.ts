export const ACCESS_TOKEN_SECRET = 'eyra.accessToken';

export interface SecretStore {
  get(key: string): Thenable<string | undefined>;
  store(key: string, value: string): Thenable<void>;
  delete(key: string): Thenable<void>;
}

export function readAccessToken(secrets: SecretStore): Thenable<string | undefined> {
  return secrets.get(ACCESS_TOKEN_SECRET);
}

export function storeAccessToken(secrets: SecretStore, token: string): Thenable<void> {
  return secrets.store(ACCESS_TOKEN_SECRET, token);
}

export function clearAccessToken(secrets: SecretStore): Thenable<void> {
  return secrets.delete(ACCESS_TOKEN_SECRET);
}

export const EXTENSION_CREDENTIAL_PREFIX = 'eyra_ext.';

export function isExtensionCredential(token: string): boolean {
  return token.startsWith(EXTENSION_CREDENTIAL_PREFIX);
}

export function signOutPlan(token: string | undefined): 'revoke-extension' | 'local-only' | 'already-out' {
  if (!token) {
    return 'already-out';
  }
  if (isExtensionCredential(token)) {
    return 'revoke-extension';
  }
  return 'local-only';
}
