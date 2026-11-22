/**
 * A resizable, remembered inspector width. Promoted from the workflow designer; the storage
 * key is now the caller's namespace.
 */
export const DEFAULT_DESIGNER_SIDEBAR_WIDTH = 420;
export const MIN_DESIGNER_SIDEBAR_WIDTH = 360;
export const MAX_DESIGNER_SIDEBAR_WIDTH = 760;

export const clampDesignerSidebarWidth = (width: number): number =>
  Math.min(
    MAX_DESIGNER_SIDEBAR_WIDTH,
    Math.max(MIN_DESIGNER_SIDEBAR_WIDTH, Math.round(width))
  );

export const getDesignerSidebarWidthFromDrag = (
  startWidth: number,
  startClientX: number,
  currentClientX: number
): number => {
  const delta = startClientX - currentClientX;
  return clampDesignerSidebarWidth(startWidth + delta);
};

/** A roomy width for long field lists and expressions; double-clicking the resize edge toggles it. */
export const WIDE_DESIGNER_SIDEBAR_WIDTH = 600;

export const toggleDesignerSidebarWidth = (width: number): number =>
  width >= WIDE_DESIGNER_SIDEBAR_WIDTH ? DEFAULT_DESIGNER_SIDEBAR_WIDTH : WIDE_DESIGNER_SIDEBAR_WIDTH;

const sidebarWidthStorageKey = (namespace: string): string => `alga.${namespace}.sidebarWidth`;

/** The width this browser last left the panel at (a per-viewer convenience; storage may be unavailable). */
export const readStoredDesignerSidebarWidth = (namespace: string): number => {
  try {
    const stored = Number(window.localStorage.getItem(sidebarWidthStorageKey(namespace)));
    return Number.isFinite(stored) && stored > 0 ? clampDesignerSidebarWidth(stored) : DEFAULT_DESIGNER_SIDEBAR_WIDTH;
  } catch {
    return DEFAULT_DESIGNER_SIDEBAR_WIDTH;
  }
};

export const storeDesignerSidebarWidth = (namespace: string, width: number): void => {
  try {
    window.localStorage.setItem(sidebarWidthStorageKey(namespace), String(clampDesignerSidebarWidth(width)));
  } catch {
    // Storage unavailable (private window, blocked site data): the width just isn't remembered.
  }
};
