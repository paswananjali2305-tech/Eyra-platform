/**
 * Debugging Workspace draft — survives route changes and tab refresh.
 * Stored per authenticated user so a later login on the same browser
 * cannot read the previous account's editor.
 */

const STORAGE_KEY = 'eyra.runtimeWorkspace.v1';

/** @type {{ editor: object|null, session: object|null, chat: object|null }|null} */
let memory = null;
let memoryUserId = null;

function emptyStore() {
  return { editor: null, session: null, chat: null };
}

function readAuthUserId() {
  try {
    const raw = localStorage.getItem('eyra.authUser');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.id || null;
  } catch {
    return null;
  }
}

function storageKeyFor(userId) {
  return userId ? `${STORAGE_KEY}:${userId}` : null;
}

export function resetWorkspaceMemory() {
  memory = null;
  memoryUserId = null;
}

function readStore() {
  const userId = readAuthUserId();
  if (memory && memoryUserId === userId) return memory;
  memoryUserId = userId;
  const key = storageKeyFor(userId);
  if (!key) {
    memory = emptyStore();
    return memory;
  }
  try {
    const raw = sessionStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    memory =
      parsed && typeof parsed === 'object' ? { ...emptyStore(), ...parsed } : emptyStore();
  } catch {
    memory = emptyStore();
  }
  return memory;
}

/** @param {'editor'|'session'|'chat'} key */
export function loadWorkspaceSlice(key) {
  const value = readStore()[key];
  return value && typeof value === 'object' ? value : null;
}

/** @param {'editor'|'session'|'chat'} key */
export function saveWorkspaceSlice(key, value) {
  const store = readStore();
  memory = { ...store, [key]: value };
  memoryUserId = readAuthUserId();
  const storageKey = storageKeyFor(memoryUserId);
  if (!storageKey) return;
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(memory));
  } catch {
    /* quota — in-memory copy still survives in-app navigation */
  }
}
