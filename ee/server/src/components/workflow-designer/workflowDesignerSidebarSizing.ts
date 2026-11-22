/**
 * The workflow designer's inspector width: the shared implementation, bound to this
 * designer's storage namespace.
 */
import {
  DEFAULT_DESIGNER_SIDEBAR_WIDTH,
  MAX_DESIGNER_SIDEBAR_WIDTH,
  MIN_DESIGNER_SIDEBAR_WIDTH,
  WIDE_DESIGNER_SIDEBAR_WIDTH,
  clampDesignerSidebarWidth,
  getDesignerSidebarWidthFromDrag,
  readStoredDesignerSidebarWidth,
  storeDesignerSidebarWidth,
  toggleDesignerSidebarWidth,
} from '@alga-psa/ui/components/designer';

const NAMESPACE = 'workflowDesigner';

export const DEFAULT_WORKFLOW_DESIGNER_SIDEBAR_WIDTH = DEFAULT_DESIGNER_SIDEBAR_WIDTH;
export const MIN_WORKFLOW_DESIGNER_SIDEBAR_WIDTH = MIN_DESIGNER_SIDEBAR_WIDTH;
export const MAX_WORKFLOW_DESIGNER_SIDEBAR_WIDTH = MAX_DESIGNER_SIDEBAR_WIDTH;
export const WIDE_WORKFLOW_DESIGNER_SIDEBAR_WIDTH = WIDE_DESIGNER_SIDEBAR_WIDTH;

export const clampWorkflowDesignerSidebarWidth = clampDesignerSidebarWidth;
export const getWorkflowDesignerSidebarWidthFromDrag = getDesignerSidebarWidthFromDrag;
export const toggleWorkflowDesignerSidebarWidth = toggleDesignerSidebarWidth;

export const readStoredWorkflowDesignerSidebarWidth = (): number =>
  readStoredDesignerSidebarWidth(NAMESPACE);

export const storeWorkflowDesignerSidebarWidth = (width: number): void =>
  storeDesignerSidebarWidth(NAMESPACE, width);
