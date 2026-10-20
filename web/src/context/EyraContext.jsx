import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, getBaseUrl, setBaseUrl as persistBaseUrl } from '../api/client';
import { useAuth } from './AuthContext';
import { inflightEpoch, isStaleEpoch } from '../lib/userSessionState';
import { resetWorkspaceMemory } from '../lib/workspaceDraft';

const EyraContext = createContext(null);

const WORKSPACE_KEY = 'eyra.activeSessionId';
const SCAN_KEY = 'eyra.activeScanId';
const EYES_KEY = 'eyra.eyesConnected';

const MODE_KEY = 'eyra.uiMode';
const AUDIT_VIEW_KEY = 'eyra.auditView';

/** @typedef {'runtime' | 'audit'} UiMode */
/** @typedef {'overview' | 'ingest' | 'progress' | 'code' | 'history' | 'config'} AuditView */

const AUDIT_VIEWS = new Set(['overview', 'ingest', 'progress', 'code', 'history', 'config']);

export function EyraProvider({ children }) {
  const { user } = useAuth();
  const userId = user?.id || null;
  const [backendUrl, setBackendUrlState] = useState(getBaseUrl());
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [activeResult, setActiveResult] = useState(null);
  /** Last sandbox /api/execute payload (Analysis page verification + dry-run). */
  const [lastExecResult, setLastExecResult] = useState(null);
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
  const [notifications, setNotifications] = useState([]);
  const [toast, setToast] = useState(null);
  const [activeScanId, setActiveScanIdState] = useState(() => {
    try {
      return localStorage.getItem(SCAN_KEY) || null;
    } catch {
      return null;
    }
  });
  const [activeScan, setActiveScan] = useState(null);
  const [scanList, setScanList] = useState([]);

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

  const seenUserId = useRef(undefined);
  useEffect(() => {
    if (seenUserId.current === undefined) {
      seenUserId.current = userId;
      return;
    }
    if (seenUserId.current === userId) return;
    seenUserId.current = userId;
    resetWorkspaceMemory();
    setActiveResult(null);
    setLastExecResult(null);
    setNotifications([]);
    setScanList([]);
    setActiveScan(null);
    setActiveScanIdState(null);
    setMode('runtime');
    setAuditView('overview');
  }, [userId, setMode, setAuditView]);

  useEffect(() => {
    refreshStatus();
    const id = setInterval(refreshStatus, 15000);
    return () => clearInterval(id);
  }, [refreshStatus, backendUrl]);

  useEffect(() => {
    const sid = localStorage.getItem(WORKSPACE_KEY);
    if (!sid) return undefined;
    const started = inflightEpoch();
    api
      .historyDetail(sid)
      .then((r) => {
        if (isStaleEpoch(started)) return;
        setActiveResult(r);
      })
      .catch(() => {
        if (!isStaleEpoch(started)) localStorage.removeItem(WORKSPACE_KEY);
      });
    return undefined;
  }, [backendUrl, userId]);

  const setActiveScanId = useCallback((id) => {
    const next = id || null;
    setActiveScanIdState(next);
    try {
      if (next) localStorage.setItem(SCAN_KEY, next);
      else localStorage.removeItem(SCAN_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const clearActiveScan = useCallback(() => {
    setActiveScan(null);
    setActiveScanIdState(null);
    try {
      localStorage.removeItem(SCAN_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const refreshScan = useCallback(
    async (scanId) => {
      const id = scanId || activeScanId;
      if (!id) return null;
      try {
        const data = await api.getScan(id);
        const scan = data?.scan || data;
        if (scan) {
          setActiveScan(scan);
          setActiveScanId(scan.id || id);
          return scan;
        }
        clearActiveScan();
        return null;
      } catch {
        // Eyraaaa down / missing / timeout — drop stale pointer so UI is not stuck hydrating
        clearActiveScan();
        return null;
      }
    },
    [activeScanId, setActiveScanId, clearActiveScan],
  );

  const adoptScan = useCallback(
    (scanOrId, meta = {}) => {
      if (!scanOrId) return;
      if (typeof scanOrId === 'string') {
        setActiveScanId(scanOrId);
        setActiveScan((prev) =>
          prev?.id === scanOrId
            ? { ...prev, ...meta }
            : { id: scanOrId, status: meta.status || 'pending', ...meta },
        );
        return;
      }
      const scan = scanOrId;
      if (scan.id) setActiveScanId(scan.id);
      setActiveScan((prev) => {
        if (prev?.id && scan.id && prev.id === scan.id) {
          return {
            ...prev,
            ...scan,
            // Client-only ingest fields (not stored on Eyraaaa)
            sourceType: scan.sourceType || prev.sourceType,
            archiveName: scan.archiveName || prev.archiveName,
            sourceLabel: scan.sourceLabel || prev.sourceLabel,
          };
        }
        return scan;
      });
      if (meta.notify === true || meta.title) {
        setNotifications((prev) => [
          {
            id: `n-scan-${Date.now()}`,
            title: meta.title || `Audit ${scan.status || 'updated'}`,
            body: `${scan.projectName || 'Scan'} · ${scan.status || ''} · ${String(scan.id || '').slice(0, 8)}`,
            time: 'just now',
            read: false,
            href: scan.status === 'completed' ? 'audit:code' : 'audit:progress',
          },
          ...prev,
        ]);
      }
    },
    [setActiveScanId],
  );

  const refreshScanList = useCallback(async () => {
    try {
      const data = await api.listScans();
      const scans = Array.isArray(data) ? data : data?.scans || [];
      setScanList(scans);
      return scans;
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    if (!activeScanId) return undefined;
    let cancelled = false;
    const started = inflightEpoch();
    api
      .getScan(activeScanId)
      .then((data) => {
        if (cancelled || isStaleEpoch(started)) return;
        const scan = data?.scan || data;
        if (scan?.id) {
          setActiveScan(scan);
          return;
        }
        // Empty / malformed payload — clear so Code Audit is not stuck loading
        clearActiveScan();
      })
      .catch(() => {
        if (cancelled) return;
        // 404 after Eyraaaa restart, 503 when audit engine down, timeouts — all clear
        clearActiveScan();
      });
    return () => {
      cancelled = true;
    };
  }, [backendUrl, activeScanId, clearActiveScan]);

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
      lastExecResult,
      setLastExecResult,
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
      activeScanId,
      setActiveScanId,
      activeScan,
      setActiveScan,
      clearActiveScan,
      adoptScan,
      refreshScan,
      scanList,
      refreshScanList,
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
      lastExecResult,
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
      activeScanId,
      setActiveScanId,
      activeScan,
      clearActiveScan,
      adoptScan,
      refreshScan,
      scanList,
      refreshScanList,
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
