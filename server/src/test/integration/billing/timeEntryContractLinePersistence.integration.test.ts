import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { setupCommonMocks } from '../../../../test-utils/testMocks';

/**
 * DB-backed check of the contract-line provenance contract the time entry form
 * relies on, driven through the real persistTimeEntry (the body of saveTimeEntry):
 *
 *  - a caller-supplied contract_line_id persists as contract_line_source='explicit'
 *  - no id on an ambiguous service is recorded 'unresolved' (id stays null)
 *  - an unambiguous service with no id is resolved by the server (auto_*), never 'explicit'
 *  - the stored row reads back with the same contract_line_id
 */

let db: Knex;
let tenantId: string;
let userId: string;

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    withTransaction: vi.fn(async (knexOrTrx: Knex, callback: (trx: Knex.Transaction) => Promise<unknown>) =>
      callback(knexOrTrx as unknown as Knex.Transaction),
    ),
    requireTenantId: vi.fn(async () => tenantId),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn()),
  };
});

vi.mock('@alga-psa/auth', async () => {
  const { createAuthModuleMock } = await import('../../../../test-utils/authModuleMock');
  return createAuthModuleMock();
});

const HOOK_TIMEOUT = 300_000;

function table(name: string) {
  return tenantDb(db, tenantId).table(name);
}

async function seedContractCovering(clientId: string, serviceId: string, name: string): Promise<string> {
  const contractId = uuidv4();
  const contractLineId = uuidv4();
  await table('contracts').insert({
    contract_id: contractId, tenant: tenantId, contract_name: name, is_active: true,
    created_at: db.fn.now(), updated_at: db.fn.now(),
  });
  await table('contract_lines').insert({
    contract_line_id: contractLineId, tenant: tenantId, contract_id: contractId,
    contract_line_name: `${name} line`, contract_line_type: 'Hourly',
  });
  await table('contract_line_services').insert({
    tenant: tenantId, contract_line_id: contractLineId, service_id: serviceId, quantity: 1,
  });
  await table('client_contracts').insert({
    client_contract_id: uuidv4(), tenant: tenantId, client_id: clientId, contract_id: contractId,
    start_date: '2025-01-01', end_date: null, is_active: true,
  });
  return contractLineId;
}

