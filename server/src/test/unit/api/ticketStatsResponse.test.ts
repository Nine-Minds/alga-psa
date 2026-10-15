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
