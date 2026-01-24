import { describe, expect, it } from 'vitest';
import { buildWorkflowPayload } from '@shared/workflow/streams/workflowEventPublishHelpers';
import { ticketTimeEntryAddedEventPayloadSchema } from '@shared/workflow/runtime/schemas/ticketEventSchemas';
import { buildTicketTimeEntryAddedWorkflowEvent } from '../../lib/api/services/timeEntryWorkflowEvents';

const TENANT_ID = '00000000-0000-0000-0000-000000000000';
const TICKET_ID = '11111111-1111-1111-1111-111111111111';
const TIME_ENTRY_ID = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';

describe('buildTicketTimeEntryAddedWorkflowEvent', () => {
  it('builds a valid payload for ticket time entries', () => {
    const createdAt = '2026-01-23T12:00:00.000Z';
    const event = buildTicketTimeEntryAddedWorkflowEvent({
      workItemType: 'ticket',
      workItemId: TICKET_ID,
      timeEntryId: TIME_ENTRY_ID,
      minutes: 45,
      billable: true,
      createdAt,
    });

    expect(event?.eventType).toBe('TICKET_TIME_ENTRY_ADDED');
    expect(event?.payload).toMatchObject({
      ticketId: TICKET_ID,
      timeEntryId: TIME_ENTRY_ID,
      minutes: 45,
      billable: true,
      createdAt,
    });

    ticketTimeEntryAddedEventPayloadSchema.parse(
      buildWorkflowPayload(event!.payload as any, {
        tenantId: TENANT_ID,
        occurredAt: createdAt,
        actor: { actorType: 'USER', actorUserId: USER_ID },
      })
    );
  });

  it('returns null for non-ticket work items or invalid minutes', () => {
    expect(
      buildTicketTimeEntryAddedWorkflowEvent({
        workItemType: 'project_task',
        workItemId: TICKET_ID,
        timeEntryId: TIME_ENTRY_ID,
        minutes: 30,
        billable: true,
      })
    ).toBeNull();

    expect(
      buildTicketTimeEntryAddedWorkflowEvent({
        workItemType: 'ticket',
        workItemId: TICKET_ID,
        timeEntryId: TIME_ENTRY_ID,
        minutes: 0,
        billable: true,
      })
    ).toBeNull();
  });
});

