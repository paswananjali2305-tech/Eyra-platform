let busy = false;
let controller: AbortController | null = null;

export function tryBeginBrainRequest(): boolean {
  if (busy) {
    return false;
  }
  busy = true;
  controller = new AbortController();
  return true;
}

export function getBrainAbortSignal(): AbortSignal | undefined {
  return controller?.signal;
}

export function isBrainRequestBusy(): boolean {
  return busy;
}

/** Abort the active Brain request if one is in flight. Returns true when abort was signaled. */
export function cancelBrainRequest(): boolean {
  if (!busy || !controller || controller.signal.aborted) {
    return false;
  }
  controller.abort();
  return true;
}

export function endBrainRequest(): void {
  busy = false;
  controller = null;
}
