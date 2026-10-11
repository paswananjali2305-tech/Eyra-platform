import { useCallback, useEffect, useMemo, useState } from 'react';
import { CodeEditor } from '../../components/ide/CodeEditor.jsx';
import { FileExplorer } from '../../components/ide/FileExplorer.jsx';
import { FileTabBar } from '../../components/ide/FileTabBar.jsx';
import { useEyra } from '../../context/EyraContext.jsx';
import { mapTrendsFromScans, resolveAuditWorkspace } from '../../lib/auditScanMap.js';
import { useOpenTabs } from '../../hooks/useOpenTabs.js';

const NEW_FILE_TEMPLATE = `# Scratch file for audit notes / repro

def main():
    pass
`;

const FALLBACK_PARTIALS = [
  {
    id: 'pf-mfa',
    file: 'auth/jwt_handler.py',
    line: 22,
    type: 'TODO',
    risk: 'High',
    effort: '4h',
    description: 'Multi-Factor Authentication step stubbed before token issue',
  },
  {
    id: 'pf-refund',
    file: 'routes/payment.py',
    line: 48,
    type: 'NotImplemented',
    risk: 'High',
    effort: '6h',
    description: 'Refund webhook handler returns 501',
  },
  {
    id: 'pf-rate',
    file: 'auth/oauth_provider.py',
    line: 31,
    type: 'Stub',
    risk: 'Medium',
    effort: '3h',
    description: 'OAuth rate-limit middleware placeholder',
  },
  {
    id: 'pf-notify',
    file: 'services/notification.py',
    line: 12,
    type: 'TODO',
    risk: 'Medium',
    effort: '2h',
    description: 'Push notification provider not wired',
  },
];

const FALLBACK_TRENDS = [
  { label: 'Today', critical: 2, high: 4, medium: 5, score: 72 },
  { label: 'Yesterday', critical: 3, high: 5, medium: 6, score: 64 },
  { label: '3 days ago', critical: 4, high: 6, medium: 7, score: 58 },
  { label: 'Last week', critical: 5, high: 8, medium: 9, score: 51 },
];

/**
 * Code Audit — VS Code explorer + clickable section tabs + editor + AST proof.
 */
