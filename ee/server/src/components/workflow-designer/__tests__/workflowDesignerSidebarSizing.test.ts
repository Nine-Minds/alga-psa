import { describe, expect, it } from 'vitest';

import {
  clampWorkflowDesignerSidebarWidth,
  DEFAULT_WORKFLOW_DESIGNER_SIDEBAR_WIDTH,
  getWorkflowDesignerSidebarWidthFromDrag,
  MAX_WORKFLOW_DESIGNER_SIDEBAR_WIDTH,
  MIN_WORKFLOW_DESIGNER_SIDEBAR_WIDTH,
} from '../workflowDesignerSidebarSizing';

describe('workflowDesignerSidebarSizing', () => {
  it('clamps widths to the supported bounds', () => {
    expect(clampWorkflowDesignerSidebarWidth(MIN_WORKFLOW_DESIGNER_SIDEBAR_WIDTH - 100)).toBe(
      MIN_WORKFLOW_DESIGNER_SIDEBAR_WIDTH
    );
    expect(clampWorkflowDesignerSidebarWidth(MAX_WORKFLOW_DESIGNER_SIDEBAR_WIDTH + 100)).toBe(
      MAX_WORKFLOW_DESIGNER_SIDEBAR_WIDTH
    );
    expect(clampWorkflowDesignerSidebarWidth(DEFAULT_WORKFLOW_DESIGNER_SIDEBAR_WIDTH + 27.6)).toBe(
      DEFAULT_WORKFLOW_DESIGNER_SIDEBAR_WIDTH + 28
    );
  });

  it('increases width when the handle is dragged left and decreases it when dragged right', () => {
    expect(
      getWorkflowDesignerSidebarWidthFromDrag(DEFAULT_WORKFLOW_DESIGNER_SIDEBAR_WIDTH, 900, 820)
    ).toBe(DEFAULT_WORKFLOW_DESIGNER_SIDEBAR_WIDTH + 80);
    expect(
      getWorkflowDesignerSidebarWidthFromDrag(DEFAULT_WORKFLOW_DESIGNER_SIDEBAR_WIDTH, 900, 980)
    ).toBe(MIN_WORKFLOW_DESIGNER_SIDEBAR_WIDTH);
  });
});
