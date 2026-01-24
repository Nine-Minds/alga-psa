import { describe, expect, it } from 'vitest';
import { buildTicketTransitionWorkflowEvents } from '../workflowTicketTransitionEvents';

const TICKET_ID = '11111111-1111-1111-1111-111111111111';
const BOARD_A = '22222222-2222-2222-2222-222222222222';
const BOARD_B = '33333333-3333-3333-3333-333333333333';
const STATUS_OPEN = '44444444-4444-4444-4444-444444444444';
const STATUS_CLOSED = '55555555-5555-5555-5555-555555555555';
const PRIORITY_1 = '66666666-6666-6666-6666-666666666666';
const PRIORITY_2 = '77777777-7777-7777-7777-777777777777';
const USER_A = '88888888-8888-8888-8888-888888888888';

describe('buildTicketTransitionWorkflowEvents', () => {
  it('emits status + priority + queue changes', () => {
    const occurredAt = '2026-01-23T12:00:00.000Z';
    const events = buildTicketTransitionWorkflowEvents({
      before: {
        ticketId: TICKET_ID,
        statusId: STATUS_OPEN,
        priorityId: PRIORITY_1,
        assignedTo: USER_A,
        boardId: BOARD_A,
        escalated: false,
      },
      after: {
        ticketId: TICKET_ID,
        statusId: STATUS_CLOSED,
        priorityId: PRIORITY_2,
        assignedTo: USER_A,
        boardId: BOARD_B,
        escalated: false,
      },
      ctx: { occurredAt, previousStatusIsClosed: false, newStatusIsClosed: true },
    });

    expect(events.map((e) => e.eventType)).toEqual([
      'TICKET_STATUS_CHANGED',
      'TICKET_PRIORITY_CHANGED',
      'TICKET_QUEUE_CHANGED',
    ]);

    expect(events[0]?.payload).toMatchObject({
      ticketId: TICKET_ID,
      previousStatusId: STATUS_OPEN,
      newStatusId: STATUS_CLOSED,
      changedAt: occurredAt,
    });
  });

  it('emits unassigned when assigned_to is cleared', () => {
    const occurredAt = '2026-01-23T12:00:00.000Z';
    const events = buildTicketTransitionWorkflowEvents({
      before: {
        ticketId: TICKET_ID,
        statusId: STATUS_OPEN,
        priorityId: PRIORITY_1,
        assignedTo: USER_A,
        boardId: BOARD_A,
        escalated: false,
      },
      after: {
        ticketId: TICKET_ID,
        statusId: STATUS_OPEN,
        priorityId: PRIORITY_1,
        assignedTo: null,
        boardId: BOARD_A,
        escalated: false,
      },
      ctx: { occurredAt, previousStatusIsClosed: false, newStatusIsClosed: false },
    });

    expect(events.map((e) => e.eventType)).toEqual(['TICKET_UNASSIGNED']);
    expect(events[0]?.payload).toMatchObject({
      ticketId: TICKET_ID,
      previousAssigneeId: USER_A,
      previousAssigneeType: 'user',
      unassignedAt: occurredAt,
    });
  });

  it('emits reopened alongside status change when transitioning from closed to open', () => {
    const occurredAt = '2026-01-23T12:00:00.000Z';
    const events = buildTicketTransitionWorkflowEvents({
      before: {
        ticketId: TICKET_ID,
        statusId: STATUS_CLOSED,
        priorityId: PRIORITY_1,
        assignedTo: null,
        boardId: BOARD_A,
        escalated: false,
      },
      after: {
        ticketId: TICKET_ID,
        statusId: STATUS_OPEN,
        priorityId: PRIORITY_1,
        assignedTo: null,
        boardId: BOARD_A,
        escalated: false,
      },
      ctx: { occurredAt, previousStatusIsClosed: true, newStatusIsClosed: false },
    });

    expect(events.map((e) => e.eventType)).toEqual(['TICKET_STATUS_CHANGED', 'TICKET_REOPENED']);
    expect(events[1]?.payload).toMatchObject({
      ticketId: TICKET_ID,
      previousStatusId: STATUS_CLOSED,
      newStatusId: STATUS_OPEN,
      reopenedAt: occurredAt,
    });
  });

  it('emits escalated when escalated flag flips on', () => {
    const occurredAt = '2026-01-23T12:00:00.000Z';
    const events = buildTicketTransitionWorkflowEvents({
      before: {
        ticketId: TICKET_ID,
        statusId: STATUS_OPEN,
        priorityId: PRIORITY_1,
        assignedTo: null,
        boardId: BOARD_A,
        escalated: false,
      },
      after: {
        ticketId: TICKET_ID,
        statusId: STATUS_OPEN,
        priorityId: PRIORITY_1,
        assignedTo: null,
        boardId: BOARD_B,
        escalated: true,
      },
      ctx: { occurredAt, previousStatusIsClosed: false, newStatusIsClosed: false },
    });

    expect(events.map((e) => e.eventType)).toEqual(['TICKET_QUEUE_CHANGED', 'TICKET_ESCALATED']);
    expect(events[1]?.payload).toMatchObject({
      ticketId: TICKET_ID,
      fromQueueId: BOARD_A,
      toQueueId: BOARD_B,
      escalatedAt: occurredAt,
    });
  });
});

