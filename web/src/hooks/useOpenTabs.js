import { useCallback, useRef, useState } from 'react';

/** Unique paths, preserve order. */
export function dedupeTabIds(ids) {
  const out = [];
  const seen = new Set();
  for (const id of ids || []) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * VS Code–style open tabs: open/focus on select, close with fallback active.
 * @param {string[]} initialIds
 * @param {string|null} [preferredActive] restored active tab, if still open
 */
export function useOpenTabs(initialIds, preferredActive = null) {
  const seed = dedupeTabIds(initialIds);
  const [openTabs, setOpenTabs] = useState(() => [...seed]);
  const [activeId, setActiveId] = useState(() =>
    preferredActive && seed.includes(preferredActive) ? preferredActive : seed[0] || null,
  );
  const openTabsRef = useRef(openTabs);
  openTabsRef.current = openTabs;

  const openFile = useCallback((id) => {
    if (!id) return;
    setOpenTabs((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setActiveId(id);
  }, []);

  const closeTab = useCallback((id) => {
    if (!id) return;
    const prev = openTabsRef.current;
    const idx = prev.indexOf(id);
    if (idx < 0) return;
    const next = prev.filter((t) => t !== id);
    openTabsRef.current = next;
    setOpenTabs(next);
    setActiveId((cur) => {
      if (cur !== id) return cur;
      if (!next.length) return null;
      return next[Math.max(0, idx - 1)] || next[0] || null;
    });
  }, []);

  /**
   * Replace open tabs (deduped). Optional preferredActive kept if still present.
   * @param {string[]} ids
   * @param {string|null} [preferredActive]
   */
  const replaceTabs = useCallback((ids, preferredActive = null) => {
    const next = dedupeTabIds(ids);
    openTabsRef.current = next;
    setOpenTabs(next);
    const active =
      preferredActive && next.includes(preferredActive) ? preferredActive : next[0] || null;
    setActiveId(active);
  }, []);

  return { openTabs, activeId, setActiveId, openFile, closeTab, replaceTabs };
}
