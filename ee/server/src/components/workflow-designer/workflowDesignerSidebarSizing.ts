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
