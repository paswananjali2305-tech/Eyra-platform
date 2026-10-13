/**
 * Debugging Workspace draft — survives route changes and tab refresh.
 * In-memory copy is authoritative during the SPA session; sessionStorage
 * is a best-effort mirror for reloads.
 */

const STORAGE_KEY = 'eyra.runtimeWorkspace.v1';

/** @type {{ editor: object|null, session: object|null, chat: object|null }|null} */
let memory = null;

function emptyStore() {
  return { editor: null, session: null, chat: null };
}

function readStore() {
  if (memory) return memory;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
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
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(memory));
  } catch {
    /* quota — in-memory copy still survives in-app navigation */
  }
}
