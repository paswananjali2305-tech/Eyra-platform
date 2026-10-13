import { useCallback, useEffect, useLayoutEffect, useState } from 'react';

function resolveRoot(hostRef) {
  return hostRef.current?.querySelector?.('.stitch-screen') || hostRef.current;
}

/**
 * Prevent stitch mock HTML from flashing before idle scrub / live hydrate.
 * Host stays gated (hidden + skeleton) until `reveal()` or auto-reveal after scrub.
 *
 * @param {import('react').RefObject<HTMLElement|null>} hostRef
 * @param {{ scrub?: (root: HTMLElement|null) => void, autoRevealAfterScrub?: boolean }} [opts]
 */
export function useStitchGate(hostRef, { scrub, autoRevealAfterScrub = false } = {}) {
  const [ready, setReady] = useState(false);

  const reveal = useCallback(() => setReady(true), []);
  const hold = useCallback(() => setReady(false), []);

  useLayoutEffect(() => {
    setReady(false);
    const root = resolveRoot(hostRef);
    if (root) scrub?.(root);
  }, [hostRef, scrub]);

  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    let timer = 0;

    const tick = () => {
      if (cancelled) return;
      const root = resolveRoot(hostRef);
      if (!root) {
        if (tries >= 40) {
          if (autoRevealAfterScrub) setReady(true);
          return;
        }
        tries += 1;
        timer = window.setTimeout(tick, 40);
        return;
      }
      scrub?.(root);
      if (autoRevealAfterScrub && !cancelled) setReady(true);
    };
    tick();

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [hostRef, scrub, autoRevealAfterScrub]);

  return {
    ready,
    reveal,
    hold,
    gateClassName: ready ? 'eyra-stitch-gate eyra-stitch-gate--ready' : 'eyra-stitch-gate',
    gateProps: {
      'data-eyra-stitch-gate': ready ? 'ready' : 'pending',
      'aria-busy': ready ? undefined : true,
    },
  };
}
