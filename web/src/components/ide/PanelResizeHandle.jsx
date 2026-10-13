import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Vertical drag handle between horizontal panels.
 * @param {{ onDrag: (deltaX: number) => void, title?: string }} props
 */
export function PanelResizeHandle({ onDrag, title = 'Drag to resize' }) {
  const dragging = useRef(false);
  const lastX = useRef(0);
  const [active, setActive] = useState(false);

  const endDrag = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    setActive(false);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  useEffect(() => {
    const onMove = (e) => {
      if (!dragging.current) return;
      const x = e.touches?.[0]?.clientX ?? e.clientX;
      const dx = x - lastX.current;
      lastX.current = x;
      if (dx) onDrag(dx);
    };
    const onUp = () => endDrag();
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
  }, [onDrag, endDrag]);

  const startDrag = (e) => {
    e.preventDefault();
    dragging.current = true;
    setActive(true);
    lastX.current = e.touches?.[0]?.clientX ?? e.clientX;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={title}
      title={title}
      onMouseDown={startDrag}
      onTouchStart={startDrag}
      className={`group relative z-20 w-1.5 shrink-0 cursor-col-resize touch-none ${
        active ? 'bg-primary/50' : 'bg-outline-variant/20 hover:bg-primary/40'
      }`}
    >
      <div
        className={`pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 ${
          active ? 'bg-primary' : 'bg-transparent group-hover:bg-primary/70'
        }`}
      />
    </div>
  );
}
