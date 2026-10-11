import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useEyra } from '../context/EyraContext';

const PROJECTS = [
  { id: 'backend-api', label: 'backend-api', env: 'prod' },
  { id: 'payments-svc', label: 'payments-svc', env: 'staging' },
  { id: 'auth-gateway', label: 'auth-gateway', env: 'prod' },
];

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
  const { mode, setMode, setAuditView, status, notifications, markNotificationsRead, showToast } =
    useEyra();
  const [query, setQuery] = useState('');
  const [historyHits, setHistoryHits] = useState([]);
  const [searching, setSearching] = useState(false);
  const panelRef = useRef(null);

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
          { label: 'Analysis Results', action: () => navigate('/analysis') },
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

      {/* Project menu */}
      {projectOpen ? (
        <div className="fixed left-[15.5rem] top-14 z-[70] w-56 overflow-hidden rounded border border-outline-variant/40 bg-surface-container-lowest shadow-xl lg:left-[16.5rem]">
          {PROJECTS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setProject(p);
                setProjectOpen(false);
                showToast?.(`Switched project to ${p.label}`, 'info');
              }}
              className={`flex w-full items-center justify-between px-3 py-2 text-left font-code-compact text-code-compact hover:bg-surface-container ${
                project.id === p.id ? 'text-primary' : 'text-on-surface'
              }`}
            >
              <span>{p.label}</span>
              <span className="text-outline">{p.env}</span>
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
              if (mode === 'audit') setAuditView('config');
              else navigate('/config');
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left font-body-sm text-body-sm text-on-surface hover:bg-surface-container"
          >
            <span className="material-symbols-outlined text-[16px]">settings</span>
            Configuration
          </button>
          <button
            type="button"
            onClick={() => {
              setAccountOpen(false);
              setMode('runtime');
              navigate('/history');
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left font-body-sm text-body-sm text-on-surface hover:bg-surface-container"
          >
            <span className="material-symbols-outlined text-[16px]">history</span>
            My sessions
          </button>
          <button
            type="button"
            onClick={() => {
              setAccountOpen(false);
              showToast?.('Signed out locally (demo)', 'info');
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
