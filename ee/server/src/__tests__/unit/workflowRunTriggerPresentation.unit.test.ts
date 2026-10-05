import { describe, expect, it } from 'vitest';

import { getWorkflowRunTriggerLabel } from '../../components/workflow-designer/workflowRunTriggerPresentation';

describe('workflow run trigger presentation', () => {
  it('T041: workflow runs list labels one-time schedule runs distinctly', () => {
    expect(getWorkflowRunTriggerLabel('schedule')).toBe('One-time schedule');
  });

  it('T042: workflow runs list labels recurring schedule runs distinctly', () => {
    expect(getWorkflowRunTriggerLabel('recurring')).toBe('Recurring schedule');
  });

  it('labels manual runs that carry a sample event as test runs, not as event-fired or plain manual', () => {
    expect(getWorkflowRunTriggerLabel(null, 'TICKET_CUSTOMER_REPLIED')).toBe('Manual test with event: TICKET_CUSTOMER_REPLIED');
    expect(getWorkflowRunTriggerLabel(null)).toBe('Manual test');
    expect(getWorkflowRunTriggerLabel('event', 'TICKET_CREATED')).toBe('Event: TICKET_CREATED');
  });
});
