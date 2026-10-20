/**
 * Browser state that belongs to one signed-in user.
 * Pure helpers so logout behavior can be tested without a DOM.
 */

export const ACTIVE_SESSION_KEY = 'eyra.activeSessionId';
export const ACTIVE_SCAN_KEY = 'eyra.activeScanId';
export const UI_MODE_KEY = 'eyra.uiMode';
export const AUDIT_VIEW_KEY = 'eyra.auditView';
export const WORKSPACE_PREFIX = 'eyra.runtimeWorkspace.v1';
export const WELCOME_KEY = 'eyra.welcomePending';

const UNSCOPED_KEYS = [
  ACTIVE_SESSION_KEY,
  ACTIVE_SCAN_KEY,
  UI_MODE_KEY,
  AUDIT_VIEW_KEY,
  WORKSPACE_PREFIX,
];

let requestEpoch = 0;

export function workspaceKeyForUser(userId) {
  if (!userId) return null;
  return `${WORKSPACE_PREFIX}:${userId}`;
}

export function invalidateInflightRequests() {
  requestEpoch += 1;
  return requestEpoch;
}

export function inflightEpoch() {
  return requestEpoch;
}

export function isStaleEpoch(started) {
  return started !== requestEpoch;
}

/**
 * Drop pointers and the unscoped draft so the next account cannot see them.
 * A namespaced draft (`eyra.runtimeWorkspace.v1:<userId>`) is kept for that user.
 */
export function clearLoggedOutBrowserState(localStore, sessionStore, userId) {
  if (localStore) {
    for (const key of UNSCOPED_KEYS) {
      localStore.removeItem(key);
    }
  }
  if (sessionStore) {
    sessionStore.removeItem(WELCOME_KEY);
  }
  return {
    keptDraftKey: workspaceKeyForUser(userId),
    epoch: invalidateInflightRequests(),
  };
}
