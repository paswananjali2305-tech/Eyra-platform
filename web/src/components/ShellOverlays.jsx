import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useEyra } from '../context/EyraContext';
import { isDemoProjectName, rejectDemoProjects } from '../lib/demoProjects.js';

/** Header project menu stays empty of demo/sample leftovers. */
const EMPTY_PROJECT = { id: '', label: 'No project', env: '—' };
const PROJECTS = [EMPTY_PROJECT];

/**
 * Header search (⌘K), notifications drawer, project + account menus.
 */
export function ShellOverlays({
  searchOpen,
  setSearchOpen,
  notifOpen,
  setNotifOpen,
  projectOpen,
  setProjectOpen,
  accountOpen,
  setAccountOpen,
  project,
  setProject,
  searchInputRef,
}) {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const {
    mode,
    setMode,
    setAuditView,
    status,
    notifications,
    markNotificationsRead,
    showToast,
    adoptScan,
    refreshScanList,
  } = useEyra();
  const [query, setQuery] = useState('');
  const [historyHits, setHistoryHits] = useState([]);
  const [searching, setSearching] = useState(false);
  const [liveProjects, setLiveProjects] = useState([]);
  const [switching, setSwitching] = useState(false);
  const panelRef = useRef(null);

  function whenMs(iso) {
    const t = new Date(iso || 0).getTime();
    return Number.isFinite(t) ? t : 0;
  }

  /** Select sidebar project → load matching audit scan into all audit tabs. */
  async function selectProject(p) {
    if (!p?.id) {
      setProject?.(EMPTY_PROJECT);
      setProjectOpen(false);
      return;
    }
    setProject?.(p);
    setProjectOpen(false);

    if (p.env === 'runtime') {
      setMode('runtime');
      navigate('/history');
      showToast?.(`Runtime project: ${p.label}`, 'info');
      return;
    }

    setSwitching(true);
    try {
      setMode('audit');
      let scans = [];
      try {
        scans = (await refreshScanList()) || [];
      } catch {
        const data = await api.listScans();
        scans = Array.isArray(data) ? data : data?.scans || [];
      }
      const key = String(p.label || p.id).toLowerCase();
      const matches = scans
        .filter((s) => String(s.projectName || s.archiveName || '').toLowerCase() === key)
        .sort(
          (a, b) =>
            whenMs(b.completedAt || b.updatedAt || b.createdAt) -
            whenMs(a.completedAt || a.updatedAt || a.createdAt),
        );
      const hit = matches[0];
      if (!hit?.id) {
        setAuditView('ingest');
        showToast?.(`No audit scan for ${p.label} — ingest a ZIP/repo first`, 'error');
        return;
      }
      let scan = hit;
      try {
        const data = await api.getScan(hit.id);
        scan = data?.scan || data || hit;
      } catch {
        /* use list summary */
      }
      adoptScan(scan, { notify: false });
      const st = String(scan.status || '').toLowerCase();
      if (st === 'completed') setAuditView('overview');
      else if (st === 'analyzing' || st === 'running' || st === 'scanning') setAuditView('progress');
      else if (st === 'pending' || st === 'queued') setAuditView('ingest');
      else setAuditView('overview');
      showToast?.(
        `Loaded ${scan.projectName || p.label} · ${String(scan.id || '').slice(0, 8)}`,
        'info',
      );
    } catch (err) {
      showToast?.(err.message || 'Failed to load project scan', 'error');
    } finally {
      setSwitching(false);
    }
  }

  // Header project list: never surface demo / sample / upload-test names.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const byName = new Map();
      try {
        const scans = await api.listScans();
        const list = Array.isArray(scans) ? scans : scans?.scans || [];
        for (const s of list) {
          const name = s.projectName || s.archiveName;
          if (!name || isDemoProjectName(name)) continue;
          byName.set(String(name).toLowerCase(), { id: name, label: name, env: 'audit' });
        }
      } catch {
        /* offline */
      }
      try {
        const hist = await api.history({ limit: 40 });
        for (const item of hist?.items || []) {
          const name = item.project_name;
          if (!name || isDemoProjectName(name)) continue;
          if (!byName.has(String(name).toLowerCase())) {
            byName.set(String(name).toLowerCase(), {
              id: name,
              label: name,
              env: 'runtime',
            });
          }
        }
      } catch {
        /* offline */
      }
      if (!cancelled) setLiveProjects(rejectDemoProjects([...byName.values()]));
    })();
    return () => {
      cancelled = true;
    };
  }, [status?.healthy, mode]);

  // If header still shows a demo selection, reset to empty.
  useEffect(() => {
    if (project && isDemoProjectName(project.label || project.id)) {
      setProject?.(EMPTY_PROJECT);
    }
  }, [project, setProject]);

  const unread = useMemo(
    () => (notifications || []).filter((n) => !n.read).length,
    [notifications],
  );

  useEffect(() => {
    if (!searchOpen) return undefined;
    const t = setTimeout(async () => {
      const q = query.trim();
      if (!q) {
        setHistoryHits([]);
        return;
      }
      setSearching(true);
      try {
        const data = await api.history({ q, limit: 8 });
        setHistoryHits(data.items || []);
      } catch {
        setHistoryHits([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query, searchOpen]);

  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
        setNotifOpen(false);
        setProjectOpen(false);
        setAccountOpen(false);
      }
      if (e.key === 'Escape') {
        setSearchOpen(false);
        setNotifOpen(false);
        setProjectOpen(false);
        setAccountOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setSearchOpen, setNotifOpen, setProjectOpen, setAccountOpen]);

  useEffect(() => {
    if (searchOpen) {
      setTimeout(() => searchInputRef?.current?.focus(), 0);
    } else {
      setQuery('');
    }
  }, [searchOpen, searchInputRef]);

  const quickLinks =
    mode === 'audit'
      ? [
          { label: 'Code Audit', action: () => setAuditView('code') },
          { label: 'Ingest codebase', action: () => setAuditView('ingest') },
          { label: 'Live progress', action: () => setAuditView('progress') },
          { label: 'Audit history', action: () => setAuditView('history') },
        ]
      : [
          { label: 'Debugging Workspace', action: () => navigate('/workspace') },
          { label: 'Code Performance & Test Analysis', action: () => navigate('/analysis') },
          { label: 'Investigation History', action: () => navigate('/history') },
          { label: 'Memory', action: () => navigate('/memory') },
        ];

  function runQuick(link) {
    link.action();
    setSearchOpen(false);
  }

  function openHistory(sessionId) {
    setSearchOpen(false);
    setMode('runtime');
    showToast?.(`Session ${sessionId.slice(0, 12)}… — open from History`, 'info');
    navigate('/history');
  }

  return (
    <>
      {/* Search modal */}
      {searchOpen ? (
        <div
          className="fixed inset-0 z-[80] flex items-start justify-center bg-black/50 px-4 pt-[12vh]"
          onClick={() => setSearchOpen(false)}
        >
          <div
            ref={panelRef}
            className="w-full max-w-xl overflow-hidden rounded border border-outline-variant/40 bg-surface-container-lowest shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-outline-variant/30 px-3 py-2">
              <span className="material-symbols-outlined text-[18px] text-outline">search</span>
              <input
                ref={searchInputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={
                  mode === 'audit' ? 'Search findings, files, scans…' : 'Search sessions, errors, files…'
                }
                className="min-w-0 flex-1 bg-transparent py-2 font-code-compact text-code-compact text-on-surface outline-none placeholder:text-outline"
              />
              <kbd className="rounded border border-outline-variant/40 px-1.5 py-0.5 font-label-sm text-label-sm text-outline">
                Esc
              </kbd>
            </div>
            <div className="max-h-80 overflow-y-auto p-2">
              <p className="px-2 py-1 font-label-sm text-label-sm uppercase text-outline">Quick jump</p>
              <ul className="mb-2 flex flex-col gap-0.5">
                {quickLinks.map((link) => (
                  <li key={link.label}>
                    <button
                      type="button"
                      onClick={() => runQuick(link)}
                      className="flex w-full items-center gap-2 rounded px-2 py-2 text-left font-body-sm text-body-sm text-on-surface hover:bg-surface-container"
                    >
                      <span className="material-symbols-outlined text-[16px] text-primary">bolt</span>
                      {link.label}
                    </button>
                  </li>
                ))}
              </ul>
              {query.trim() ? (
                <>
                  <p className="px-2 py-1 font-label-sm text-label-sm uppercase text-outline">
                    Sessions {searching ? '…' : ''}
                  </p>
                  <ul className="flex flex-col gap-0.5">
                    {historyHits.map((item) => (
                      <li key={item.session_id}>
                        <button
                          type="button"
                          onClick={() => openHistory(item.session_id)}
                          className="flex w-full flex-col gap-0.5 rounded px-2 py-2 text-left hover:bg-surface-container"
                        >
                          <span className="font-label-md text-label-md text-on-surface">
                            {item.error_type} · {item.file_name}
                          </span>
                          <span className="font-code-compact text-code-compact text-outline">
                            {item.session_id}
                          </span>
                        </button>
                      </li>
                    ))}
                    {!searching && !historyHits.length ? (
                      <li className="px-2 py-2 font-body-sm text-body-sm text-outline">No matches</li>
                    ) : null}
                  </ul>
                </>
              ) : (
                <p className="px-2 py-2 font-body-sm text-body-sm text-outline">
                  Brain {status?.healthy ? 'online' : 'offline'} · type to search history
                </p>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* Notifications */}
      {notifOpen ? (
        <div className="fixed right-4 top-16 z-[70] w-80 overflow-hidden rounded border border-outline-variant/40 bg-surface-container-lowest shadow-xl">
          <div className="flex items-center justify-between border-b border-outline-variant/30 px-3 py-2">
            <span className="font-label-md text-label-md font-semibold text-on-surface">
              Notifications {unread ? `(${unread})` : ''}
            </span>
            <button
              type="button"
              onClick={() => markNotificationsRead()}
              className="font-label-sm text-label-sm text-primary"
            >
              Mark all read
            </button>
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {(notifications || []).map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => {
                    markNotificationsRead(n.id);
                    if (n.href === 'audit:code') {
                      setMode('audit');
                      setAuditView('code');
                    } else if (n.href === 'audit:progress') {
                      setMode('audit');
                      setAuditView('progress');
                    } else if (n.href) {
                      setMode('runtime');
                      navigate(n.href);
                    }
                    setNotifOpen(false);
                  }}
                  className={`flex w-full flex-col gap-0.5 border-b border-outline-variant/15 px-3 py-2.5 text-left hover:bg-surface-container ${
                    n.read ? 'opacity-70' : ''
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {!n.read ? <span className="h-1.5 w-1.5 rounded-full bg-error" /> : null}
                    <span className="font-label-md text-label-md text-on-surface">{n.title}</span>
                  </div>
                  <span className="font-body-sm text-body-sm text-on-surface-variant">{n.body}</span>
                  <span className="font-code-compact text-code-compact text-outline">{n.time}</span>
                </button>
              </li>
            ))}
            {!notifications?.length ? (
              <li className="px-3 py-4 font-body-sm text-body-sm text-outline">No notifications</li>
            ) : null}
          </ul>
        </div>
      ) : null}

      {/* Project menu — anchored under sidebar selector (not the top header) */}
      {projectOpen ? (
        <div
          id="eyra-project-menu"
          role="listbox"
          className="fixed left-3 top-[4.75rem] z-[70] w-[13.5rem] overflow-hidden rounded border border-outline-variant/40 bg-surface-container-lowest shadow-xl"
        >
          {switching ? (
            <div className="px-3 py-3 font-body-sm text-body-sm text-outline">Loading scan…</div>
          ) : null}
          {(liveProjects.length ? liveProjects : [EMPTY_PROJECT]).map((p) => (
            <button
              key={p.id || 'empty'}
              type="button"
              role="option"
              disabled={switching || (!p.id && liveProjects.length > 0)}
              aria-selected={project.id === p.id}
              onClick={() => selectProject(p)}
              className={`flex w-full items-center justify-between px-3 py-2 text-left font-code-compact text-code-compact hover:bg-surface-container disabled:cursor-default disabled:opacity-70 ${
                project.id === p.id ? 'text-primary' : 'text-on-surface'
              }`}
            >
              <span className="truncate">{p.label}</span>
              {p.env && p.env !== '—' ? (
                <span className="shrink-0 text-outline">{p.env}</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      {/* Account menu */}
      {accountOpen ? (
        <div className="fixed bottom-16 left-3 z-[70] w-52 overflow-hidden rounded border border-outline-variant/40 bg-surface-container-lowest shadow-xl">
          <button
            type="button"
            onClick={() => {
              setAccountOpen(false);
              logout();
              navigate('/login', { replace: true });
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left font-body-sm text-body-sm text-on-surface-variant hover:bg-surface-container"
          >
            <span className="material-symbols-outlined text-[16px]">logout</span>
            Sign out
          </button>
        </div>
      ) : null}

      {/* Backdrop for popovers */}
      {notifOpen || projectOpen || accountOpen ? (
        <button
          type="button"
          aria-label="Close menus"
          className="fixed inset-0 z-[60] cursor-default bg-transparent"
          onClick={() => {
            setNotifOpen(false);
            setProjectOpen(false);
            setAccountOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

export { PROJECTS };
