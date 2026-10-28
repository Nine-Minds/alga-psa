import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { isCoManagedLifecycleError } from '@alga-psa/licensing/lifecycle-error';
import { createFakeKnex, CO_MANAGED_TENANT, clearWriteAdmissionCacheForTests, withReadOnlyWorkspace } from './fakeKnex';

const ticket = { ticket_id: 't1', tenant: CO_MANAGED_TENANT, client_id: 'c1', status_id: 's1', title: 'T', master_ticket_id: null, closed_at: null };
const fake = createFakeKnex((sql) => (/from "tickets"/.test(sql) ? [ticket] : undefined));
afterAll(() => fake.destroy());
afterEach(() => {
  fake.statements.length = 0;
  clearWriteAdmissionCacheForTests();
});

it('TicketService.update is refused on a read-only co-managed tenant and writes nothing', async () => {
  const { TicketService } = await import('../../../lib/api/services/TicketService');
  const service: any = new TicketService();
  service.getKnex = async () => ({ knex: fake.knex, tenant: CO_MANAGED_TENANT });
  await withReadOnlyWorkspace(async () => {
    const error: any = await service
      .update('t1', { title: 'renamed' }, { tenant: CO_MANAGED_TENANT, userId: 'u1' })
      .catch((e: unknown) => e);
    expect(isCoManagedLifecycleError(error)).toBe(true);
    expect(error.code).toBe('CO_MANAGED_READ_ONLY');
    expect(fake.writes()).toEqual([]);
  });
});
