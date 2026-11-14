import { expect, it } from 'vitest';
import { ApiTicketController } from '../../../lib/api/controllers/ApiTicketController';
import { ticketStatsResponseSchema } from '../../../lib/api/schemas/ticket';

it('returns the public statistics shape for authorized rows, including the unavailable resolution metric', () => {
  const controller = new ApiTicketController();
  const stats = (controller as any).buildTicketStatsFromAuthorizedRows([
    { status_id: 'open', status_is_closed: false, priority_name: 'High', board_name: 'Support', entered_at: new Date().toISOString() },
    { status_id: 'closed', status_is_closed: true, priority_name: 'Low', board_name: 'Support', entered_at: new Date().toISOString() },
  ]);
  expect(ticketStatsResponseSchema.parse(stats)).toMatchObject({
    total_tickets: 2, open_tickets: 1, closed_tickets: 1,
    tickets_by_status: { open: 1, closed: 1 },
    average_resolution_time: null,
  });
});

it('omits dependency-sensitive aggregates for mixed policies instead of emitting redacted or fabricated counts', () => {
  const controller = new ApiTicketController();
  const stats = (controller as any).buildTicketStatsFromAuthorizedRows([
    { record: { ticket_id: 't1', status_name: 'Open', status_is_closed: false, priority_name: 'High', category_name: 'Support', board_name: 'Helpdesk', assigned_to: null, entered_at: new Date() }, redactedFields: [] },
    { record: { ticket_id: 't2', status_name: undefined, status_is_closed: undefined, priority_name: undefined, category_name: undefined, board_name: undefined, entered_at: new Date() }, redactedFields: ['values.status_id', 'tickets.priority_id', 'tickets.category_id', 'values.board_id'] },
  ]);
  expect(stats.total_tickets).toBe(2);
  expect(stats).not.toHaveProperty('open_tickets');
  expect(stats).not.toHaveProperty('closed_tickets');
  expect(stats).not.toHaveProperty('tickets_by_status');
  expect(stats).not.toHaveProperty('tickets_by_priority');
  expect(stats).not.toHaveProperty('tickets_by_category');
  expect(stats).not.toHaveProperty('tickets_by_board');
});
