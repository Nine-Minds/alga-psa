import { describe, it, expectTypeOf } from 'vitest';
import type { TimeEntryWorkItemContext } from '@alga-psa/types';

describe('TimeEntryWorkItemContext', () => {
  it('includes required fields', () => {
    expectTypeOf<TimeEntryWorkItemContext>().toMatchTypeOf<{
      workItemId: string;
      workItemType: string;
      workItemName: string;
    }>();
  });

  it('supports optional context-specific fields', () => {
    const sample: TimeEntryWorkItemContext = {
      workItemId: 'work-item-1',
      workItemType: 'ticket',
      workItemName: 'Sample Work Item',
      ticketNumber: 'T-123',
      interactionType: 'Phone',
      clientName: 'Acme Corp',
      startTime: new Date(),
      endTime: new Date(),
      projectName: 'Project Alpha',
      phaseName: 'Phase 1',
      taskName: 'Task A',
      serviceId: 'service-1',
      serviceName: 'Onsite',
      elapsedTime: 120,
      timeDescription: 'Worked on issue',
    };

    expectTypeOf(sample).toMatchTypeOf<TimeEntryWorkItemContext>();
  });
});
