export const DEFAULT_WORKFLOW_DESIGNER_SIDEBAR_WIDTH = 420;
export const MIN_WORKFLOW_DESIGNER_SIDEBAR_WIDTH = 360;
export const MAX_WORKFLOW_DESIGNER_SIDEBAR_WIDTH = 760;

export const clampWorkflowDesignerSidebarWidth = (width: number): number =>
  Math.min(
    MAX_WORKFLOW_DESIGNER_SIDEBAR_WIDTH,
    Math.max(MIN_WORKFLOW_DESIGNER_SIDEBAR_WIDTH, Math.round(width))
  );

export const getWorkflowDesignerSidebarWidthFromDrag = (
  startWidth: number,
  startClientX: number,
  currentClientX: number
): number => {
  const delta = startClientX - currentClientX;
  return clampWorkflowDesignerSidebarWidth(startWidth + delta);
};

/** A roomy width for long field lists and expressions; double-clicking the resize edge toggles it. */
export const WIDE_WORKFLOW_DESIGNER_SIDEBAR_WIDTH = 600;

export const toggleWorkflowDesignerSidebarWidth = (width: number): number =>
  width >= WIDE_WORKFLOW_DESIGNER_SIDEBAR_WIDTH ? DEFAULT_WORKFLOW_DESIGNER_SIDEBAR_WIDTH : WIDE_WORKFLOW_DESIGNER_SIDEBAR_WIDTH;

const SIDEBAR_WIDTH_STORAGE_KEY = 'alga.workflowDesigner.sidebarWidth';

/** The width this browser last left the panel at (a per-viewer convenience; storage may be unavailable). */
export const readStoredWorkflowDesignerSidebarWidth = (): number => {
  try {
    const stored = Number(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY));
    return Number.isFinite(stored) && stored > 0 ? clampWorkflowDesignerSidebarWidth(stored) : DEFAULT_WORKFLOW_DESIGNER_SIDEBAR_WIDTH;
  } catch {
    return DEFAULT_WORKFLOW_DESIGNER_SIDEBAR_WIDTH;
  }
};

export const storeWorkflowDesignerSidebarWidth = (width: number): void => {
  try {
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(clampWorkflowDesignerSidebarWidth(width)));
  } catch {
    // Storage unavailable (private window, blocked site data): the width just isn't remembered.
  }
};
