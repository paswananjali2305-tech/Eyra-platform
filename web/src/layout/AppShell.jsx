import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { PROJECTS, ShellOverlays } from '../components/ShellOverlays.jsx';
import { useAuth } from '../context/AuthContext';
import { useEyra } from '../context/EyraContext';
import { api } from '../api/client.js';
import { launchOpenExtension } from '../lib/openExtension.js';
import { AuditOverviewPage } from '../pages/audit/AuditOverviewPage.jsx';
import { AuditIngestPage } from '../pages/audit/AuditIngestPage.jsx';
import { AuditProgressPage } from '../pages/audit/AuditProgressPage.jsx';
import { AuditCodePage } from '../pages/audit/AuditCodePage.jsx';
import { HistoryPage } from '../pages/HistoryPage.jsx';
import { ConfigPage } from '../pages/ConfigPage.jsx';

const RUNTIME_NAV = [
  { to: '/', end: true, label: 'Overview' },
  { to: '/workspace', label: 'Debugging Workspace', badge: 'active' },
  { to: '/analysis', label: 'Code Performance & Test Analysis' },
  { to: '/memory', label: 'Memory & Knowledge' },
  { to: '/history', label: 'Investigation History' },
  { to: '/config', label: 'Configuration & Projects' },
];

const AUDIT_NAV = [
  { view: 'overview', label: 'Codebase Intelligence', badge: 'ast' },
  { view: 'ingest', label: 'Ingest & Configure' },
  { view: 'progress', label: 'Live Audit Progress' },
  { view: 'code', label: 'Code Audit' },
  { view: 'history', label: 'Investigation History' },
  { view: 'config', label: 'Configuration & Projects' },
];

function navClass(isActive) {
  return `flex items-center justify-between gap-space-sm px-space-sm py-1.5 rounded transition-colors font-body-sm text-body-sm ${
    isActive
      ? 'bg-surface-container-high text-primary border-l-2 border-primary-container font-medium'
      : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
  }`;
}

function AuditMain({ auditView }) {
  if (auditView === 'ingest') return <AuditIngestPage />;
  if (auditView === 'progress') return <AuditProgressPage />;
  if (auditView === 'code') return <AuditCodePage />;
  if (auditView === 'history') return <HistoryPage />;
  if (auditView === 'config') return <ConfigPage />;
  return <AuditOverviewPage />;
}

