/**
 * T017 (F062 area): REST-layer TimeEntryService.create as a service principal.
 * No act-as -> 422 ACT_AS_REQUIRED. With act-as -> user_id and created_by are the
 * human and created_via_principal_id is the principal.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { tenantDb } from '@alga-psa/db';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@alga-psa/event-bus/publishers', async () => (await import('./helpers/spMocks')).publishersMock());
vi.mock('@alga-psa/db', async (importOriginal) => (await import('./helpers/spHarness')).mockDbModuleFactory(importOriginal as never));
vi.mock('server/src/lib/tier-gating/assertTierAccess', () => ({ assertTenantTierAccess: vi.fn(async () => undefined) }));
vi.mock('@alga-psa/licensing', () => ({
  getLicenseStateRow: vi.fn(async () => null),
  verifyLicense: vi.fn(() => ({ valid: false })),
}));

import { boot, teardown, harness, createHuman, createPrincipal, contextFor, ensureService } from './helpers/spHarness';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';
import { TimeEntryService } from 'server/src/lib/api/services/TimeEntryService';

beforeAll(async () => {
  await boot('sp_t017_time_entry');
  // The service resolves the entry's time sheet from a period covering its work date.
  await tenantDb(harness().db, harness().tenant).table('time_periods').insert({
    tenant: harness().tenant,
    period_id: crypto.randomUUID(),
    start_date: '2031-03-01',
    end_date: '2031-04-01',
  });
}, 600_000);
afterAll(teardown);

function service() {
  const svc = new TimeEntryService();
  vi.spyOn(svc as never, 'getKnex' as never).mockResolvedValue({ knex: harness().db, tenant: harness().tenant } as never);
  return svc;
}

async function payload() {
  const serviceId = await ensureService();
  const start = new Date(Date.UTC(2031, 2, 3 + Math.floor(Math.random() * 20), 9, 0));
  return {
    work_item_type: 'ad_hoc',
    work_item_id: null,
    service_id: serviceId,
    start_time: start,
    end_time: new Date(start.getTime() + 60 * 60 * 1000),
    is_billable: false,
    notes: 'T017',
  } as never;
}

describe('T017 time entry create under a service principal', () => {
  it('without act-as is 422 ACT_AS_REQUIRED and writes nothing', async () => {
    const { db, tenant } = harness();
    const principal = await createPrincipal({ allowActAs: true });
    const context = await contextFor(principal);
    const before = await tenantDb(db, tenant).table('time_entries').count<{ count: string }[]>('* as count');

    const error = await service().create(await payload(), context as never).then(() => null, (e) => e);
    expect(error).toBeTruthy();
    const response = handleApiError(error);
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe('ACT_AS_REQUIRED');

    const after = await tenantDb(db, tenant).table('time_entries').count<{ count: string }[]>('* as count');
    expect(after[0].count).toBe(before[0].count);
  });

  it('with act-as stores the human as owner/creator and the principal as via', async () => {
    const { db, tenant } = harness();
    const human = await createHuman();
    const principal = await createPrincipal({ allowActAs: true });
    const context = await contextFor(principal, human);
    expect(context.userId).toBe(human);
    expect(context.viaPrincipalUserId).toBe(principal.userId);

    const entry = await service().create(await payload(), context as never);
    const row = await tenantDb(db, tenant).table('time_entries').where({ entry_id: entry.entry_id }).first();
    expect(row.user_id).toBe(human);
    expect(row.created_by).toBe(human);
    expect(row.created_via_principal_id).toBe(principal.userId);
  });
});