describe('time entry contract line persistence (picker -> persistTimeEntry -> DB)', () => {
  let ticketId: string;
  let ambiguousServiceId: string;
  let uniqueServiceId: string;
  let lineA: string;
  let uniqueLine: string;
  let persistTimeEntry: typeof import('@alga-psa/scheduling/lib/timeEntryWriteCore')['persistTimeEntry'];

  const save = async (entry: Record<string, unknown>) => {
    const actor: any = { user_id: userId, tenant: tenantId };
    return db.transaction((trx) =>
      persistTimeEntry(trx, {
        tenant: tenantId,
        actor,
        entry: {
          work_item_id: ticketId,
          work_item_type: 'ticket',
          start_time: '2025-05-12T10:00:00Z',
          end_time: '2025-05-12T11:00:00Z',
          billable_duration: 60,
          notes: '',
          approval_status: 'DRAFT',
          user_id: userId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...entry,
        } as any,
      }),
    );
  };
  const readRow = (entryId: string) => table('time_entries').where({ entry_id: entryId }).first();

  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    db = await createTestDbConnection({ databaseName: 'test_db_billing_profiles' });
    tenantId = uuidv4();
    await tenantDb(db, tenantId)
      .unscoped('tenants', 'test fixture creates tenant rows')
      .insert({ tenant: tenantId, client_name: 'Line Persistence Fixture', email: `lp-${tenantId.slice(0, 8)}@test.test` });

    userId = uuidv4();
    await table('users').insert({
      user_id: userId, tenant: tenantId, username: 'lp-tester', email: 'lp@test.test', hashed_password: 'x',
      first_name: 'L', last_name: 'P', user_type: 'internal', created_at: db.fn.now(), updated_at: db.fn.now(),
    });
    setupCommonMocks({ tenantId, userId, permissionCheck: () => true });

    const clientId = uuidv4();
    await table('clients').insert({
      tenant: tenantId, client_id: clientId, client_name: 'LP Client', billing_cycle: 'monthly',
      created_at: db.fn.now(), updated_at: db.fn.now(),
    });
    ticketId = uuidv4();
    await table('tickets').insert({
      ticket_id: ticketId, tenant: tenantId, ticket_number: 'LP-1', title: 'LP', client_id: clientId,
      entered_at: db.fn.now(), updated_at: db.fn.now(),
    });
    const serviceTypeId = uuidv4();
    await table('service_types').insert({ id: serviceTypeId, tenant: tenantId, name: 'LP Type' });
    ambiguousServiceId = uuidv4();
    uniqueServiceId = uuidv4();
    await table('service_catalog').insert([
      { service_id: ambiguousServiceId, tenant: tenantId, service_name: 'Shared', billing_method: 'per_unit', custom_service_type_id: serviceTypeId, default_rate: 100 },
      { service_id: uniqueServiceId, tenant: tenantId, service_name: 'Solo', billing_method: 'per_unit', custom_service_type_id: serviceTypeId, default_rate: 100 },
    ]);
    lineA = await seedContractCovering(clientId, ambiguousServiceId, 'Alpha');
    await seedContractCovering(clientId, ambiguousServiceId, 'Beta');
    uniqueLine = await seedContractCovering(clientId, uniqueServiceId, 'Gamma');

    ({ persistTimeEntry } = await import('@alga-psa/scheduling/lib/timeEntryWriteCore'));
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy();
  }, HOOK_TIMEOUT);

  it('a supplied contract_line_id persists as explicit, not unresolved, and reads back', async () => {
    const saved = await save({ service_id: ambiguousServiceId, contract_line_id: lineA });
    const row = await readRow(saved.entry.entry_id);
    expect(row.contract_line_id).toBe(lineA);
    expect(row.contract_line_source).toBe('explicit');
    expect(row.contract_line_source).not.toBe('unresolved');
  }, HOOK_TIMEOUT);

  it('re-saving that entry without an id on an ambiguous service records unresolved', async () => {
    const first = await save({ service_id: ambiguousServiceId, contract_line_id: lineA });
    const entryId = first.entry.entry_id;
    await save({ entry_id: entryId, service_id: ambiguousServiceId, contract_line_id: null });
    const row = await readRow(entryId);
    expect(row.contract_line_source).toBe('unresolved');
    expect(row.contract_line_id).toBeNull();
  }, HOOK_TIMEOUT);

  it('un-picking a saved explicit line leaves the column NULL and source unresolved (visible to UnresolvedChargeReview)', async () => {
    const first = await save({ service_id: ambiguousServiceId, contract_line_id: lineA });
    const entryId = first.entry.entry_id;
    expect((await readRow(entryId)).contract_line_id).toBe(lineA);

    await save({ entry_id: entryId, service_id: ambiguousServiceId, contract_line_id: null });
    const nulled = await readRow(entryId);
    expect(nulled.contract_line_id).toBeNull();
    expect(nulled.contract_line_source).toBe('unresolved');

    // Defence in depth: a caller that omits the id (undefined, which knex would
    // skip) must not leave a stale id behind either.
    await save({ entry_id: entryId, service_id: ambiguousServiceId, contract_line_id: lineA });
    expect((await readRow(entryId)).contract_line_id).toBe(lineA);
    await save({ entry_id: entryId, service_id: ambiguousServiceId });
    const omitted = await readRow(entryId);
    expect(omitted.contract_line_id).toBeNull();
    expect(omitted.contract_line_source).toBe('unresolved');
  }, HOOK_TIMEOUT);

  it('an unambiguous service saved without an id is server-resolved (auto_*), never explicit', async () => {
    const saved = await save({ service_id: uniqueServiceId });
    const row = await readRow(saved.entry.entry_id);
    expect(row.contract_line_id).toBe(uniqueLine);
    expect(row.contract_line_source).toMatch(/^auto_/);
  }, HOOK_TIMEOUT);
});
