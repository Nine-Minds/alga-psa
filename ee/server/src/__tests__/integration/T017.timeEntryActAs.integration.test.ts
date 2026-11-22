/**
 * T017 (F062 area): REST-layer TimeEntryService.create as a service principal.
 * No act-as -> 422 ACT_AS_REQUIRED. With act-as -> user_id and created_by are the
 * human and created_via_principal_id is the principal.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { tenantDb } from '@alga-psa/db';
import { persistTimeEntry } from '@alga-psa/scheduling/lib/timeEntryWriteCore';

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
    expect(entry.created_via_principal_id).toBe(principal.userId);
    expect(entry.updated_via_principal_id).toBe(principal.userId);
    expect(row.user_id).toBe(human);
    expect(row.created_by).toBe(human);
    expect(row.created_via_principal_id).toBe(principal.userId);
  });

  it('replaces update attribution across delegated and direct-human writes', async () => {
    const { db, tenant } = harness();
    const human = await createHuman();
    const firstPrincipal = await createPrincipal({ allowActAs: true });
    const created = await service().create(await payload(), await contextFor(firstPrincipal, human) as never);
    const entryId = created.entry_id as string;
    expect(created).toMatchObject({
      created_via_principal_id: firstPrincipal.userId,
      updated_via_principal_id: firstPrincipal.userId,
    });

    const humanUser = await tenantDb(db, tenant).table('users').where({ user_id: human }).first();
    const beforeHumanWrite = await tenantDb(db, tenant).table('time_entries').where({ entry_id: entryId }).first();
    const humanWrite = await db.transaction((trx) => persistTimeEntry(trx, {
      tenant,
      actor: humanUser,
      entry: {
        entry_id: entryId,
        work_item_id: beforeHumanWrite.work_item_id,
        work_item_type: beforeHumanWrite.work_item_type,
        start_time: beforeHumanWrite.start_time,
        end_time: beforeHumanWrite.end_time,
        billable_duration: beforeHumanWrite.billable_duration,
        notes: 'edited by human through shared writer',
        time_sheet_id: beforeHumanWrite.time_sheet_id,
        approval_status: beforeHumanWrite.approval_status,
        service_id: beforeHumanWrite.service_id,
        tax_region: beforeHumanWrite.tax_region,
        contract_line_id: beforeHumanWrite.contract_line_id,
        tax_rate_id: beforeHumanWrite.tax_rate_id,
        user_id: human,
      } as never,
    }));
    expect(humanWrite.entry).toMatchObject({
      notes: 'edited by human through shared writer',
      created_via_principal_id: firstPrincipal.userId,
      updated_via_principal_id: null,
    });
    let row = await tenantDb(db, tenant).table('time_entries').where({ entry_id: entryId }).first();
    expect(row).toMatchObject({
      notes: 'edited by human through shared writer',
      created_via_principal_id: firstPrincipal.userId,
      updated_via_principal_id: null,
    });

    const secondPrincipal = await createPrincipal({ allowActAs: true });
    const delegatedUpdate = await service().update(
      entryId,
      { notes: 'edited by second principal' } as never,
      await contextFor(secondPrincipal, human) as never,
    );
    expect(delegatedUpdate).toMatchObject({
      notes: 'edited by second principal',
      created_via_principal_id: firstPrincipal.userId,
      updated_via_principal_id: secondPrincipal.userId,
    });
    row = await tenantDb(db, tenant).table('time_entries').where({ entry_id: entryId }).first();
    expect(row).toMatchObject({
      notes: 'edited by second principal',
      created_via_principal_id: firstPrincipal.userId,
      updated_via_principal_id: secondPrincipal.userId,
    });
  });
});
