import { useCallback, useEffect, useMemo, useState } from 'react';
import { CodeEditor } from '../../components/ide/CodeEditor.jsx';
import { FileExplorer } from '../../components/ide/FileExplorer.jsx';
import { FileTabBar } from '../../components/ide/FileTabBar.jsx';
import { PanelResizeHandle } from '../../components/ide/PanelResizeHandle.jsx';
import { useEyra } from '../../context/EyraContext.jsx';
import {
  AUDIT_LANGUAGES,
  languageById,
  languageIdFromPath,
} from '../../lib/auditLanguages.js';
import { LanguageLogo, LanguageSelect } from '../../components/ide/LanguageLogo.jsx';
import {
  annotateTreeSeverity,
  buildRepoTreeFromPaths,
  resolveAuditWorkspace,
} from '../../lib/auditScanMap.js';
import { auditFileText } from '../../lib/liveFileAudit.js';
import {
  applyCorrectedAtFinding,
  buildFixBundle,
  findingKey,
  isFindingStillPresent,
} from '../../lib/patchView.js';
import { dedupeTabIds, useOpenTabs } from '../../hooks/useOpenTabs.js';

const PANEL_LAYOUT_KEY = 'eyra.audit.panelWidths';
const EXPLORER_MIN = 160;
const EXPLORER_MAX = 480;
const CHECK_MIN = 280;
const CHECK_MAX = 720;
const EDITOR_MIN = 280;
const DEFAULT_NEW_LANG = 'JavaScript';