export function AppShell() {
  const {
    status,
    statusLoading,
    activeResult,
    mode,
    setMode,
    auditView,
    setAuditView,
    notifications,
    activeScan,
    showToast,
  } = useEyra();
  const { displayName, initials, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const backendOk = Boolean(status?.healthy);
  const unread = useMemo(
    () => (notifications || []).filter((n) => !n.read).length,
    [notifications],
  );
  const accountLabel = displayName || user?.username || 'User';
  const accountHandle = user?.username ? `@${user.username}` : 'Signed in';

  const [searchOpen, setSearchOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [project, setProject] = useState(PROJECTS[0] || { id: '', label: 'No project', env: '—' });
  const searchInputRef = useRef(null);
  const headerSearchRef = useRef(null);

  useEffect(() => {
    document.title =
      mode === 'audit'
        ? 'EYRA — Codebase Audit'
        : 'EYRA — Intelligent Runtime Debugging Agent';
  }, [mode]);

  // Keep sidebar project label in sync with the active audit scan.
  useEffect(() => {
    const name = activeScan?.projectName || activeScan?.archiveName;
    if (!name || mode !== 'audit') return;
    setProject((prev) => {
      if (prev?.label === name && prev?.env === 'audit') return prev;
      return { id: name, label: name, env: 'audit' };
    });
  }, [mode, activeScan?.id, activeScan?.projectName, activeScan?.archiveName]);

  useEffect(() => {
    if (!location.pathname.startsWith('/audit')) return;
    setMode('audit');
    if (location.pathname.includes('ingest')) setAuditView('ingest');
    else if (location.pathname.includes('progress')) setAuditView('progress');
    else if (location.pathname.includes('code')) setAuditView('code');
    else setAuditView('overview');
    navigate('/', { replace: true });
  }, [location.pathname, navigate, setMode, setAuditView]);

  function switchMode(next) {
    setMode(next);
    if (next === 'audit') setAuditView('overview');
  }

  async function onOpenExtension() {
    showToast?.('Opening EYRA in VS Code…', 'info');
    const result = await launchOpenExtension({
      editor: 'vscode',
      openViaBrain: (body) => api.openExtension(body),
    });
    if (!result.ok) {
      showToast?.(result.reason || 'Could not open EYRA in VS Code.', 'error');
      return;
    }
    showToast?.(result.message || 'Opened EYRA in VS Code.', 'info');
  }

  return (
    <div className="min-h-screen bg-background font-body-md text-body-md text-on-surface antialiased">
      <aside className="fixed left-0 top-0 z-50 flex h-full w-60 select-none flex-col justify-between border-r border-outline-variant/30 bg-surface-container-lowest">
        <div className="flex min-h-0 flex-col">
          <div className="border-b border-outline-variant/20 px-space-md pb-space-sm pt-space-md">
            <div className="flex items-center gap-space-sm">
              <div className="flex h-6 w-6 items-center justify-center rounded bg-primary-container text-on-primary-container shadow-[0_0_12px_rgba(53,214,242,0.35)]">
                <span className="material-symbols-outlined text-[16px]">terminal</span>
              </div>
              <div className="flex items-baseline gap-space-xs">
                <span className="font-headline-sm text-headline-sm font-semibold tracking-tight text-on-surface">
                  EYRA
                </span>
                <span className="rounded border border-outline-variant/30 bg-surface-container-high px-1.5 py-0.5 font-label-sm text-label-sm text-primary">
                  v1.0-unified
                </span>
              </div>
            </div>
            <button
              type="button"
              id="eyra-sidebar-project"
              aria-haspopup="listbox"
              aria-expanded={projectOpen}
              onClick={() => {
                setProjectOpen((v) => !v);
                setAccountOpen(false);
                setNotifOpen(false);
              }}
              className="mt-space-sm flex h-9 w-full cursor-pointer items-center justify-between gap-2 rounded border border-outline-variant/30 bg-surface-container-low px-2 text-left text-on-surface-variant transition-colors hover:border-outline hover:text-on-surface"
            >
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="material-symbols-outlined shrink-0 text-[14px] text-primary">
                  deployed_code
                </span>
                <span className="truncate font-code-compact text-code-compact text-on-surface">
                  {project.id && project.env && project.env !== '—' ? (
                    <>
                      <span className="text-outline">{project.env}/</span>
                      {project.label}
                    </>
                  ) : (
                    project.label || 'No project'
                  )}
                </span>
              </div>
              <span className="material-symbols-outlined shrink-0 text-[14px] text-outline">
                unfold_more
              </span>
            </button>
          </div>

          <div className="overflow-y-auto px-space-xs py-space-sm">
            <div className="px-space-sm py-1 font-label-sm text-label-sm uppercase tracking-wider text-outline">
              {mode === 'audit' ? 'Audit Control' : 'Unified Control'}
            </div>
            <nav className="mt-1 flex flex-col gap-space-2xs">
              {mode === 'audit'
                ? AUDIT_NAV.map((item) => {
                    const active = auditView === item.view;
                    return (
                      <button
                        key={item.view}
                        type="button"
                        onClick={() => setAuditView(item.view)}
                        className={`w-full text-left ${navClass(active)}`}
                      >
                        <span>{item.label}</span>
                        {item.badge === 'ast' ? (
                          <span className="rounded border border-primary/30 bg-primary-container/15 px-1.5 py-0.5 font-label-sm text-label-sm text-primary">
                            AST-LIVE
                          </span>
                        ) : null}
                      </button>
                    );
                  })
                : RUNTIME_NAV.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end === true}
                      className={({ isActive }) => navClass(isActive)}
                    >
                      <span className="min-w-0 leading-snug">{item.label}</span>
                      {item.badge === 'active' && activeResult ? (
                        <span className="rounded border border-tertiary/20 bg-tertiary-container/15 px-1.5 py-0.5 font-label-sm text-label-sm text-tertiary">
                          1 active
                        </span>
                      ) : null}
                    </NavLink>
                  ))}
            </nav>
          </div>
        </div>

        <div className="flex flex-col gap-space-xs border-t border-outline-variant/30 bg-surface-container-lowest/80 p-space-sm">
          {/* Brain / Mode status pill — hidden per UI cleanup */}
          <div className="hidden flex-col gap-1 rounded border border-outline-variant/20 bg-surface-container-low p-1.5">
            <div className="flex items-center justify-between font-code-compact text-code-compact text-on-surface-variant">
              <div className="flex items-center gap-1.5">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    statusLoading ? 'bg-warning' : backendOk ? 'animate-pulse bg-tertiary' : 'bg-error'
                  }`}
                />
                <span>Brain</span>
              </div>
              <span className={`font-label-sm text-label-sm ${backendOk ? 'text-tertiary' : 'text-error'}`}>
                {backendOk ? status?.version || 'ok' : 'down'}
              </span>
            </div>
            <div className="flex items-center justify-between font-code-compact text-code-compact text-on-surface-variant">
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-secondary" />
                <span>Mode</span>
              </div>
              <span className="font-label-sm text-label-sm text-secondary">{mode}</span>
            </div>
          </div>
          <div className="flex items-center justify-between rounded border border-outline-variant/20 bg-surface-container/60 p-1">
            <button
              type="button"
              onClick={() => {
                setAccountOpen((v) => !v);
                setProjectOpen(false);
                setNotifOpen(false);
              }}
              className="flex min-w-0 flex-1 items-center gap-space-xs rounded px-1 py-0.5 text-left hover:bg-surface-container"
            >
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-primary font-label-sm text-label-sm font-semibold text-on-primary">
                {initials}
              </div>
              <div className="truncate">
                <div className="truncate font-code-compact text-code-compact leading-tight text-on-surface">
                  {accountLabel}
                </div>
                <div className="truncate font-label-sm text-label-sm leading-tight text-outline">
                  {accountHandle}
                </div>
              </div>
            </button>
            <button
              type="button"
              aria-label="Account settings"
              onClick={() => {
                setAccountOpen((v) => !v);
                setProjectOpen(false);
                setNotifOpen(false);
              }}
              className="shrink-0 rounded p-1 text-outline transition-colors hover:bg-surface-container-high hover:text-on-surface"
            >
              <span className="material-symbols-outlined text-[16px]">more_vert</span>
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-h-screen flex-col pl-60">
        <header className="fixed left-60 right-0 top-0 z-40 grid h-14 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-space-sm border-b border-outline-variant/30 bg-surface-container-lowest/90 px-space-md backdrop-blur">
          <div className="flex min-w-0 items-center gap-space-sm justify-self-start">
            <div className="hidden items-center gap-2 font-label-sm text-label-sm leading-none text-outline xl:flex">
              <span className="text-primary">EYRA</span>
              <span className="text-outline-variant">v1.0-unified</span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-space-xs justify-self-center sm:gap-space-sm">
            <div className="flex items-center rounded bg-surface-container p-0.5">
              <button
                type="button"
                onClick={() => switchMode('runtime')}
                className={`rounded px-2.5 py-1 font-label-md text-label-md whitespace-nowrap transition-colors sm:px-3 ${
                  mode === 'runtime'
                    ? 'bg-primary-container text-on-primary-container shadow-[0_0_12px_rgba(53,214,242,0.25)]'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                Runtime Debugging
              </button>
              <button
                type="button"
                onClick={() => switchMode('audit')}
                className={`rounded px-2.5 py-1 font-label-md text-label-md whitespace-nowrap transition-colors sm:px-3 ${
                  mode === 'audit'
                    ? 'bg-primary-container text-on-primary-container shadow-[0_0_12px_rgba(53,214,242,0.25)]'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                Codebase Audit
              </button>
            </div>
            <button
              type="button"
              onClick={() => onOpenExtension()}
              title="Install the local EYRA VSIX into VS Code and open it"
              aria-label="Open Extension in VS Code"
              className="flex h-7 items-center gap-1.5 rounded border border-outline-variant/30 bg-surface-container-low px-2 font-label-md text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
            >
              <span className="material-symbols-outlined text-[15px] text-primary">extension</span>
              <span className="hidden whitespace-nowrap sm:inline">Open Extension</span>
            </button>
          </div>

          <div className="flex min-w-0 items-center justify-end gap-space-xs justify-self-end sm:gap-space-sm">
            <button
              type="button"
              onClick={() => {
                setSearchOpen(true);
                setNotifOpen(false);
              }}
              className="relative hidden items-center md:flex"
            >
              <span className="material-symbols-outlined pointer-events-none absolute left-2 text-[15px] text-outline">
                search
              </span>
              <input
                ref={headerSearchRef}
                readOnly
                onFocus={() => setSearchOpen(true)}
                className="w-36 cursor-pointer rounded border border-outline-variant/40 bg-surface-container-lowest py-1 pl-7 pr-10 font-code-compact text-code-compact text-on-surface placeholder:text-outline lg:w-48 xl:w-56"
                placeholder={mode === 'audit' ? 'Search symbols...' : 'Query symbols, traces...'}
                type="text"
              />
              <kbd className="pointer-events-none absolute right-2 rounded border border-outline-variant/40 bg-surface-container-high px-1 py-0.5 font-label-sm text-label-sm text-outline">
                ⌘K
              </kbd>
            </button>
            <button
              type="button"
              aria-label="Notifications"
              onClick={() => {
                setNotifOpen((v) => !v);
                setProjectOpen(false);
                setAccountOpen(false);
              }}
              className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded border border-outline-variant/30 bg-surface-container-low text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
            >
              <span className="material-symbols-outlined text-[16px]">notifications</span>
              {unread > 0 ? (
                <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-error" />
              ) : null}
            </button>
            <button
              type="button"
              onClick={() => {
                setAccountOpen((v) => !v);
                setNotifOpen(false);
                setProjectOpen(false);
              }}
              className="flex shrink-0 items-center gap-1.5 rounded border border-outline-variant/30 bg-surface-container-low px-1.5 py-0.5 hover:bg-surface-container"
            >
              <div className="flex h-6 w-6 items-center justify-center rounded bg-primary font-label-sm text-label-sm font-semibold text-on-primary">
                {initials}
              </div>
              <div className="hidden font-code-compact text-code-compact leading-tight xl:block">
                <div className="text-on-surface">{accountLabel}</div>
                <div className="text-outline">{accountHandle}</div>
              </div>
            </button>
          </div>
        </header>
        <main className="w-full min-h-screen bg-background pt-14">
          {mode === 'audit' ? <AuditMain auditView={auditView} /> : <Outlet />}
        </main>
      </div>

      <ShellOverlays
        searchOpen={searchOpen}
        setSearchOpen={setSearchOpen}
        notifOpen={notifOpen}
        setNotifOpen={setNotifOpen}
        projectOpen={projectOpen}
        setProjectOpen={setProjectOpen}
        accountOpen={accountOpen}
        setAccountOpen={setAccountOpen}
        project={project}
        setProject={setProject}
        searchInputRef={searchInputRef}
      />
    </div>
  );
}
