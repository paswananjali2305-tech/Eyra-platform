import { useCallback, useState } from 'react';

/**
 * VS Code–style open tabs: open/focus on select, close with fallback active.
 */
export function useOpenTabs(initialIds) {
  const [openTabs, setOpenTabs] = useState(() => [...initialIds]);
  const [activeId, setActiveId] = useState(() => initialIds[0] || null);

  const openFile = useCallback((id) => {
    setOpenTabs((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setActiveId(id);
  }, []);

  const closeTab = useCallback((id) => {
    setOpenTabs((prev) => {
      const next = prev.filter((t) => t !== id);
      setActiveId((cur) => {
        if (cur !== id) return cur;
        if (!next.length) return null;
        const idx = prev.indexOf(id);
        return next[Math.max(0, idx - 1)] || next[0];
      });
      return next;
    });
  }, []);

  return { openTabs, activeId, setActiveId, openFile, closeTab };
}