function loadPanelWidths() {
  try {
    const raw = sessionStorage.getItem(PANEL_LAYOUT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.explorer === 'number' &&
      typeof parsed?.check === 'number'
    ) {
      return { explorer: parsed.explorer, check: parsed.check };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

const EDITS_KEY = 'eyra.auditFileEdits';
const RESOLVED_KEY = 'eyra.auditResolvedFindings';
const TABS_KEY = 'eyra.auditOpenTabs';

function scanStorageId(scanId) {
  return scanId || 'demo';
}

function loadPersistedEdits(scanId) {
  try {
    const raw = sessionStorage.getItem(`${EDITS_KEY}:${scanStorageId(scanId)}`);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function persistEdits(scanId, map) {
  try {
    sessionStorage.setItem(`${EDITS_KEY}:${scanStorageId(scanId)}`, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

function loadResolvedKeys(scanId) {
  try {
    const raw = sessionStorage.getItem(`${RESOLVED_KEY}:${scanStorageId(scanId)}`);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function persistResolvedKeys(scanId, set) {
  try {
    sessionStorage.setItem(
      `${RESOLVED_KEY}:${scanStorageId(scanId)}`,
      JSON.stringify([...set]),
    );
  } catch {
    /* ignore */
  }
}

function loadPersistedTabs(scanId) {
  try {
    const raw = sessionStorage.getItem(`${TABS_KEY}:${scanStorageId(scanId)}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const tabs = dedupeTabIds(parsed?.tabs || []);
    if (!tabs.length) return null;
    const activeId =
      parsed?.activeId && tabs.includes(parsed.activeId) ? parsed.activeId : tabs[0];
    return { tabs, activeId };
  } catch {
    return null;
  }
}

function persistTabs(scanId, tabs, activeId) {
  try {
    const next = dedupeTabIds(tabs);
    sessionStorage.setItem(
      `${TABS_KEY}:${scanStorageId(scanId)}`,
      JSON.stringify({
        tabs: next,
        activeId: activeId && next.includes(activeId) ? activeId : next[0] || null,
      }),
    );
  } catch {
    /* ignore */
  }
}

/** Unique file paths from findings first, then file map — never duplicate tabs. */
function buildDefaultTabs(findings, fileContents, max = 3) {
  const flagged = dedupeTabIds((findings || []).map((f) => f.path).filter(Boolean));
  if (flagged.length) return flagged.slice(0, max);
  return dedupeTabIds(Object.keys(fileContents || {})).slice(0, max);
}

function filterTabsToExisting(tabs, fileContents, scratchFiles = {}) {
  return dedupeTabIds(tabs).filter(
    (id) => Boolean(fileContents?.[id]) || Boolean(scratchFiles?.[id]) || id.startsWith('scratch/'),
  );
}

function findingsForFile(file, path) {
  if (!file) return [];
  if (Array.isArray(file.allFindings) && file.allFindings.length) {
    return file.allFindings.map((iss) => ({ ...iss, path: iss.path || path }));
  }
  if (file.finding) return [{ ...file.finding, path: file.finding.path || path }];
  return [];
}

function mergeFindingLists(...lists) {
  const map = new Map();
  for (const list of lists) {
    for (const f of list || []) {
      if (!f) continue;
      map.set(findingKey(f), f);
    }
  }
  return [...map.values()].sort((a, b) => (a.line || 0) - (b.line || 0));
}

/** Compare finding copy so we don't render Finding + Impact twice. */
function normalizeFindingText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[`"'*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Keep scan/demo findings visible until the user applies a fix (resolvedKeys)
 * or edits the file — then re-check with isFindingStillPresent.
 * Avoids false "Clean" when the heuristic mis-reads an untouched finding.
 */
function keepOpenFinding(iss, text, resolvedKeys, fileEdited) {
  const key = findingKey(iss);
  if (resolvedKeys.has(key)) return false;
  if (!fileEdited) return true;
  return isFindingStillPresent(iss, text);
}

function fileBody(file) {
  if (!file) return '';
  if (file.text != null) return String(file.text);
  return (file.lines || [])
    .map((l) => (typeof l === 'string' ? l : l?.text ?? ''))
    .join('\n');
}

/**
 * Code Audit — Issues list + VS Code explorer / editor + AST proof.
 */
export function AuditCodeWorkspace() {
  const {
    activeScan,
    refreshScan,
    activeScanId,
    refreshScanList,
    showToast,
    clearActiveScan,
    setAuditView,
  } = useEyra();
  const [hydrateTimedOut, setHydrateTimedOut] = useState(false);

  useEffect(() => {
    refreshScanList();
    if (activeScanId) refreshScan(activeScanId);
  }, [activeScanId, refreshScan, refreshScanList]);

  /**
   * Wait for stored scan id to hydrate — empty workspace until then (no mockRepo).
   */
  const scanHydrating = Boolean(activeScanId) && activeScan?.id !== activeScanId;

  useEffect(() => {
    if (!scanHydrating) {
      setHydrateTimedOut(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setHydrateTimedOut(true), 14_000);
    return () => window.clearTimeout(timer);
  }, [scanHydrating, activeScanId]);

  const workspace = useMemo(() => {
    if (scanHydrating) return null;
    return resolveAuditWorkspace(activeScan);
  }, [activeScan, scanHydrating]);

  const usingLive = workspace?.usingLive ?? false;
  const fileContents = workspace?.fileContents || {};
  const repoTree = workspace?.repoTree || null;
  const defaultFolders = workspace?.defaultFolders || [];
  const projectLabel = workspace?.projectLabel || '…';
  const findings = workspace?.findings || [];
  /** Stable session key: live scan id when present, else empty shell. */
  const workspaceKey = activeScanId || 'empty';

  const [section, setSection] = useState('heatmap');
  const [openFolders, setOpenFolders] = useState(() => new Set());
  const defaultTabs = useMemo(
    () => buildDefaultTabs(findings, fileContents, 3),
    [findings, fileContents],
  );

  const { openTabs, activeId, setActiveId, openFile, closeTab, replaceTabs } = useOpenTabs([]);
  const [copied, setCopied] = useState(false);
  const [scratchFiles, setScratchFiles] = useState({});
  const [scratchSeq, setScratchSeq] = useState(1);
  /** Per-path language id override (editor dropdown). */
  const [langByPath, setLangByPath] = useState({});
  const [newFileLangId, setNewFileLangId] = useState(DEFAULT_NEW_LANG);
  /** Working buffer + last-saved snapshot for edit/save. */
  const [overrides, setOverrides] = useState({});
  const [savedSnapshot, setSavedSnapshot] = useState({});
  /** Explicit finding chosen from Issues list (may differ from primary file finding). */
  const [selectedFinding, setSelectedFinding] = useState(null);
  /** Findings cleared after Apply + re-check (or confirmed gone in current text). */
  const [resolvedKeys, setResolvedKeys] = useState(() => new Set());
  /** Resizable explorer / Current file check panel widths (px). */
  const [panelWidths, setPanelWidths] = useState(() => {
    const saved = loadPanelWidths();
    return {
      explorer: saved?.explorer ?? 240,
      check: saved?.check ?? 360,
    };
  });

  useEffect(() => {
    try {
      sessionStorage.setItem(PANEL_LAYOUT_KEY, JSON.stringify(panelWidths));
    } catch {
      /* ignore */
    }
  }, [panelWidths]);

  const resizeExplorer = useCallback((dx) => {
    setPanelWidths((prev) => ({
      ...prev,
      explorer: clamp(prev.explorer + dx, EXPLORER_MIN, EXPLORER_MAX),
    }));
  }, []);

  const resizeCheckPanel = useCallback((dx) => {
    setPanelWidths((prev) => ({
      ...prev,
      check: clamp(prev.check - dx, CHECK_MIN, CHECK_MAX),
    }));
  }, []);

  useEffect(() => {
    if (!workspace) return;
    setOpenFolders(new Set(defaultFolders));
  }, [workspaceKey, defaultFolders, workspace]);

  // Restore session for this scan (or unique defaults) — no duplicate tabs.
  // Depend only on workspaceKey so scan polling does not wipe the open session.
  useEffect(() => {
    if (scanHydrating || !workspaceKey) return;
    const persistedTabs = loadPersistedTabs(workspaceKey);
    const restored = persistedTabs
      ? filterTabsToExisting(persistedTabs.tabs, fileContents, {})
      : [];
    const tabs = restored.length ? restored : defaultTabs;
    const active =
      persistedTabs?.activeId && tabs.includes(persistedTabs.activeId)
        ? persistedTabs.activeId
        : tabs[0] || null;
    replaceTabs(tabs, active);
    setSelectedFinding(null);
    setScratchFiles({});
    const persisted = loadPersistedEdits(workspaceKey);
    setOverrides(persisted);
    setSavedSnapshot({ ...persisted });
    // Drop stale "resolved" keys when the issue text is still in the file
    const loadedResolved = loadResolvedKeys(workspaceKey);
    const pruned = new Set();
    for (const key of loadedResolved) {
      const match = findings.find((f) => findingKey(f) === key);
      if (!match) {
        pruned.add(key);
        continue;
      }
      const body =
        persisted[match.path] != null
          ? persisted[match.path]
          : fileBody(fileContents[match.path]);
      if (!isFindingStillPresent(match, body)) pruned.add(key);
    }
    persistResolvedKeys(workspaceKey, pruned);
    setResolvedKeys(pruned);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restore once per scan/demo identity
  }, [workspaceKey, scanHydrating]);

  // Persist open tabs / active file so reload returns where you left off
  useEffect(() => {
    if (!workspace || !openTabs.length) return;
    persistTabs(workspaceKey, openTabs, activeId);
  }, [workspace, workspaceKey, openTabs, activeId]);

  const originalText = useCallback(
    (path) => {
      if (!path) return '';
      if (scratchFiles[path]) return scratchFiles[path].text ?? '';
      return fileBody(fileContents[path]);
    },
    [scratchFiles, fileContents],
  );

  const textForPath = useCallback(
    (path) => {
      if (!path) return '';
      if (overrides[path] != null) return overrides[path];
      return originalText(path);
    },
    [overrides, originalText],
  );

  const editorValue = useMemo(() => {
    if (!activeId) return '';
    return textForPath(activeId);
  }, [activeId, textForPath]);

  const fileDirty = useMemo(() => {
    if (!activeId) return false;
    const baseline =
      savedSnapshot[activeId] != null ? savedSnapshot[activeId] : originalText(activeId);
    return editorValue !== baseline;
  }, [activeId, editorValue, savedSnapshot, originalText]);

  /**
   * Live editor audit — always runs on the current file + open tabs / scratch / edits.
   * Full-repo scan findings still come from Eyraaaa (Ingest → Start scan).
   */
  const editorAuditByPath = useMemo(() => {
    /** @type {Record<string, object[]>} */
    const map = {};
    const paths = new Set(
      [
        ...openTabs,
        ...Object.keys(scratchFiles),
        ...Object.keys(overrides),
        activeId,
      ].filter(Boolean),
    );
    for (const path of paths) {
      const text = textForPath(path);
      if (!String(text || '').trim()) {
        map[path] = [];
        continue;
      }
      const langId = langByPath[path] || languageIdFromPath(path);
      const auditPath = `${path.replace(/\.[^.]+$/, '')}.${languageById(langId).ext}`;
      // Live audit is always computed from current text — only drop user-resolved keys
      map[path] = auditFileText(auditPath, text)
        .map((f) => ({ ...f, path, file: path }))
        .filter((f) => !resolvedKeys.has(findingKey(f)));
    }
    return map;
  }, [openTabs, scratchFiles, overrides, activeId, textForPath, resolvedKeys, langByPath]);

  /** Scan findings still open + live editor findings. */
  const liveFindings = useMemo(() => {
    const fromScan = findings.filter((f) => {
      const path = f.path;
      const edited = overrides[path] != null || Boolean(scratchFiles[path]);
      return keepOpenFinding(f, textForPath(path), resolvedKeys, edited);
    });
    const fromEditor = Object.values(editorAuditByPath).flat();
    return mergeFindingLists(fromScan, fromEditor);
  }, [findings, resolvedKeys, textForPath, editorAuditByPath, overrides, scratchFiles]);

  const effectiveFileContents = useMemo(() => {
    /** @type {Record<string, object>} */
    const out = {};
    for (const [path, f] of Object.entries(fileContents)) {
      const edited = overrides[path] != null || Boolean(scratchFiles[path]);
      const fromScan = findingsForFile(f, path).filter((iss) =>
        keepOpenFinding(iss, textForPath(path), resolvedKeys, edited),
      );
      const remaining = mergeFindingLists(fromScan, editorAuditByPath[path] || []);
      out[path] = {
        ...f,
        allFindings: remaining,
        finding: remaining[0] || null,
        dirty: remaining.length > 0,
      };
    }
    for (const [path, sf] of Object.entries(scratchFiles)) {
      const remaining = editorAuditByPath[path] || [];
      const langId = langByPath[path] || sf.languageId || languageIdFromPath(path);
      out[path] = {
        language: languageById(langId).label,
        languageId: langId,
        text: sf.text,
        _live: true,
        _scratch: true,
        allFindings: remaining,
        finding: remaining[0] || null,
        dirty: remaining.length > 0 || Boolean(sf.dirty),
      };
    }
    for (const [path, entry] of Object.entries(out)) {
      const langId = langByPath[path] || entry.languageId || languageIdFromPath(path);
      entry.languageId = langId;
      entry.language = languageById(langId).label;
    }
    return out;
  }, [fileContents, scratchFiles, overrides, resolvedKeys, textForPath, editorAuditByPath, langByPath]);

  const effectiveTree = useMemo(() => {
    const scratchPaths = Object.keys(scratchFiles);
    const contentPaths = Object.keys(fileContents);
    if (!repoTree && !scratchPaths.length && !contentPaths.length) return null;
    const paths = [...contentPaths, ...scratchPaths];
    const base =
      scratchPaths.length > 0 || !repoTree
        ? buildRepoTreeFromPaths(paths, activeScan?.projectName || 'codebase')
        : repoTree;
    if (!base) return null;
    return annotateTreeSeverity(base, effectiveFileContents || {});
  }, [repoTree, effectiveFileContents, scratchFiles, fileContents, activeScan?.projectName]);

  const tabs = useMemo(
    () => [
      { id: 'heatmap', label: 'File Heatmap & Code' },
      { id: 'issues', label: `Issues (${liveFindings.length})` },
    ],
    [liveFindings.length],
  );

  const file =
    effectiveFileContents[activeId] ||
    scratchFiles[activeId] ||
    Object.values(effectiveFileContents)[0];

  /** Issues for the file currently open in the editor (scan + live check). */
  const currentFileFindings = useMemo(() => {
    if (!activeId) return [];
    return effectiveFileContents[activeId]?.allFindings || [];
  }, [activeId, effectiveFileContents]);

  const currentFileFindingSig = useMemo(
    () => currentFileFindings.map((f) => findingKey(f)).join('|'),
    [currentFileFindings],
  );

  // Internally re-check current file whenever it changes — surface first open issue
  useEffect(() => {
    if (!activeId) return;
    if (!currentFileFindings.length) {
      setSelectedFinding((prev) => (prev?.path === activeId ? null : prev));
      return;
    }
    setSelectedFinding((prev) => {
      if (prev?.path === activeId) {
        const still = currentFileFindings.find((f) => findingKey(f) === findingKey(prev));
        if (still) return { ...still, path: activeId };
      }
      return { ...currentFileFindings[0], path: activeId };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by signature of open issues
  }, [activeId, currentFileFindingSig]);

  const finding = useMemo(() => {
    if (selectedFinding && selectedFinding.path === activeId) {
      const still = currentFileFindings.find((f) => findingKey(f) === findingKey(selectedFinding));
      if (still) return { ...still, path: activeId };
    }
    return file?.finding || currentFileFindings[0] || null;
  }, [selectedFinding, activeId, file?.finding, currentFileFindings]);

  const patchView = useMemo(
    () => buildFixBundle(finding, editorValue),
    [finding, editorValue],
  );

  /** Gutter markers for every open issue on the active file (concurrent as you type). */
  const issueLines = useMemo(() => {
    /** @type {Record<number, string>} */
    const map = {};
    for (const iss of currentFileFindings) {
      const ln = Number(iss.line);
      if (!ln) continue;
      if (!map[ln]) map[ln] = String(iss.title || 'Issue').slice(0, 48);
    }
    return map;
  }, [currentFileFindings]);

  /** Per-issue: Apply is enabled for every finding that has a generated fix. */
  const fixMetaByKey = useMemo(() => {
    /** @type {Record<string, { hasFix: boolean }>} */
    const map = {};
    for (const iss of currentFileFindings) {
      const b = buildFixBundle(iss, editorValue);
      map[findingKey(iss)] = { hasFix: Boolean(b.hasFix) };
    }
    return map;
  }, [currentFileFindings, editorValue]);

  const autoFixableCount = useMemo(
    () => currentFileFindings.filter((iss) => fixMetaByKey[findingKey(iss)]?.hasFix).length,
    [currentFileFindings, fixMetaByKey],
  );

  const tabItems = useMemo(
    () =>
      openTabs.map((id) => {
        const baseline = savedSnapshot[id] != null ? savedSnapshot[id] : originalText(id);
        const cur = overrides[id] != null ? overrides[id] : originalText(id);
        const primary = effectiveFileContents[id]?.finding;
        return {
          id,
          name: id.split('/').pop(),
          dirty: cur !== baseline || Boolean(scratchFiles[id]?.dirty && overrides[id] == null),
          severity: primary ? String(primary.severity || 'critical').toLowerCase() : null,
        };
      }),
    [openTabs, scratchFiles, effectiveFileContents, overrides, savedSnapshot, originalText],
  );

  const dirtyIds = useMemo(() => {
    const set = new Set();
    for (const id of openTabs) {
      const baseline = savedSnapshot[id] != null ? savedSnapshot[id] : originalText(id);
      const cur = overrides[id] != null ? overrides[id] : originalText(id);
      if (cur !== baseline) set.add(id);
    }
    return set;
  }, [openTabs, overrides, savedSnapshot, originalText]);

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
      if (!path || (!effectiveFileContents[path] && !scratchFiles[path] && !fileContents[path])) {
        showToast?.('Source file not available for this finding', 'info');
        return;
      }
      openFile(path);
      if (issue) {
        setSelectedFinding({ ...issue, path });
      } else {
        const primary = effectiveFileContents[path]?.finding;
        setSelectedFinding(primary ? { path, ...primary } : null);
      }
      if (effectiveFileContents[path]?._snippetOnly) {
        showToast?.('Showing snippet-only content — full file body was not in scan payload', 'info');
      }
      setSection('heatmap');
    },
    [openFile, effectiveFileContents, scratchFiles, fileContents, showToast],
  );

  const checkActiveFile = useCallback(() => {
    if (!activeId) return;
    const text = textForPath(activeId);
    const found = auditFileText(activeId, text).filter((f) => {
      const key = findingKey(f);
      if (resolvedKeys.has(key)) return false;
      return isFindingStillPresent(f, text);
    });
    // Ensure buffer is tracked so editorAuditByPath keeps auditing this path
    if (overrides[activeId] == null) {
      setOverrides((prev) => ({ ...prev, [activeId]: text }));
    }
    if (found.length) {
      setSelectedFinding(found[0]);
      showToast?.(
        `Checked ${activeId.split('/').pop()}: ${found.length} issue${found.length === 1 ? '' : 's'} found`,
        'info',
      );
    } else {
      setSelectedFinding(null);
      showToast?.(`Checked ${activeId.split('/').pop()}: no issues found`, 'info');
    }
    setSection('heatmap');
  }, [activeId, textForPath, resolvedKeys, overrides, showToast]);

  const addNewFile = useCallback(() => {
    const lang = languageById(newFileLangId);
    const id = `scratch/untitled-${scratchSeq}.${lang.ext}`;
    const text = lang.template || '';
    setScratchSeq((n) => n + 1);
    setScratchFiles((prev) => ({
      ...prev,
      [id]: {
        language: lang.label,
        languageId: lang.id,
        dirty: true,
        finding: null,
        text,
      },
    }));
    setLangByPath((prev) => ({ ...prev, [id]: lang.id }));
    setOverrides((prev) => ({ ...prev, [id]: text }));
    openFile(id);
    setSection('heatmap');
  }, [openFile, scratchSeq, newFileLangId]);

  const changeEditorLanguage = useCallback(
    (nextLangId) => {
      if (!activeId || !nextLangId) return;
      const lang = languageById(nextLangId);
      const isScratchPath = Boolean(scratchFiles[activeId]) || activeId.startsWith('scratch/');

      if (isScratchPath) {
        const base = activeId.replace(/\.[^.]+$/, '');
        const newId = `${base}.${lang.ext}`;
        const text = overrides[activeId] ?? scratchFiles[activeId]?.text ?? lang.template ?? '';
        const onlyWhitespaceOrTemplate =
          !overrides[activeId] ||
          text === scratchFiles[activeId]?.text ||
          /^(\s|\/\/|#|\/\*|\*\/|<\?php)*/.test(text.slice(0, 40));

        // If buffer still matches the previous starter template, swap to the new language template
        const prevLang = languageById(
          langByPath[activeId] || scratchFiles[activeId]?.languageId || languageIdFromPath(activeId),
        );
        const useTemplate = text.trim() === (prevLang.template || '').trim() || !text.trim();
        const nextText = useTemplate ? lang.template || text : text;

        if (newId !== activeId) {
          setScratchFiles((prev) => {
            const next = { ...prev };
            const old = next[activeId] || { dirty: true, text: nextText };
            delete next[activeId];
            next[newId] = {
              ...old,
              language: lang.label,
              languageId: lang.id,
              text: nextText,
              dirty: true,
            };
            return next;
          });
          setOverrides((prev) => {
            const next = { ...prev };
            delete next[activeId];
            next[newId] = nextText;
            return next;
          });
          setLangByPath((prev) => {
            const next = { ...prev };
            delete next[activeId];
            next[newId] = lang.id;
            return next;
          });
          setSavedSnapshot((prev) => {
            if (prev[activeId] == null && prev[newId] == null) return prev;
            const next = { ...prev };
            if (next[activeId] != null) {
              next[newId] = next[activeId];
              delete next[activeId];
            }
            return next;
          });
          replaceTabs(
            openTabs.map((t) => (t === activeId ? newId : t)),
            newId,
          );
        } else {
          setLangByPath((prev) => ({ ...prev, [activeId]: lang.id }));
          setScratchFiles((prev) => ({
            ...prev,
            [activeId]: {
              ...(prev[activeId] || {}),
              language: lang.label,
              languageId: lang.id,
              text: nextText,
            },
          }));
          if (useTemplate || onlyWhitespaceOrTemplate) {
            setOverrides((prev) => ({ ...prev, [activeId]: nextText }));
          }
        }
        setNewFileLangId(lang.id);
        return;
      }

      // Scan files: keep path, override editor language for highlighting / live checks
      setLangByPath((prev) => ({ ...prev, [activeId]: lang.id }));
      setNewFileLangId(lang.id);
    },
    [
      activeId,
      scratchFiles,
      overrides,
      langByPath,
      openTabs,
      replaceTabs,
    ],
  );

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
      setOverrides((prev) => {
        if (prev[id] == null) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    },
    [closeTab, scratchFiles],
  );

  const handleEditorChange = useCallback(
    (text) => {
      if (!activeId) return;
      setOverrides((prev) => ({ ...prev, [activeId]: text }));
      if (scratchFiles[activeId]) {
        setScratchFiles((prev) => ({
          ...prev,
          [activeId]: { ...prev[activeId], text, dirty: true },
        }));
      }
    },
    [activeId, scratchFiles],
  );

  const handleSave = useCallback(() => {
    if (!activeId) return;
    const text = overrides[activeId] != null ? overrides[activeId] : originalText(activeId);
    setSavedSnapshot((prev) => {
      const next = { ...prev, [activeId]: text };
      persistEdits(workspaceKey, { ...overrides, [activeId]: text });
      return next;
    });
    setOverrides((prev) => ({ ...prev, [activeId]: text }));
    if (scratchFiles[activeId]) {
      setScratchFiles((prev) => ({
        ...prev,
        [activeId]: { ...prev[activeId], text, dirty: false },
      }));
    }
    const found = auditFileText(activeId, text).filter((f) => !resolvedKeys.has(findingKey(f)));
    if (found.length) {
      setSelectedFinding(found[0]);
      showToast?.(
        `Saved · re-checked: ${found.length} issue${found.length === 1 ? '' : 's'} found`,
        'info',
      );
    } else {
      setSelectedFinding((prev) => (prev?.path === activeId ? null : prev));
      showToast?.('Saved · re-checked: no issues found', 'info');
    }
  }, [activeId, overrides, originalText, workspaceKey, scratchFiles, showToast, resolvedKeys]);

  const recheckFileAfterEdit = useCallback(
    (path, nextText, appliedKeys = []) => {
      const fileIssues = mergeFindingLists(
        findingsForFile(fileContents[path] || effectiveFileContents[path], path),
        auditFileText(path, nextText),
      );
      const applied = new Set(appliedKeys);
      const stillOpen = [];
      const newlyResolved = new Set(applied);
      for (const iss of fileIssues) {
        const key = findingKey(iss);
        if (applied.has(key)) continue;
        if (resolvedKeys.has(key)) continue;
        if (isFindingStillPresent(iss, nextText)) stillOpen.push(iss);
        else newlyResolved.add(key);
      }
      setResolvedKeys((prev) => {
        const merged = new Set(prev);
        for (const k of newlyResolved) merged.add(k);
        persistResolvedKeys(workspaceKey, merged);
        return merged;
      });
      const nextFinding = stillOpen[0] ? { ...stillOpen[0], path } : null;
      setSelectedFinding(nextFinding);
      return stillOpen;
    },
    [fileContents, effectiveFileContents, resolvedKeys, workspaceKey],
  );

  const applyOptsFromBundle = (bundle) => ({
    startLine: bundle.targetLine || undefined,
    endLine: bundle.endLine || undefined,
    replaceWholeFile: Boolean(bundle.replaceWholeFile),
    deleteLine: Boolean(bundle.deleteLine),
  });

  const applyPatchToEditor = useCallback(() => {
    if (!activeId || !finding) {
      showToast?.('Select an issue first, then Apply fix', 'info');
      return;
    }
    if (finding.patchApplicable === false && !finding.suggestion) {
      showToast?.('No source-specific patch is available. Nothing was applied.', 'info');
      return;
    }
    const applyNow = () => {
    const bundle = buildFixBundle(finding, editorValue);
    if (!bundle.hasFix) {
      showToast?.('Could not build a fix for this issue', 'error');
      return;
    }
    const opts = applyOptsFromBundle(bundle);
    let next = applyCorrectedAtFinding(editorValue, finding, bundle.corrected, opts);
    if (next === editorValue && !opts.replaceWholeFile) {
      const lines = editorValue.split('\n');
      const start = Math.max(0, (Number(bundle.targetLine || finding.line) || 1) - 1);
      const endLine = Number(bundle.endLine || bundle.targetLine || finding.line) || start + 1;
      const end = Math.max(start, Math.min(lines.length, endLine) - 1);
      if (start >= lines.length) {
        showToast?.('Could not locate the line to patch', 'error');
        return;
      }
      if (opts.deleteLine || !String(bundle.corrected || '').trim()) {
        lines.splice(start, end - start + 1);
      } else {
        lines.splice(start, end - start + 1, ...bundle.corrected.split('\n'));
      }
      next = lines.join('\n');
    }
    if (next === editorValue) {
      showToast?.('Fix produced no editor change', 'error');
      return;
    }
    handleEditorChange(next);
    const stillOpen = recheckFileAfterEdit(activeId, next, [findingKey(finding)]);
    if (stillOpen.length) {
      showToast?.(
        `Applied to the editor buffer only — re-checked: ${stillOpen.length} issue${stillOpen.length === 1 ? '' : 's'} still open. Not written to disk and not verified.`,
        'info',
      );
    } else {
      showToast?.(
        'Applied to the editor buffer only (not written to disk, verification not run). Save keeps session edits only.',
        'info',
      );
    }
    };
    const hash = finding.patchSourceHash;
    if (hash && finding.patch && crypto?.subtle) {
      const buf = new TextEncoder().encode(editorValue);
      crypto.subtle.digest('SHA-256', buf).then((dig) => {
        const hex = [...new Uint8Array(dig)].map((b) => b.toString(16).padStart(2, '0')).join('');
        if (hex !== hash) {
          showToast?.(
            'This patch is stale — the editor buffer changed after it was generated. It was not applied.',
            'error',
          );
          return;
        }
        applyNow();
      }).catch(() => applyNow());
      return;
    }
    applyNow();
  }, [activeId, editorValue, finding, handleEditorChange, showToast, recheckFileAfterEdit]);

  /** Apply every issue on the current file (bottom-up), then re-check. */
  const applyAllFixesOnFile = useCallback(() => {
    if (!activeId) return;
    if (!currentFileFindings.length) {
      showToast?.('No issues to fix on this file', 'info');
      return;
    }
    let text = editorValue;
    const issues = [...currentFileFindings].sort((a, b) => (b.line || 0) - (a.line || 0));
    const appliedKeys = [];
    let appliedCount = 0;
    for (const iss of issues) {
      const bundle = buildFixBundle(iss, text);
      if (!bundle.hasFix) continue;
      const opts = applyOptsFromBundle(bundle);
      let next = applyCorrectedAtFinding(text, iss, bundle.corrected, opts);
      if (next === text && !opts.replaceWholeFile) {
        const lines = text.split('\n');
        const start = Math.max(0, (Number(bundle.targetLine || iss.line) || 1) - 1);
        const endLine = Number(bundle.endLine || bundle.targetLine || iss.line) || start + 1;
        const end = Math.max(start, Math.min(lines.length, endLine) - 1);
        if (start < lines.length) {
          if (opts.deleteLine || !String(bundle.corrected || '').trim()) {
            lines.splice(start, end - start + 1);
          } else {
            lines.splice(start, end - start + 1, ...bundle.corrected.split('\n'));
          }
          next = lines.join('\n');
        }
      }
      if (next === text) continue;
      text = next;
      appliedKeys.push(findingKey(iss));
      appliedCount += 1;
    }
    if (!appliedCount) {
      showToast?.('Could not apply automatic fixes — try Apply on each issue', 'info');
      return;
    }
    handleEditorChange(text);
    const stillOpen = recheckFileAfterEdit(activeId, text, appliedKeys);
    if (stillOpen.length) {
      showToast?.(
        `Editor preview: ${appliedCount} fix${appliedCount === 1 ? '' : 'es'} in buffer — ${stillOpen.length} remain. Not written to disk; not verified on the repository.`,
        'info',
      );
    } else {
      showToast?.(
        `Editor preview: ${appliedCount} fix${appliedCount === 1 ? '' : 'es'} in buffer — client re-check clean. Not a disk write or backend re-scan.`,
        'info',
      );
    }
  }, [
    activeId,
    editorValue,
    currentFileFindings,
    handleEditorChange,
    recheckFileAfterEdit,
    showToast,
  ]);

  async function copyDiff() {
    const payload = patchView.corrected || finding?.patch || patchView.remediation;
    if (!payload) {
      showToast?.('No suggested patch / corrected code for this finding', 'info');
      return;
    }
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      showToast?.('Copied to clipboard', 'info');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      showToast?.('Clipboard blocked', 'error');
    }
  }

  if (scanHydrating || !workspace) {
    return (
      <div className="flex h-[calc(100vh-3.5rem)] w-full flex-col items-center justify-center gap-3 bg-surface-container-lowest px-space-md">
        <span
          className={`material-symbols-outlined text-[32px] text-primary ${
            hydrateTimedOut ? '' : 'animate-pulse'
          }`}
        >
          {hydrateTimedOut ? 'cloud_off' : 'progress_activity'}
        </span>
        <p className="font-headline-sm text-headline-sm text-on-surface">
          {hydrateTimedOut ? 'Scan engine unavailable' : 'Loading scan workspace…'}
        </p>
        <p className="max-w-md text-center font-body-sm text-body-sm text-on-surface-variant">
          {hydrateTimedOut
            ? `Could not restore ${String(activeScanId || '').slice(0, 8)} — Eyraaaa may be offline or the scan expired.`
            : `Restoring ${String(activeScanId || '').slice(0, 8)}`}
        </p>
        {hydrateTimedOut ? (
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              className="rounded-lg bg-primary-container px-space-md py-2 font-label-sm text-label-sm text-on-primary-container"
              onClick={() => {
                clearActiveScan?.();
                setAuditView?.('ingest');
              }}
            >
              Clear &amp; ingest again
            </button>
            <button
              type="button"
              className="rounded-lg bg-surface-container-high px-space-md py-2 font-label-sm text-label-sm text-on-surface"
              onClick={() => clearActiveScan?.()}
            >
              Dismiss
            </button>
          </div>
        ) : null}
      </div>
    );
  }

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
            {usingLive ? 'AST-ACTIVE · LIVE' : 'NO SCAN DATA'}
          </span>
          <span className="truncate font-code-compact text-code-compact text-on-surface-variant">
            {projectLabel} ·{' '}
            {Object.keys(fileContents).length + Object.keys(scratchFiles).length} files
            {activeScan?.fileInventory?.skippedNoise
              ? ` · ${activeScan.fileInventory.skippedNoise} noise skipped`
              : ''}
          </span>
        </div>
        <span
          className={`rounded px-2 py-0.5 font-label-sm text-label-sm font-semibold ${
            liveFindings.length
              ? 'bg-error-container/35 text-error'
              : 'bg-tertiary/15 text-tertiary'
          }`}
        >
          {liveFindings.length
            ? `${liveFindings.length} open issues`
            : 'No issues found'}
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

      {section === 'issues' ? (
        <IssueList findings={liveFindings} onOpen={openFinding} usingLive={usingLive} />
      ) : null}

      {section === 'heatmap' ? (
        <>
          <div className="flex min-h-0 flex-1 overflow-hidden bg-surface-container-lowest">
            <FileExplorer
              tree={effectiveTree}
              open={openFolders}
              selected={activeId}
              width={panelWidths.explorer}
              onToggle={toggleFolder}
              onSelect={(id) => {
                openFile(id);
                const primary = effectiveFileContents[id]?.finding;
                setSelectedFinding(primary ? { path: id, ...primary } : null);
              }}
            />
            <PanelResizeHandle
              onDrag={resizeExplorer}
              title="Drag to resize explorer"
            />

            <div
              className="flex min-w-0 flex-1 flex-col overflow-hidden"
              style={{ minWidth: EDITOR_MIN }}
            >
              <FileTabBar
                tabs={tabItems}
                activeId={activeId}
                dirtyIds={dirtyIds}
                onSelect={(id) => {
                  setActiveId(id);
                  const list = effectiveFileContents[id]?.allFindings || [];
                  setSelectedFinding(list[0] ? { path: id, ...list[0] } : null);
                }}
                onClose={handleClose}
                onAdd={addNewFile}
              />
              {activeId && file ? (
                <CodeEditor
                  path={activeId}
                  language={file.language}
                  editable
                  value={editorValue}
                  dirty={fileDirty}
                  onChange={handleEditorChange}
                  onSave={handleSave}
                  findingLine={finding?.line}
                  findingLabel={finding?.title}
                  issueLines={issueLines}
                  metaRight={
                    <>
                      {activeId?.startsWith('scratch/') || scratchFiles[activeId] ? (
                        <LanguageSelect
                          value={
                            langByPath[activeId] ||
                            file?.languageId ||
                            languageIdFromPath(activeId)
                          }
                          onChange={changeEditorLanguage}
                          options={AUDIT_LANGUAGES}
                          aria-label="Code language"
                        />
                      ) : (
                        <span className="inline-flex items-center gap-1.5 font-label-sm text-label-sm text-outline">
                          <LanguageLogo
                            langId={languageIdFromPath(activeId)}
                            size={14}
                            showLabel
                          />
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={handleSave}
                        disabled={!fileDirty}
                        className="flex items-center gap-1 rounded bg-primary-container px-2 py-0.5 font-label-sm text-[11px] font-semibold text-on-primary-container disabled:cursor-not-allowed disabled:opacity-40"
                        title="Save (Ctrl+S)"
                      >
                        <span className="material-symbols-outlined text-[14px]">save</span>
                        Save
                      </button>
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

            <PanelResizeHandle
              onDrag={resizeCheckPanel}
              title="Drag to resize Current file check"
            />
            <aside
              style={{
                width: panelWidths.check,
                minWidth: panelWidths.check,
                maxWidth: panelWidths.check,
              }}
              className="flex shrink-0 flex-col overflow-hidden border-l border-outline-variant/25 bg-surface-container-low"
            >
              {/* Pinned header — does not scroll away */}
              <div className="shrink-0 border-b border-outline-variant/20 bg-surface-container-lowest p-space-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px] text-primary">
                      fact_check
                    </span>
                    <span className="truncate font-headline-sm text-headline-sm font-semibold text-on-surface">
                      Current file check
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <span
                      className={`rounded px-1.5 py-0.5 font-label-sm text-[10px] font-semibold ${
                        currentFileFindings.length
                          ? 'bg-error-container/40 text-error'
                          : 'bg-tertiary/15 text-tertiary'
                      }`}
                    >
                      {currentFileFindings.length
                        ? `${currentFileFindings.length} issue${currentFileFindings.length === 1 ? '' : 's'}`
                        : 'Clean'}
                    </span>
                    <button
                      type="button"
                      onClick={checkActiveFile}
                      className="flex items-center gap-1 rounded bg-surface-container-high px-2 py-1 font-label-sm text-[11px] font-semibold text-on-surface hover:bg-surface-bright"
                      title="Re-check this file now"
                    >
                      <span className="material-symbols-outlined text-[14px]">bug_report</span>
                      Re-check
                    </button>
                  </div>
                </div>
                <p className="mt-1 truncate font-code-compact text-code-compact text-outline">
                  {activeId || '—'}
                </p>
                <div className="mt-2 flex gap-1.5">
                  <button
                    type="button"
                    onClick={applyPatchToEditor}
                    disabled={!finding || !patchView.hasFix}
                    className="flex flex-1 items-center justify-center gap-1 rounded bg-primary-container px-2 py-1.5 font-label-sm text-[11px] font-semibold text-on-primary-container hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                    title={
                      !finding
                        ? 'Select an issue first'
                        : patchView.applyHint ||
                          `Apply fix at line ${patchView.targetLine || finding.line || '?'}`
                    }
                  >
                    <span className="material-symbols-outlined text-[14px]">auto_fix</span>
                    Apply fix
                  </button>
                  <button
                    type="button"
                    onClick={applyAllFixesOnFile}
                    disabled={!currentFileFindings.length || autoFixableCount === 0}
                    className="flex flex-1 items-center justify-center gap-1 rounded bg-surface-container-high px-2 py-1.5 font-label-sm text-[11px] font-semibold text-on-surface hover:bg-surface-bright disabled:cursor-not-allowed disabled:opacity-40"
                    title={
                      currentFileFindings.length === 0
                        ? 'No issues on this file'
                        : `Apply all ${autoFixableCount} fix${autoFixableCount === 1 ? '' : 'es'} on this file`
                    }
                  >
                    <span className="material-symbols-outlined text-[14px]">playlist_add_check</span>
                    Fix all{autoFixableCount > 0 ? ` (${autoFixableCount})` : ''}
                  </button>
                </div>
              </div>

              {/* Scrollable body only */}
              <div className="min-h-0 flex-1 overflow-y-auto">
                {currentFileFindings.length ? (
                  <ul className="flex flex-col gap-0.5 border-b border-outline-variant/20 p-space-sm">
                    {currentFileFindings.map((iss) => {
                      const active = finding && findingKey(finding) === findingKey(iss);
                      const meta = fixMetaByKey[findingKey(iss)];
                      const canAuto = Boolean(meta?.hasFix);
                      return (
                        <li key={findingKey(iss)}>
                          <button
                            type="button"
                            onClick={() => setSelectedFinding({ ...iss, path: activeId })}
                            className={`flex w-full flex-col gap-0.5 rounded px-2 py-1.5 text-left ${
                              active
                                ? 'bg-primary-container/20 ring-1 ring-primary/30'
                                : 'hover:bg-surface-container'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span className="truncate font-label-sm text-[12px] font-semibold text-on-surface">
                                {iss.title}
                              </span>
                              <span className="flex shrink-0 items-center gap-1">
                                {canAuto ? (
                                  <span className="rounded bg-tertiary/20 px-1 py-px font-label-sm text-[9px] font-bold uppercase text-tertiary">
                                    Fix
                                  </span>
                                ) : null}
                                <span
                                  className={`rounded px-1 py-px font-label-sm text-[9px] font-bold uppercase ${severityChipClass(iss.severity)}`}
                                >
                                  {iss.severity}
                                </span>
                              </span>
                            </div>
                            <span className="font-code-compact text-[10px] text-outline">
                              Ln {iss.line}
                              {canAuto ? ' · Apply available' : ''}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}

                {finding ? (
                  <div className="flex flex-col gap-space-md p-space-md">
                    <div className="flex flex-col gap-1.5">
                      <div className="flex flex-wrap items-center gap-1">
                        {finding.severity ? (
                          <span
                            className={`inline-flex rounded px-1.5 py-0.5 font-label-sm text-[10px] font-semibold uppercase ${severityChipClass(finding.severity)}`}
                          >
                            {finding.severity}
                          </span>
                        ) : null}
                        <span className="inline-flex rounded bg-error-container/40 px-1.5 py-0.5 font-label-sm text-[10px] font-semibold uppercase text-error">
                          {finding.cwe}
                        </span>
                        {finding.line != null ? (
                          <span className="font-code-compact text-code-compact text-outline">
                            Ln {finding.line}
                          </span>
                        ) : null}
                      </div>
                      <p className="font-headline-sm text-headline-sm font-semibold text-on-surface">
                        {finding.title || 'Finding'}
                      </p>
                      <p className="font-body-md text-body-md leading-snug text-on-surface-variant">
                        {finding.summary || finding.title}
                      </p>
                      {finding.impact &&
                      normalizeFindingText(finding.impact) !==
                        normalizeFindingText(finding.summary || finding.title) ? (
                        <p className="font-body-sm text-body-sm text-outline">{finding.impact}</p>
                      ) : null}
                    </div>

                    <div className="flex flex-col gap-2 border-t border-outline-variant/20 pt-space-md">
                      {patchView.remediation ? (
                        <div className="flex flex-col gap-1">
                          <span className="font-label-sm text-label-sm uppercase text-outline">
                            What to do
                          </span>
                          <p className="font-body-sm text-body-sm text-on-surface-variant">
                            {patchView.remediation}
                          </p>
                        </div>
                      ) : null}

                      <p className="font-body-sm text-body-sm text-outline">{patchView.applyHint}</p>

                      {patchView.hasFix ? (
                        <div className="flex flex-col gap-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-label-sm text-label-sm uppercase text-outline">
                              Diff
                              {patchView.targetLine != null ? ` · from line ${patchView.targetLine}` : ''}
                            </span>
                            <button
                              type="button"
                              onClick={copyDiff}
                              className="flex items-center gap-0.5 rounded p-1 text-primary hover:bg-surface-container"
                              title="Copy corrected code"
                            >
                              <span className="material-symbols-outlined text-[16px]">
                                {copied ? 'check' : 'content_copy'}
                              </span>
                            </button>
                          </div>
                          <pre className="max-h-64 overflow-auto rounded border border-outline-variant/25 bg-surface-container-lowest p-2 font-code-compact text-code-compact leading-relaxed">
                            {(patchView.diffLines?.length
                              ? patchView.diffLines
                              : [
                                  ...String(patchView.originalLine || '')
                                    .split('\n')
                                    .slice(0, 40)
                                    .map((t, i) => ({
                                      kind: 'del',
                                      text: `${String((patchView.targetLine || 1) + i).padStart(4, ' ')} − ${t}`,
                                    })),
                                  ...patchView.corrected
                                    .split('\n')
                                    .slice(0, 40)
                                    .map((t, i) => ({
                                      kind: 'add',
                                      text: `${String((patchView.targetLine || 1) + i).padStart(4, ' ')} + ${t}`,
                                    })),
                                ]
                            ).map((row, i) => (
                              <div
                                key={`${i}-${row.text.slice(0, 32)}`}
                                className={
                                  row.kind === 'add'
                                    ? 'whitespace-pre bg-tertiary/15 text-tertiary'
                                    : row.kind === 'del'
                                      ? 'whitespace-pre bg-error/15 text-error'
                                      : 'whitespace-pre text-on-surface-variant'
                                }
                              >
                                {row.text || ' '}
                              </div>
                            ))}
                          </pre>
                        </div>
                      ) : (
                        <p className="rounded border border-outline-variant/30 bg-surface-container px-2 py-2 font-body-sm text-body-sm text-on-surface-variant">
                          Building fix… or select another issue.
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center gap-2 p-space-lg text-center">
                    <span className="material-symbols-outlined text-[28px] text-tertiary">verified</span>
                    <p className="font-headline-sm text-headline-sm text-on-surface">No issues found</p>
                    <p className="font-body-sm text-body-sm text-on-surface-variant">
                      {usingLive
                        ? liveFindings.length === 0
                          ? 'This live scan reported no open findings for the repo. Severity flags appear only where Eyraaaa / live rules detect issues — try another file or re-run Ingest → Start scan.'
                          : 'This file has no open findings. Other files still have issues — check the explorer badges or the Issues tab.'
                        : 'This file has no open findings. Type a mistake (e.g. `def foo()` without `:`, or `print hello`) — issues appear on that line as you type.'}
                    </p>
                  </div>
                )}
              </div>
            </aside>
          </div>

          <footer className="flex shrink-0 flex-wrap items-center justify-between gap-space-sm border-t border-outline-variant/20 bg-surface-container-lowest px-space-md py-1.5 font-code-compact text-code-compact text-outline">
            <div className="flex flex-wrap items-center gap-space-md">
              <span>
                Lang: <span className="text-on-surface-variant">{file?.language || '—'}</span>
              </span>
              <span>
                File: <span className="text-primary">{activeId}</span>
              </span>
              <span>Tab = indent · Ctrl+S = save</span>
              {finding?.line != null ? (
                <span>
                  Issue: <span className="text-primary">Ln {finding.line}</span>
                </span>
              ) : null}
            </div>
            {fileDirty ? (
              <span className="text-secondary">Unsaved changes</span>
            ) : (
              <span className="text-tertiary">Saved</span>
            )}
          </footer>
        </>
      ) : null}
    </div>
  );
}

function severityChipClass(severity) {
  const s = String(severity || '').toLowerCase();
  if (s.startsWith('crit')) return 'bg-error text-white';
  if (s.startsWith('high')) return 'bg-[#e67e22] text-white';
  if (s.startsWith('med')) return 'bg-[#d4a017] text-[#1a1400]';
  return 'bg-primary-container/80 text-on-primary-container';
}

function IssueList({ findings, onOpen, usingLive }) {
  if (!findings.length) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-space-xl text-center">
        <span className="material-symbols-outlined text-[28px] text-tertiary">verified</span>
        <p className="font-headline-sm text-headline-sm text-on-surface">No issues found</p>
        <p className="font-body-sm text-body-sm text-on-surface-variant">
          {usingLive
            ? 'No open findings after re-check (applied fixes cleared matching issues).'
            : 'No scan loaded — start or open an audit to see findings.'}
        </p>
      </div>
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-auto p-space-md">
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
                <span className="flex items-center gap-1">
                  {iss.severity ? (
                    <span
                      className={`rounded px-1.5 py-0.5 font-label-sm text-label-sm font-bold uppercase ${severityChipClass(iss.severity)}`}
                    >
                      {iss.severity}
                    </span>
                  ) : null}
                  <span className="font-label-sm text-label-sm text-outline">{iss.cwe}</span>
                </span>
              </div>
              <span className="font-code-compact text-code-compact text-outline">
                {iss.path}:{iss.line}
              </span>
              <span className="font-body-sm text-body-sm text-on-surface-variant">{iss.summary}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

