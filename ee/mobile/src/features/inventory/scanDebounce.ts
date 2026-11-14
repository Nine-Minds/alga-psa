import { useRef } from "react";

/**
 * The camera reports the same label many times a second; a technician means
 * one scan. Shared by the Inventory scanner and the site-audit scanner so both
 * swallow repeats the same way.
 */
export const SCAN_DEBOUNCE_MS = 1500;

export type ScanDebounce = {
  /** False when this code was already accepted inside the window. */
  accept: (code: string, nowMs?: number) => boolean;
  /** Forget the last code, so the same label can be scanned again at once. */
  reset: () => void;
};

export function createScanDebounce(windowMs: number = SCAN_DEBOUNCE_MS): ScanDebounce {
  let last: { code: string; atMs: number } | null = null;
  return {
    accept(code, nowMs = Date.now()) {
      if (last && last.code === code && nowMs - last.atMs < windowMs) return false;
      last = { code, atMs: nowMs };
      return true;
    },
    reset() {
      last = null;
    },
  };
}

export function useScanDebounce(windowMs: number = SCAN_DEBOUNCE_MS): ScanDebounce {
  const ref = useRef<ScanDebounce | null>(null);
  if (!ref.current) ref.current = createScanDebounce(windowMs);
  return ref.current;
}
