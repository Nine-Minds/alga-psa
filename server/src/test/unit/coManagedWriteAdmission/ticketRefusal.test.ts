import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { createFakeKnex, CO_MANAGED_TENANT, clearWriteAdmissionCacheForTests, withReadOnlyWorkspace } from './fakeKnex';

const ticket = { ticket_id: 't1', tenant: CO_MANAGED_TENANT, client_id: 'c1', status_id: 's1', title: 'T', master_ticket_id: null, closed_at: null };
const fake = createFakeKnex((sql) => (/from "tickets"/.test(sql) ? [ticket] : undefined));
afterAll(() => fake.destroy());
afterEach(() => {
  fake.statements.length = 0;
  clearWriteAdmissionCacheForTests();
});

it('the REST error boundary maps a real TicketService update refusal and writes nothing', async () => {
  const { TicketService } = await import('../../../lib/api/services/TicketService');
  const { handleApiError } = await import('../../../lib/api/middleware/apiMiddleware');
  const service: any = new TicketService();
  service.getKnex = async () => ({ knex: fake.knex, tenant: CO_MANAGED_TENANT });
  await withReadOnlyWorkspace(async () => {
    const response = await service
      .update('t1', { title: 'renamed' }, { tenant: CO_MANAGED_TENANT, userId: 'u1' })
      .catch(handleApiError);
    expect(response.status).toBe(423);
    expect((await response.json()).error.code).toBe('CO_MANAGED_READ_ONLY');
    expect(fake.writes()).toEqual([]);
  });
}, 60_000);
