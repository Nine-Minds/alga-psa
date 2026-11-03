import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({
  tickets: [] as Record<string, any>[],
  decision: (id: string) => ({ allowed: true, redactedFields: [] as string[] }),
}));
vi.mock('@/lib/services/apiKeyServiceForApi', () => ({ ApiKeyServiceForApi: { validateApiKeyAnyTenant: vi.fn(async () => ({ tenant: 't1', user_id: 'u1', api_key_id: 'k1' })), validateApiKeyForTenant: vi.fn(async () => ({ tenant: 't1', user_id: 'u1', api_key_id: 'k1' })) } }));
vi.mock('@alga-psa/users/actions', () => ({ findUserByIdForApi: vi.fn(async () => ({ user_id: 'u1', user_type: 'internal', tenant: 't1' })) }));
vi.mock('@/lib/db', () => ({ runWithTenant: vi.fn(async (_tenant: string, callback: () => Promise<any>) => callback()) }));
vi.mock('@/lib/db/db', () => ({ getConnection: vi.fn(async () => ({})) }));
vi.mock('@/lib/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));
vi.mock('@/lib/api/controllers/authorizationKernel', async (original) => ({ ...(await original<any>()), authorizeApiResourceRead: vi.fn(async ({ recordContext }: any) => state.decision(recordContext.id)) }));
vi.mock('@alga-psa/authorization/bundles/service', () => ({ resolveBundleNarrowingRulesForEvaluation: vi.fn(async () => [{ redactedFields: ['tickets.status_id'] }]) }));
vi.mock('@/lib/api/services/TicketService', () => ({ TicketService: class { list = async () => ({ data: state.tickets, total: state.tickets.length }); } }));

import { ApiTicketController } from '@/lib/api/controllers/ApiTicketController';
const request = () => new NextRequest('http://localhost/api/v1/tickets/stats', { headers: { 'x-api-key': 'k1' } });
const ticket = (id: string) => ({ ticket_id: id, status_id: 's1', status_name: 'Open', status_is_closed: false, priority_id: 'p1', priority_name: 'High', category_id: 'c1', category_name: 'Support', board_id: 'b1', board_name: 'Helpdesk', assigned_to: null, entered_at: new Date().toISOString() });
function controller() {
  const instance = new ApiTicketController() as any;
  instance.assertProductApiAccess = async () => undefined;
  instance.authenticate = async (request: any) => { request.context = { tenant: 't1', user: { user_id: 'u1' }, apiKeyId: 'k1' }; return request; };
  instance.checkPermission = async () => undefined;
  instance.extractIdFromPath = async () => state.tickets[0]?.ticket_id;
  instance.ticketService = { list: async () => ({ data: state.tickets, total: state.tickets.length }), getById: async () => state.tickets[0] };
  return instance;
}
beforeEach(() => {
  state.tickets = [ticket('t1'), ticket('t2')];
  state.decision = () => ({ allowed: true, redactedFields: [] });
});

describe('ticket statistics authorization response', () => {
  it('projects get responses and preserves denied reads', async () => {
    state.tickets = [ticket('t1')];
    state.decision = () => ({ allowed: true, redactedFields: ['tickets.status_id'] });
    const controllerInstance = controller();
    const response = await controllerInstance.getById()(request());
    const body = await response.json();
    expect(body.data).not.toHaveProperty('status_id');
    expect(body.data).not.toHaveProperty('status_name');
    expect(body.data).not.toHaveProperty('status_is_closed');
    state.decision = () => ({ allowed: false, redactedFields: [] });
    expect((await controller().getById()(request())).status).toBe(403);
  });

  it('projects list responses using per-row decisions when SQL narrowing cannot carry redactions', async () => {
    state.tickets = [ticket('t1'), ticket('t2')];
    state.decision = () => ({ allowed: true, redactedFields: ['tickets.status_id'] });
    const listRequest = new NextRequest('http://localhost/api/v1/tickets?page=1&limit=25');
    const response = await controller().list()(listRequest);
    const body = await response.json();
    expect(body.data).toHaveLength(2);
    for (const row of body.data) {
      expect(row).not.toHaveProperty('status_id');
      expect(row).not.toHaveProperty('status_name');
      expect(row).not.toHaveProperty('status_is_closed');
    }
  });

  it('preserves unrestricted aggregates from realistic service rows', async () => {
    const response = await controller().stats()(request());
    const body = await response.json();
    expect(body.data).toMatchObject({ total_tickets: 2, open_tickets: 2, tickets_by_status: { s1: 2 }, tickets_by_priority: { High: 2 }, tickets_by_category: { Support: 2 }, tickets_by_board: { Helpdesk: 2 } });
  });

  it('omits each aggregate when any row hides one of its source dependencies', async () => {
    state.decision = (id) => ({ allowed: true, redactedFields: id === 't2' ? ['values.status_id', 'tickets.priority_id', 'values.category_id', 'tickets.board_id'] : [] });
    const response = await controller().stats()(request());
    const body = await response.json();
    expect(body.data).toHaveProperty('total_tickets', 2);
    for (const field of ['open_tickets', 'closed_tickets', 'tickets_by_status', 'tickets_by_priority', 'tickets_by_category', 'tickets_by_board']) {
      expect(body.data).not.toHaveProperty(field);
    }
  });
});
