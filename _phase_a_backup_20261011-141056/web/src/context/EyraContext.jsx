import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getBaseUrl, setBaseUrl as persistBaseUrl } from '../api/client';

const EyraContext = createContext(null);

const WORKSPACE_KEY = 'eyra.activeSessionId';
const EYES_KEY = 'eyra.eyesConnected';

const MODE_KEY = 'eyra.uiMode';
const AUDIT_VIEW_KEY = 'eyra.auditView';

/** @typedef {'runtime' | 'audit'} UiMode */
/** @typedef {'overview' | 'ingest' | 'progress' | 'code' | 'history' | 'config'} AuditView */

const AUDIT_VIEWS = new Set(['overview', 'ingest', 'progress', 'code', 'history', 'config']);

export function EyraProvider({ children }) {
  const [backendUrl, setBackendUrlState] = useState(getBaseUrl());
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [activeResult, setActiveResult] = useState(null);
  const [mode, setModeState] = useState(() => {
    try {
      return localStorage.getItem(MODE_KEY) === 'audit' ? 'audit' : 'runtime';
    } catch {
      return 'runtime';
    }
  });
  const [auditView, setAuditViewState] = useState(() => {
    try {
      const v = localStorage.getItem(AUDIT_VIEW_KEY);
      if (AUDIT_VIEWS.has(v)) return v;
    } catch {
      /* ignore */
    }
    return 'overview';
  });
  const [eyesConnected, setEyesConnected] = useState(() => {
    try {
      return localStorage.getItem(EYES_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [notifications, setNotifications] = useState(() => [
    {
      id: 'n1',
      title: 'Brain online',
      body: 'EYRA Brain health check succeeded.',
      time: 'just now',
      read: false,
      href: '/config',
    },
    {
      id: 'n2',
      title: 'Audit findings ready',
      body: 'Open Code Audit to inspect AST-flagged files.',
      time: '2m ago',
      read: false,
      href: 'audit:code',
    },
    {
      id: 'n3',
      title: 'Investigation saved',
      body: 'Latest ZeroDivisionError session stored in history.',
      time: '15m ago',
      read: true,
      href: '/history',
    },
  ]);
  const [toast, setToast] = useState(null);

  const setMode = useCallback((next) => {
    const m = next === 'audit' ? 'audit' : 'runtime';
    setModeState(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* ignore */
    }
  }, []);

  const setAuditView = useCallback((next) => {
    const v = AUDIT_VIEWS.has(next) ? next : 'overview';
    setAuditViewState(v);
    try {
      localStorage.setItem(AUDIT_VIEW_KEY, v);
    } catch {
      /* ignore */
    }
  }, []);

  const refreshStatus = useCallback(async () => {
    setStatusLoading(true);
    setStatusError(null);
    try {
      const s = await api.status();
      setStatus(s);
    } catch (err) {
      setStatus(null);
      setStatusError(err.message || String(err));
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshStatus();
    const id = setInterval(refreshStatus, 15000);
    return () => clearInterval(id);
  }, [refreshStatus, backendUrl]);

  useEffect(() => {
    const sid = localStorage.getItem(WORKSPACE_KEY);
    if (!sid) return;
    api
      .historyDetail(sid)
      .then((r) => setActiveResult(r))
      .catch(() => localStorage.removeItem(WORKSPACE_KEY));
  }, [backendUrl]);

  const setBackendUrl = useCallback((url) => {
    persistBaseUrl(url);
    setBackendUrlState(getBaseUrl());
  }, []);

  const setEyes = useCallback((value) => {
    setEyesConnected(Boolean(value));
    try {
      localStorage.setItem(EYES_KEY, value ? 'true' : 'false');
    } catch {
      /* ignore */
    }
  }, []);

  const adoptResult = useCallback((result) => {
    setActiveResult(result);
    if (result?.session_id) {
      localStorage.setItem(WORKSPACE_KEY, result.session_id);
      setNotifications((prev) => [
        {
          id: `n-${Date.now()}`,
          title: 'Investigation complete',
          body: `${result.error_type || 'Session'} · ${result.session_id}`,
          time: 'just now',
          read: false,
          href: '/analysis',
        },
        ...prev,
      ]);
    }
  }, []);

  const showToast = useCallback((message, tone = 'info') => {
    setToast({ message, tone, id: Date.now() });
  }, []);

  const dismissToast = useCallback(() => setToast(null), []);

  useEffect(() => {
    if (!toast) return undefined;
    const id = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(id);
  }, [toast]);

  const markNotificationsRead = useCallback((id) => {
    setNotifications((prev) =>
      prev.map((n) => {
        if (!id || n.id === id) return { ...n, read: true };
        return n;
      }),
    );
  }, []);

  const pushNotification = useCallback((n) => {
    setNotifications((prev) => [
      {
        id: n.id || `n-${Date.now()}`,
        title: n.title || 'EYRA',
        body: n.body || '',
        time: n.time || 'just now',
        read: false,
        href: n.href,
      },
      ...prev,
    ]);
  }, []);

  const value = useMemo(
    () => ({
      backendUrl,
      setBackendUrl,
      status,
      statusError,
      statusLoading,
      refreshStatus,
      activeResult,
      adoptResult,
      setActiveResult,
      eyesConnected,
      setEyes,
      mode,
      setMode,
      auditView,
      setAuditView,
      notifications,
      markNotificationsRead,
      pushNotification,
      toast,
      showToast,
      dismissToast,
    }),
    [
      backendUrl,
      setBackendUrl,
      status,
      statusError,
      statusLoading,
      refreshStatus,
      activeResult,
      adoptResult,
      eyesConnected,
      setEyes,
      mode,
      setMode,
      auditView,
      setAuditView,
      notifications,
      markNotificationsRead,
      pushNotification,
      toast,
      showToast,
      dismissToast,
    ],
  );

  return (
    <EyraContext.Provider value={value}>
      {children}
      {toast ? (
        <div className="fixed bottom-6 right-6 z-[90] flex max-w-sm items-center gap-2 rounded bg-surface-container-highest px-space-md py-space-sm font-body-sm text-body-sm text-on-surface shadow-xl">
          <span
            className={`material-symbols-outlined text-[16px] ${
              toast.tone === 'error' ? 'text-error' : 'text-tertiary'
            }`}
          >
            {toast.tone === 'error' ? 'error' : 'check_circle'}
          </span>
          <span className="min-w-0 flex-1">{toast.message}</span>
          <button type="button" onClick={dismissToast} className="text-outline hover:text-on-surface">
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
      ) : null}
    </EyraContext.Provider>
  );
}

export function useEyra() {
  const ctx = useContext(EyraContext);
  if (!ctx) throw new Error('useEyra must be used within EyraProvider');
  return ctx;
}
