import { describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/tickets/actions/ticketActions', () => ({
  getTicketById: vi.fn().mockResolvedValue({
    ticket_id: 'ticket-1',
    ticket_number: 'T-1001',
    title: 'Printer down',
    client_id: 'client-1',
    contact_name_id: 'contact-1',
    board_id: 'board-1',
    assigned_to: null,
    assigned_team_id: null,
    entered_at: '2026-10-01T10:00:00.000Z',
  }),
}));
vi.mock('../WorkflowActionInputFixedPicker', () => ({ loadWorkflowContracts: vi.fn().mockResolvedValue([]) }));
vi.mock('../workflowPickerServerActions', () => ({
  getWorkflowClientSummaryAction: vi.fn(),
  getWorkflowTicketReplySummaryAction: vi.fn().mockResolvedValue({
    comment_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    created_at: '2026-10-02T09:30:00.000Z',
    is_customer_reply: true,
  }),
}));

import { WORKFLOW_RUN_RECORD_SOURCES } from '../workflowRunRecordResolvers';
import { buildRecordFill, listRecordFillTargets } from '../workflowRunRecordFill';

describe('Run dialog record fill from a ticket for message events', () => {
  // Shaped like the TICKET_CUSTOMER_REPLIED payload.
  const customerRepliedSiblings = [
    { key: 'ticketId', pickerKind: 'ticket' },
    { key: 'messageId' },
    { key: 'contactId', pickerKind: 'contact' },
    { key: 'channel' },
    { key: 'receivedAt' },
  ];

  it('fills messageId and receivedAt from the ticket\'s latest customer reply', async () => {
    const source = WORKFLOW_RUN_RECORD_SOURCES.ticket!;
    const record = await source.resolve('ticket-1');
    expect(record).not.toBeNull();
    const fill = buildRecordFill(record!, 'ticketId', customerRepliedSiblings, {}, () => false, source.kindFields);
    expect(fill).toMatchObject({
      messageId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      contactId: 'contact-1',
      receivedAt: '2026-10-02T09:30:00.000Z',
    });
    expect(listRecordFillTargets(source, 'ticketId', customerRepliedSiblings)).toEqual(['messageId', 'contactId', 'receivedAt']);
  });
});