export function AuditCodeWorkspace() {
  const { activeScan, scanList, refreshScan, activeScanId, refreshScanList, showToast } = useEyra();

  useEffect(() => {
    refreshScanList();
    if (activeScanId) refreshScan(activeScanId);
  }, [activeScanId, refreshScan, refreshScanList]);

  const workspace = useMemo(() => resolveAuditWorkspace(activeScan), [activeScan]);
  const {
    usingLive,
    fileContents,
    repoTree,
    defaultFolders,
    projectLabel,
    findings,
    partials: livePartials,
    dependencies: liveDeps,
  } = workspace;

  const partials = livePartials || FALLBACK_PARTIALS;
  const deps = useMemo(() => {
    if (liveDeps) return liveDeps;
    return findings.filter((f) => String(f.cwe || f.title || '').includes('CVE'));
  }, [liveDeps, findings]);

  const liveTrends = useMemo(() => mapTrendsFromScans(scanList), [scanList]);
  const trendPoints = liveTrends || FALLBACK_TRENDS;

  const tabs = useMemo(
    () => [
      { id: 'overview', label: 'Overview' },
      { id: 'issues', label: `Issues (${findings.length})` },
      { id: 'heatmap', label: 'File Heatmap & Code' },
      { id: 'partials', label: `Partial Features (${partials.length})` },
      { id: 'deps', label: `Dependencies & CVEs (${deps.length})` },
      { id: 'trends', label: 'Trend History' },
    ],
    [findings.length, partials.length, deps.length],
  );

  const [section, setSection] = useState('heatmap');
  const [openFolders, setOpenFolders] = useState(() => new Set(defaultFolders));
  const initialTabs = useMemo(() => {
    const flagged = findings.slice(0, 3).map((f) => f.path).filter(Boolean);
    if (flagged.length) return flagged;
    return Object.keys(fileContents).slice(0, 3);
  }, [findings, fileContents]);

  const { openTabs, activeId, setActiveId, openFile, closeTab } = useOpenTabs(initialTabs);
  const [copied, setCopied] = useState(false);
  const [scratchFiles, setScratchFiles] = useState({});
  const [scratchSeq, setScratchSeq] = useState(1);
  /** Explicit finding chosen from Issues list (may differ from primary file finding). */
  const [selectedFinding, setSelectedFinding] = useState(null);

  useEffect(() => {
    setOpenFolders(new Set(defaultFolders));
  }, [defaultFolders]);

  useEffect(() => {
    if (!initialTabs.length) return;
    initialTabs.forEach((p) => openFile(p));
    setSelectedFinding(null);
  }, [usingLive, activeScan?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const isScratch = Boolean(activeId && scratchFiles[activeId]);
  const file = isScratch
    ? scratchFiles[activeId]
    : fileContents[activeId] || Object.values(fileContents)[0];
  const finding = useMemo(() => {
    if (isScratch) return null;
    if (selectedFinding && selectedFinding.path === activeId) return selectedFinding;
    return file?.finding || null;
  }, [isScratch, selectedFinding, activeId, file?.finding]);

  const editorLines = useMemo(() => {
    if (isScratch || !file) return undefined;
    const text =
      file.text != null
        ? String(file.text)
        : (file.lines || []).map((l) => (typeof l === 'string' ? l : l?.text ?? '')).join('\n');
    const parts = text.length ? text.split('\n') : [''];
    const hl = finding?.line != null ? Number(finding.line) : null;
    return parts.map((t, i) => ({
      n: i + 1,
      text: t,
      crash: hl != null && i + 1 === hl,
    }));
  }, [isScratch, file, finding?.line]);

  const tabItems = useMemo(
    () =>
      openTabs.map((id) => ({
        id,
        name: id.split('/').pop(),
        dirty: scratchFiles[id] ? true : fileContents[id]?.dirty,
        severity: scratchFiles[id]
          ? null
          : fileContents[id]?.finding
            ? String(fileContents[id].finding.severity || 'critical').toLowerCase()
            : null,
      })),
    [openTabs, scratchFiles, fileContents],
  );

  const dirtyIds = useMemo(() => {
    const set = new Set();
    for (const id of openTabs) {
      if (scratchFiles[id] || fileContents[id]?.dirty) set.add(id);
    }
    return set;
  }, [openTabs, scratchFiles, fileContents]);

  function toggleFolder(id) {
    setOpenFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const openFinding = useCallback(
    (path, issue = null) => {
      if (!path || !fileContents[path]) {
        showToast?.('Source file not available for this finding', 'info');
        return;
      }
      openFile(path);
      if (issue) {
        setSelectedFinding({ ...issue, path });
      } else {
        const primary = fileContents[path]?.finding;
        setSelectedFinding(primary ? { path, ...primary } : null);
      }
      if (fileContents[path]?._snippetOnly) {
        showToast?.('Showing snippet-only content — full file body was not in scan payload', 'info');
      }
      setSection('heatmap');
    },
    [openFile, fileContents, showToast],
  );

  const addNewFile = useCallback(() => {
    const id = `scratch/untitled-${scratchSeq}.py`;
    setScratchSeq((n) => n + 1);
    setScratchFiles((prev) => ({
      ...prev,
      [id]: {
        language: 'Python 3.11',
        dirty: true,
        finding: null,
        text: NEW_FILE_TEMPLATE,
      },
    }));
    openFile(id);
    setSection('heatmap');
  }, [openFile, scratchSeq]);

  const handleClose = useCallback(
    (id) => {
      closeTab(id);
      if (scratchFiles[id]) {
        setScratchFiles((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }
    },
    [closeTab, scratchFiles],
  );

  async function copyDiff() {
    if (!finding?.patch) {
      showToast?.('No suggested patch diff for this finding', 'info');
      return;
    }
    try {
      await navigator.clipboard.writeText(finding.patch);
      setCopied(true);
      showToast?.('Patch diff copied — not applied to the scanned tree', 'info');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      showToast?.('Clipboard blocked', 'error');
    }
  }

  const critical = findings.filter((f) => /critical/i.test(f.severity || f.title || '')).length;
  const high = findings.filter((f) => /high/i.test(f.severity || f.title || '')).length;

  return (
    <div className="flex h-[calc(100vh-3.5rem)] w-full flex-col overflow-hidden select-none">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-space-sm border-b border-outline-variant/20 bg-surface-container-lowest px-space-md py-space-sm">
        <div className="flex min-w-0 flex-wrap items-center gap-space-sm">
          <span
            className={`rounded border px-2 py-0.5 font-label-sm text-label-sm font-semibold ${
              usingLive
                ? 'border-primary/30 bg-primary-container/15 text-primary'
                : 'border-outline-variant/40 bg-surface-container text-on-surface-variant'
            }`}
          >
            {usingLive ? 'AST-ACTIVE · LIVE' : 'DEMO FALLBACK'}
          </span>
          <span className="truncate font-code-compact text-code-compact text-on-surface-variant">
            {projectLabel} · {Object.keys(fileContents).length} files
            {usingLive ? '' : ' · mockRepo'}
          </span>
        </div>
        <span className="rounded bg-error-container/35 px-2 py-0.5 font-label-sm text-label-sm font-semibold text-error">
          {findings.length} Vulnerabilities Total
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-space-2xs overflow-x-auto border-b border-outline-variant/20 bg-surface-container-lowest px-space-md py-space-xs">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSection(t.id)}
            className={`whitespace-nowrap rounded px-3 py-1.5 font-label-md text-label-md transition-colors ${
              section === t.id
                ? 'bg-primary-container/20 font-semibold text-primary shadow-sm'
                : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {section === 'overview' ? (
        <OverviewPanel
          findings={findings}
          critical={critical}
          high={high}
          partials={partials.length}
          deps={deps.length}
          onOpenHeatmap={() => setSection('heatmap')}
          onOpenIssues={() => setSection('issues')}
        />
      ) : null}

      {section === 'issues' ? (
        <IssueList findings={findings} onOpen={openFinding} usingLive={usingLive} />
      ) : null}

      {section === 'partials' ? (
        <PartialList items={partials} onOpen={openFinding} demo={!livePartials} />
      ) : null}

      {section === 'deps' ? (
        <DepsList items={deps} onOpen={openFinding} usingLive={usingLive} />
      ) : null}

      {section === 'trends' ? <TrendPanel points={trendPoints} demo={!liveTrends} /> : null}

      {section === 'heatmap' ? (
        <>
          <div className="flex min-h-0 flex-1 overflow-hidden bg-surface-container-lowest">
            <FileExplorer
              tree={repoTree}
              open={openFolders}
              selected={activeId}
              onToggle={toggleFolder}
              onSelect={openFile}
            />

            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
              <FileTabBar
                tabs={tabItems}
                activeId={activeId}
                dirtyIds={dirtyIds}
                onSelect={setActiveId}
                onClose={handleClose}
                onAdd={addNewFile}
              />
              {activeId && file ? (
                <CodeEditor
                  path={activeId}
                  language={file.language}
                  lines={isScratch ? undefined : editorLines}
                  editable={isScratch}
                  value={isScratch ? file.text : undefined}
                  onChange={
                    isScratch
                      ? (text) =>
                          setScratchFiles((prev) => ({
                            ...prev,
                            [activeId]: { ...prev[activeId], text, dirty: true },
                          }))
                      : undefined
                  }
                  findingLine={finding?.line}
                  findingLabel={finding?.title}
                metaRight={
                  <>
                    <span className="rounded bg-surface-container px-1.5 py-0.5 font-label-sm text-[10px] text-tertiary">
                      {isScratch
                        ? 'Scratch'
                        : file?._snippetOnly
                          ? 'Snippet only'
                          : usingLive
                            ? 'Live scan file'
                            : 'Tree-sitter AST Parsed'}
                    </span>
                    <span className="font-label-sm text-label-sm text-outline">{file.language}</span>
                  </>
                }
                />
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 font-body-sm text-body-sm text-outline">
                  <span>Open a file from the explorer or add a new tab</span>
                  <button
                    type="button"
                    onClick={addNewFile}
                    className="flex items-center gap-1 rounded bg-primary-container px-3 py-1 font-label-md text-label-md font-semibold text-on-primary-container"
                  >
                    <span className="material-symbols-outlined text-[16px]">add</span>
                    New code file
                  </button>
                </div>
              )}
            </div>

            <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-outline-variant/25 bg-surface-container-low 2xl:w-96">
              {finding ? (
                <>
                  <div className="border-b border-outline-variant/20 bg-surface-container-lowest p-space-sm">
                    <div className="flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[16px] text-error">gpp_maybe</span>
                      <span className="font-headline-sm text-headline-sm font-semibold text-on-surface">
                        AST Static Security Proof
                      </span>
                    </div>
                    <span className="mt-1 inline-flex rounded bg-error-container/40 px-1.5 py-0.5 font-label-sm text-[10px] font-semibold uppercase text-error">
                      {finding.cwe}
                    </span>
                  </div>
                  <div className="flex flex-col gap-space-md p-space-md">
                    <div className="flex flex-col gap-1.5">
                      <span className="font-label-sm text-label-sm uppercase text-outline">Finding</span>
                      <p className="font-body-md text-body-md leading-snug text-on-surface">
                        {finding.summary}
                      </p>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <span className="font-label-sm text-label-sm uppercase text-outline">Impact</span>
                      <p className="font-body-sm text-body-sm text-on-surface-variant">{finding.impact}</p>
                    </div>
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center justify-between">
                        <span className="font-label-sm text-label-sm uppercase text-outline">
                          AI-Generated Patch
                        </span>
                      </div>
                      <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-surface-container-lowest p-2 font-code-compact text-code-compact text-on-surface-variant">
                        {finding.patch}
                      </pre>
                    </div>
                    <div className="flex flex-col gap-2 pt-1">
                      <button
                        type="button"
                        onClick={copyDiff}
                        className="flex w-full items-center justify-center gap-2 rounded bg-surface-container-high px-space-sm py-2 font-label-sm text-label-sm font-semibold text-on-surface hover:bg-surface-bright"
                      >
                        <span className="material-symbols-outlined text-[15px] text-primary">
                          content_copy
                        </span>
                        {copied ? 'Copied Diff' : 'Copy Unified Diff'}
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 p-space-lg text-center">
                  <span className="material-symbols-outlined text-[28px] text-tertiary">verified</span>
                  <p className="font-headline-sm text-headline-sm text-on-surface">No findings</p>
                  <p className="font-body-sm text-body-sm text-on-surface-variant">
                    This file passed AST static checks. Open a flagged file from the explorer.
                  </p>
                </div>
              )}
            </aside>
          </div>

          <footer className="flex shrink-0 flex-wrap items-center justify-between gap-space-sm border-t border-outline-variant/20 bg-surface-container-lowest px-space-md py-1.5 font-code-compact text-code-compact text-outline">
            <div className="flex flex-wrap items-center gap-space-md">
              <span>
                Parser: <span className="text-on-surface-variant">{file?.language || '—'}</span>
              </span>
              <span>
                File: <span className="text-primary">{activeId}</span>
              </span>
              {finding ? (
                <span>
                  Cursor: <span className="text-primary">Ln {finding.line}</span>
                </span>
              ) : null}
            </div>
            {finding ? (
              <span className="text-error">{finding.title}</span>
            ) : (
              <span className="text-tertiary">Clean</span>
            )}
          </footer>
        </>
      ) : null}
    </div>
  );
}

function OverviewPanel({ findings, critical, high, partials, deps, onOpenHeatmap, onOpenIssues }) {
  return (
    <div className="flex flex-1 flex-col gap-space-md overflow-auto p-space-xl">
      <div>
        <h2 className="font-headline-sm text-headline-sm font-semibold text-on-surface">
          Audit overview
        </h2>
        <p className="mt-1 font-body-sm text-body-sm text-on-surface-variant">
          Snapshot of static findings across the loaded codebase.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Total issues', value: findings.length, tone: 'text-error' },
          { label: 'Critical / High', value: `${critical} / ${high}`, tone: 'text-secondary' },
          { label: 'Partial features', value: partials, tone: 'text-primary' },
          { label: 'CVE deps', value: deps, tone: 'text-on-surface' },
        ].map((card) => (
          <div
            key={card.label}
            className="rounded border border-outline-variant/25 bg-surface-container-low p-space-md"
          >
            <div className="font-label-sm text-label-sm uppercase text-outline">{card.label}</div>
            <div className={`mt-1 font-headline-sm text-headline-sm font-semibold ${card.tone}`}>
              {card.value}
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onOpenIssues}
          className="rounded bg-surface-container-high px-space-md py-2 font-label-md text-label-md text-on-surface"
        >
          Browse issues
        </button>
        <button
          type="button"
          onClick={onOpenHeatmap}
          className="rounded bg-primary-container px-space-md py-2 font-label-md text-label-md font-semibold text-on-primary-container"
        >
          Open File Heatmap &amp; Code
        </button>
      </div>
    </div>
  );
}

function IssueList({ findings, onOpen, usingLive }) {
  if (!findings.length) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-space-xl text-center">
        <span className="material-symbols-outlined text-[28px] text-tertiary">verified</span>
        <p className="font-body-sm text-body-sm text-on-surface-variant">
          {usingLive ? 'Live scan returned no issues.' : 'No findings in demo fallback tree.'}
        </p>
      </div>
    );
  }
  return (
    <div className="flex-1 overflow-auto p-space-md">
      <ul className="flex flex-col gap-1">
        {findings.map((iss) => (
          <li key={`${iss.path}:${iss.line}:${iss.id || iss.title}`}>
            <button
              type="button"
              onClick={() => onOpen(iss.path, iss)}
              className="flex w-full flex-col gap-0.5 rounded bg-surface-container-low px-3 py-2 text-left hover:bg-surface-container"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-label-md text-label-md font-semibold text-on-surface">
                  {iss.title}
                </span>
                <span className="font-label-sm text-label-sm text-error">{iss.cwe}</span>
              </div>
              <span className="font-code-compact text-code-compact text-outline">
                {iss.path}:{iss.line}
                {iss.severity ? ` · ${iss.severity}` : ''}
              </span>
              <span className="font-body-sm text-body-sm text-on-surface-variant">{iss.summary}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PartialList({ items, onOpen, demo }) {
  return (
    <div className="flex-1 overflow-auto p-space-md">
      {demo ? (
        <p className="mb-2 font-label-sm text-label-sm text-outline">Demo fallback partials (no live list)</p>
      ) : null}
      <ul className="flex flex-col gap-1">
        {items.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onOpen(p.file)}
              className="flex w-full flex-col gap-0.5 rounded bg-surface-container-low px-3 py-2 text-left hover:bg-surface-container"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-label-md text-label-md font-semibold text-on-surface">
                  {p.description}
                </span>
                <span className="font-label-sm text-label-sm text-secondary">{p.risk}</span>
              </div>
              <span className="font-code-compact text-code-compact text-outline">
                {p.file}:{p.line} · {p.type} · ~{p.effort}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DepsList({ items, onOpen, usingLive }) {
  if (!items.length) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-space-xl text-center">
        <span className="material-symbols-outlined text-[28px] text-tertiary">verified</span>
        <p className="font-body-sm text-body-sm text-on-surface-variant">
          {usingLive ? 'No vulnerable dependencies in this scan.' : 'No CVE findings in demo fallback.'}
        </p>
      </div>
    );
  }
  return (
    <div className="flex-1 overflow-auto p-space-md">
      <ul className="flex flex-col gap-1">
        {items.map((d) => (
          <li key={`${d.path}:${d.cwe}`}>
            <button
              type="button"
              onClick={() => (d.package ? undefined : onOpen(d.path))}
              className="flex w-full flex-col gap-0.5 rounded bg-surface-container-low px-3 py-2 text-left hover:bg-surface-container"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-label-md text-label-md font-semibold text-on-surface">{d.title}</span>
                <span className="font-label-sm text-label-sm text-error">{d.cwe}</span>
              </div>
              <span className="font-code-compact text-code-compact text-outline">
                {d.path}:{d.line}
              </span>
              <span className="font-body-sm text-body-sm text-on-surface-variant">{d.summary}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TrendPanel({ points, demo }) {
  return (
    <div className="flex flex-1 flex-col gap-space-md overflow-auto p-space-xl">
      <div>
        <h2 className="font-headline-sm text-headline-sm font-semibold text-on-surface">Trend history</h2>
        <p className="mt-1 font-body-sm text-body-sm text-on-surface-variant">
          {demo
            ? 'Demo trend points — live scores appear after multiple scans.'
            : 'Recent audit health scores from the scan list.'}
        </p>
      </div>
      <ul className="flex flex-col gap-2">
        {points.map((p) => (
          <li
            key={p.label}
            className="flex flex-wrap items-center justify-between gap-2 rounded border border-outline-variant/25 bg-surface-container-low px-3 py-3"
          >
            <span className="font-label-md text-label-md font-semibold text-on-surface">{p.label}</span>
            <span className="font-code-compact text-code-compact text-on-surface-variant">
              score {p.score} · C{p.critical} H{p.high} M{p.medium}
            </span>
            <div className="h-1.5 w-full overflow-hidden rounded bg-surface-container-highest">
              <div
                className="h-full bg-primary-container"
                style={{ width: `${Math.min(100, p.score)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
