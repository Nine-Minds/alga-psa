import { expect, it, vi } from 'vitest';

// Each row's kernel decision is supplied by the row itself; the real projector applies it and retains the policy.
const decisions = vi.hoisted(() => new Map<string, { allowed: boolean; redactedFields: string[] }>());
vi.mock('server/src/lib/authorization/kernel', async (original) => ({
  ...(await original<any>()),
  getAuthorizationKernel: vi.fn(async () => ({
    authorizeResource: vi.fn(async (input: any) => decisions.get(String(input.record?.id)) ?? { allowed: true, redactedFields: [] }),
  })),
}));
vi.mock('@alga-psa/authorization/subject', async (original) => ({
  ...(await original<any>()),
  resolveAuthorizationSubject: vi.fn(async (_knex: unknown, input: any) => ({
    tenant: input.tenant, userId: input.user.user_id, userType: 'internal', roleIds: [], teamIds: [],
    managedUserIds: [], clientId: null, portfolioClientIds: [],
  })),
}));

import { ApiTicketController } from '../../../lib/api/controllers/ApiTicketController';
import { projectApiResourceRead } from '../../../lib/api/controllers/authorizationKernel';
import { ticketStatsResponseSchema } from '../../../lib/api/schemas/ticket';

async function project(record: Record<string, any>, redactedFields: string[] = []) {
  decisions.set(record.ticket_id, { allowed: true, redactedFields });
  const projection = await projectApiResourceRead({ knex: {} as any, tenant: 't1', user: { user_id: 'u1' }, kind: 'ticket', record });
  if (!projection) throw new Error('expected an authorized projection');
  return projection;
}

it('returns the public statistics shape for authorized rows, including the unavailable resolution metric', async () => {
  const controller = new ApiTicketController();
  const stats = (controller as any).buildTicketStatsFromAuthorizedRows([
    await project({ ticket_id: 'a1', status_id: 'open', status_is_closed: false, priority_name: 'High', board_name: 'Support', entered_at: new Date().toISOString() }),
    await project({ ticket_id: 'a2', status_id: 'closed', status_is_closed: true, priority_name: 'Low', board_name: 'Support', entered_at: new Date().toISOString() }),
  ]);
  expect(ticketStatsResponseSchema.parse(stats)).toMatchObject({
    total_tickets: 2, open_tickets: 1, closed_tickets: 1,
    tickets_by_status: { open: 1, closed: 1 },
    average_resolution_time: null,
  });
});

it('omits dependency-sensitive aggregates for mixed policies instead of emitting redacted or fabricated counts', async () => {
  const controller = new ApiTicketController();
  const stats = (controller as any).buildTicketStatsFromAuthorizedRows([
    await project({ ticket_id: 't1', status_id: 's1', status_name: 'Open', status_is_closed: false, priority_id: 'p1', priority_name: 'High', category_id: 'c1', category_name: 'Support', board_id: 'b1', board_name: 'Helpdesk', assigned_to: null, entered_at: new Date() }),
    await project(
      { ticket_id: 't2', status_id: 's1', status_name: 'Open', status_is_closed: false, priority_id: 'p1', priority_name: 'High', category_id: 'c1', category_name: 'Support', board_id: 'b1', board_name: 'Helpdesk', assigned_to: 'u2', entered_at: new Date() },
      ['values.status_id', 'tickets.priority_id', 'tickets.category_id', 'values.board_id'],
    ),
  ]);
  expect(stats.total_tickets).toBe(2);
  expect(stats).not.toHaveProperty('open_tickets');
  expect(stats).not.toHaveProperty('closed_tickets');
  expect(stats).not.toHaveProperty('tickets_by_status');
  expect(stats).not.toHaveProperty('tickets_by_priority');
  expect(stats).not.toHaveProperty('tickets_by_category');
  expect(stats).not.toHaveProperty('tickets_by_board');
  // Unaffected dependencies keep their aggregates.
  expect(stats).toHaveProperty('unassigned_tickets', 1);
  expect(stats).toHaveProperty('tickets_created_today', 2);
});
