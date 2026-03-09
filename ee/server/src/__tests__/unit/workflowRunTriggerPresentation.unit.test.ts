import { describe, expect, it } from 'vitest';

import { getWorkflowRunTriggerLabel } from '../../components/workflow-designer/workflowRunTriggerPresentation';

describe('workflow run trigger presentation', () => {
  it('T041: workflow runs list labels one-time schedule runs distinctly', () => {
    expect(getWorkflowRunTriggerLabel('schedule')).toBe('One-time schedule');
  });

  it('T042: workflow runs list labels recurring schedule runs distinctly', () => {
    expect(getWorkflowRunTriggerLabel('recurring')).toBe('Recurring schedule');
  });
});
