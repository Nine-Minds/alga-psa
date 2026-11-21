/**
 * Real-core coverage for work-item deletion and its billing reversals.
 *
 * The action, transaction, deleteTimeEntryCore, bucket draw service, and hour
 * block reversal service all run against the migrated integration database.
 * Only the authentication/permission boundary, time-source dispatch, and event
 * publisher are isolated.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';
import { tenantDb } from '@alga-psa/db';
import { adjustTimeSpanDraw } from '@alga-psa/shared/billingClients/drawAdjustments';
import { allocateTimeEntry } from '@alga-psa/shared/billingClients/hourBlockService';

let db: Knex;
let tenantId: string;
let ownerId: string;
let coworkerId: string;
let canDelegateTenantWide = false;
let clientId: string;
let serviceId: string;
let contractLineId: string;
let bucketId: string;
let hourBlockId: string;
let ticketId: string;
let otherTicketId: string;
let periodId: string;
let sheetId: string;
let otherSheetId: string;
let coworkerSheetId: string;
let deleteWorkItem: typeof import('@alga-psa/scheduling/actions/timeEntryActions').deleteWorkItem;

vi.mock('@alga-psa/auth', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/auth')>('@alga-psa/auth');
  return {
    ...actual,
    withAuth: (action: any) => (...args: any[]) => action(
      { user_id: ownerId, user_type: 'internal', tenant: tenantId },
      { tenant: tenantId },
      ...args,
    ),
    hasPermission: vi.fn(async (_user: unknown, resource: string, action: string) =>
      (resource === 'time_entry' && action === 'delete') ||
      (canDelegateTenantWide && resource === 'time_sheet' && ['approve', 'read_all'].includes(action))),
  };
});

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db })),
  };
});

vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent: vi.fn(async () => undefined) }));
vi.mock('../../../../packages/scheduling/src/lib/timeSource', () => ({
  delegateToTimeSource: vi.fn(async () => ({ handled: false })),
}));

interface SeededEntry {
  entryId: string;
  workItemId: string;
  timeSheetId: string;
  invoiced?: boolean;
}

async function cleanupTenant(): Promise<void> {
  if (!db || !tenantId) return;
  for (const table of [
    'hour_block_time_allocations', 'hour_block_audit', 'hour_blocks', 'bucket_usage',
    'time_entries', 'time_sheets', 'time_periods', 'tickets',
    'contract_line_bucket_services', 'contract_line_buckets', 'contract_line_prepaid_blocks',
    'contract_line_services', 'client_contracts', 'contract_lines', 'contracts',
    'service_catalog', 'service_types', 'client_locations', 'clients', 'users', 'tenants',
  ]) {
    await db(table).where({ tenant: tenantId }).delete();
  }
}

async function seedLedger(): Promise<void> {
  canDelegateTenantWide = false;
  tenantId = await createTenant(db, `Delete billing ${randomUUID().slice(0, 8)}`);
  ownerId = await createUser(db, tenantId, {
    email: `delete-billing-${randomUUID().slice(0, 8)}@example.com`,
    user_type: 'internal',
  });
  coworkerId = await createUser(db, tenantId, {
    email: `delete-coworker-${randomUUID().slice(0, 8)}@example.com`,
    user_type: 'internal',
  });
  clientId = await createClient(db, tenantId, `Delete billing client ${randomUUID().slice(0, 6)}`);
  serviceId = randomUUID();
  contractLineId = randomUUID();
  bucketId = randomUUID();
  hourBlockId = randomUUID();
  ticketId = randomUUID();
  otherTicketId = randomUUID();
  periodId = randomUUID();
  sheetId = randomUUID();
  otherSheetId = randomUUID();
  coworkerSheetId = randomUUID();

  const scoped = tenantDb(db, tenantId);
  const serviceTypeId = randomUUID();
  const contractId = randomUUID();
  const clientContractId = randomUUID();
  await scoped.table('service_types').insert({
    tenant: tenantId, id: serviceTypeId, name: `Delete type ${serviceTypeId.slice(0, 6)}`, is_active: true,
  });
  await scoped.table('service_catalog').insert({
    tenant: tenantId, service_id: serviceId, service_name: `Delete service ${serviceId.slice(0, 6)}`,
    billing_method: 'hourly', custom_service_type_id: serviceTypeId,
  });
  await scoped.table('contracts').insert({
    tenant: tenantId, contract_id: contractId, contract_name: `Delete contract ${contractId.slice(0, 6)}`,
  });
  await scoped.table('contract_lines').insert({
    tenant: tenantId, contract_line_id: contractLineId, contract_id: contractId,
    contract_line_name: 'Delete billing line', contract_line_type: 'Bucket',
    billing_frequency: 'monthly', cadence_owner: 'client', is_template: false, is_active: true,
  });
  await scoped.table('client_contracts').insert({
    tenant: tenantId, client_contract_id: clientContractId, client_id: clientId,
    contract_id: contractId, start_date: '2026-01-01', is_active: true,
  });
  await scoped.table('contract_line_services').insert({ tenant: tenantId, contract_line_id: contractLineId, service_id: serviceId });
  await scoped.table('contract_line_prepaid_blocks').insert({
    tenant: tenantId, contract_line_id: contractLineId, sold_as_service_id: serviceId,
    block_minutes: 600, block_price: 100000,
  });
  await scoped.table('contract_line_buckets').insert({
    tenant: tenantId, bucket_id: bucketId, contract_line_id: contractLineId,
    total_minutes: 600, overage_rate: 10000, allow_rollover: false,
    billing_period: 'monthly', covers_all_services: false,
  });
  await scoped.table('contract_line_bucket_services').insert({
    tenant: tenantId, bucket_id: bucketId, contract_line_id: contractLineId,
    service_id: serviceId, burn_multiplier: 1,
  });
  await scoped.table('hour_blocks').insert({
    tenant: tenantId, block_id: hourBlockId, client_id: clientId, service_id: serviceId,
    contract_line_id: contractLineId, service_period_record_id: randomUUID(),
    total_minutes: 600, remaining_minutes: 600, hourly_rate: 10000, purchase_amount: 100000,
    currency_code: 'USD', status: 'active', source_type: 'contract', purchased_at: new Date().toISOString(),
  });
  await scoped.table('tickets').insert([
    { tenant: tenantId, ticket_id: ticketId, client_id: clientId, title: 'Selected ticket', ticket_number: `DEL-${ticketId.slice(0, 8)}` },
    { tenant: tenantId, ticket_id: otherTicketId, client_id: clientId, title: 'Unrelated ticket', ticket_number: `DEL-${otherTicketId.slice(0, 8)}` },
  ]);
  // A user has one sheet per period. Keep both periods in the same billing
  // month so the sheet-isolation case still exercises a shared bucket ledger.
  const otherPeriodId = randomUUID();
  await scoped.table('time_periods').insert([
    { tenant: tenantId, period_id: periodId, start_date: '2026-03-01', end_date: '2026-03-15' },
    { tenant: tenantId, period_id: otherPeriodId, start_date: '2026-03-15', end_date: '2026-04-01' },
  ]);
  await scoped.table('time_sheets').insert([
    { tenant: tenantId, id: sheetId, period_id: periodId, user_id: ownerId, approval_status: 'DRAFT' },
    { tenant: tenantId, id: otherSheetId, period_id: otherPeriodId, user_id: ownerId, approval_status: 'DRAFT' },
    { tenant: tenantId, id: coworkerSheetId, period_id: periodId, user_id: coworkerId, approval_status: 'DRAFT' },
  ]);
}

async function seedAllocatedEntry(params: {
  entryId?: string;
  workItemId?: string;
  timeSheetId?: string;
  userId?: string;
  invoiced?: boolean;
} = {}): Promise<SeededEntry> {
  const entryId = params.entryId ?? randomUUID();
  const workItemId = params.workItemId ?? ticketId;
  const timeSheetId = params.timeSheetId ?? sheetId;
  const workDate = timeSheetId === otherSheetId ? '2026-03-20' : '2026-03-10';
  const start = `${workDate}T10:00:00.000Z`;
  const end = `${workDate}T11:00:00.000Z`;
  await tenantDb(db, tenantId).table('time_entries').insert({
    tenant: tenantId, entry_id: entryId, user_id: params.userId ?? ownerId, time_sheet_id: timeSheetId,
    work_item_id: workItemId, work_item_type: 'ticket', service_id: serviceId,
    contract_line_id: contractLineId, start_time: start, end_time: end,
    work_date: workDate, work_timezone: 'UTC', billable_duration: 60,
    approval_status: 'DRAFT', invoiced: params.invoiced ?? false,
  });
  await db.transaction(async (trx) => {
    await adjustTimeSpanDraw(trx, tenantId, clientId, {
      service_id: serviceId, start_time: start, end_time: end,
      billable_duration: 60, contract_line_id: contractLineId,
    }, 1);
    const allocations = await allocateTimeEntry(trx, tenantId, clientId, {
      entry_id: entryId, service_id: serviceId, work_item_id: workItemId,
      work_item_type: 'ticket', contract_line_id: contractLineId,
      work_date: workDate, start_time: start, billable_duration: 60,
    });
    expect(allocations).toHaveLength(1);
    expect(allocations[0].block_id).toBe(hourBlockId);
    expect(allocations[0].minutes).toBe(60);
  });
  return { entryId, workItemId, timeSheetId, invoiced: params.invoiced };
}

async function usageMinutes(): Promise<number> {
  const rows = await tenantDb(db, tenantId).table('bucket_usage')
    .where({ tenant: tenantId, client_id: clientId, bucket_id: bucketId })
    .sum<{ total: string | number | null }>('minutes_used as total').first();
  return Number(rows?.total ?? 0);
}

async function blockState() {
  const [block, allocations] = await Promise.all([
    tenantDb(db, tenantId).table('hour_blocks').where({ tenant: tenantId, block_id: hourBlockId }).first(),
    tenantDb(db, tenantId).table('hour_block_time_allocations')
      .where({ tenant: tenantId, block_id: hourBlockId }).select('time_entry_id', 'minutes').orderBy('time_entry_id'),
  ]);
  return { remainingMinutes: Number(block.remaining_minutes), allocations };
}

describe('deleteWorkItem authorization and billing reversal through deleteTimeEntryCore (real DB)', () => {
  beforeAll(async () => {
    db = await createTestDbConnection();
    ({ deleteWorkItem } = await import('@alga-psa/scheduling/actions/timeEntryActions'));
  }, 180_000);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  });

  afterEach(async () => {
    await cleanupTenant();
    tenantId = '';
  });

  it('deletes only the selected owner, sheet and item, preserving allocations on the same owner’s next-period sheet', async () => {
    await seedLedger();
    const first = await seedAllocatedEntry({ entryId: '00000000-0000-4000-8000-000000000001' });
    const second = await seedAllocatedEntry({ entryId: '00000000-0000-4000-8000-000000000002' });
    const otherSheet = await seedAllocatedEntry({ timeSheetId: otherSheetId });
    const otherItem = await seedAllocatedEntry({ workItemId: otherTicketId });
    const coworker = await seedAllocatedEntry({ timeSheetId: coworkerSheetId, userId: coworkerId });
    expect(await usageMinutes()).toBe(300);
    expect((await blockState()).remainingMinutes).toBe(300);

    await expect(deleteWorkItem(ticketId, sheetId, 'ticket')).resolves.toBeUndefined();

    const survivingEntries = await tenantDb(db, tenantId).table('time_entries')
      .where({ tenant: tenantId }).select('entry_id').orderBy('entry_id');
    expect(survivingEntries.map((row) => row.entry_id)).toEqual([otherSheet.entryId, otherItem.entryId, coworker.entryId].sort());
    expect(await tenantDb(db, tenantId).table('time_entries')
      .where({ tenant: tenantId }).whereIn('entry_id', [first.entryId, second.entryId])).toHaveLength(0);
    expect(await usageMinutes()).toBe(180);
    expect(await blockState()).toEqual({
      remainingMinutes: 420,
      allocations: [
        { time_entry_id: otherSheet.entryId, minutes: 60 },
        { time_entry_id: otherItem.entryId, minutes: 60 },
        { time_entry_id: coworker.entryId, minutes: 60 },
      ].sort((a, b) => a.time_entry_id.localeCompare(b.time_entry_id)),
    });
  });

  it('denies a delete-only caller targeting a coworker sheet and preserves both billing ledgers', async () => {
    await seedLedger();
    const coworker = await seedAllocatedEntry({ timeSheetId: coworkerSheetId, userId: coworkerId });
    const beforeBlock = await blockState();

    await expect(deleteWorkItem(ticketId, coworkerSheetId, 'ticket')).resolves.toEqual({
      permissionError: 'Permission denied: Cannot access other users time sheets',
    });

    expect(await tenantDb(db, tenantId).table('time_entries')
      .where({ tenant: tenantId, entry_id: coworker.entryId }).first()).toBeDefined();
    expect(await usageMinutes()).toBe(60);
    expect(await blockState()).toEqual(beforeBlock);
  });

  it('checks each entry owner and rolls back earlier reversals when a coworker entry is on the selected sheet', async () => {
    await seedLedger();
    const own = await seedAllocatedEntry({ entryId: '00000000-0000-4000-8000-000000000001' });
    const coworker = await seedAllocatedEntry({
      entryId: '00000000-0000-4000-8000-000000000002', userId: coworkerId,
    });
    const beforeBlock = await blockState();

    await expect(deleteWorkItem(ticketId, sheetId, 'ticket')).resolves.toEqual({
      permissionError: 'Permission denied: Cannot access other users time sheets',
    });

    const surviving = await tenantDb(db, tenantId).table('time_entries')
      .where({ tenant: tenantId }).select('entry_id').orderBy('entry_id');
    expect(surviving.map((row) => row.entry_id)).toEqual([own.entryId, coworker.entryId]);
    expect(await usageMinutes()).toBe(120);
    expect(await blockState()).toEqual(beforeBlock);
  });

  it('allows tenant-wide delegation with approve and read_all while preserving the unselected owner sheet', async () => {
    await seedLedger();
    canDelegateTenantWide = true;
    const own = await seedAllocatedEntry();
    await seedAllocatedEntry({ timeSheetId: coworkerSheetId, userId: coworkerId });

    await expect(deleteWorkItem(ticketId, coworkerSheetId, 'ticket')).resolves.toBeUndefined();

    const surviving = await tenantDb(db, tenantId).table('time_entries')
      .where({ tenant: tenantId }).select('entry_id');
    expect(surviving.map((row) => row.entry_id)).toEqual([own.entryId]);
    expect(await usageMinutes()).toBe(60);
    expect(await blockState()).toEqual({
      remainingMinutes: 540,
      allocations: [{ time_entry_id: own.entryId, minutes: 60 }],
    });
  });

  it('does not reverse either ledger again when the same deletion is repeated', async () => {
    await seedLedger();
    await seedAllocatedEntry();
    const before = await blockState();

    await deleteWorkItem(ticketId, sheetId, 'ticket');
    const afterFirstDelete = { bucketMinutes: await usageMinutes(), block: await blockState() };
    await deleteWorkItem(ticketId, sheetId, 'ticket');

    expect(afterFirstDelete.bucketMinutes).toBe(0);
    expect(afterFirstDelete.block.remainingMinutes).toBe(before.remainingMinutes + 60);
    expect(afterFirstDelete.block.allocations).toHaveLength(0);
    expect(await tenantDb(db, tenantId).table('time_entries')
      .where({ tenant: tenantId, work_item_id: ticketId, time_sheet_id: sheetId })).toHaveLength(0);
    expect(await usageMinutes()).toBe(afterFirstDelete.bucketMinutes);
    expect(await blockState()).toEqual(afterFirstDelete.block);
  });

  it('serializes concurrent deletions so the allocation reversal commits only once', async () => {
    await seedLedger();
    await seedAllocatedEntry();
    const before = await blockState();

    const results = await Promise.all([
      deleteWorkItem(ticketId, sheetId, 'ticket'),
      deleteWorkItem(ticketId, sheetId, 'ticket'),
    ]);

    expect(results.every((result) => result === undefined)).toBe(true);
    expect(await tenantDb(db, tenantId).table('time_entries').where({ tenant: tenantId }).first()).toBeUndefined();
    expect(await usageMinutes()).toBe(0);
    expect(await blockState()).toEqual({ remainingMinutes: before.remainingMinutes + 60, allocations: [] });
  });

  it('rolls back earlier billing reversals when a grouped deletion reaches an invoiced entry', async () => {
    await seedLedger();
    const uninvoiced = await seedAllocatedEntry({ entryId: '00000000-0000-4000-8000-000000000001' });
    const invoiced = await seedAllocatedEntry({
      entryId: '00000000-0000-4000-8000-000000000002', invoiced: true,
    });
    const entryIds = [uninvoiced.entryId, invoiced.entryId].sort();
    const beforeBlock = await blockState();
    expect(await usageMinutes()).toBe(120);
    expect(beforeBlock.remainingMinutes).toBe(480);

    const result = await deleteWorkItem(ticketId, sheetId, 'ticket');

    expect(result).toMatchObject({ actionError: 'This time entry has already been invoiced and cannot be changed.' });
    const surviving = await tenantDb(db, tenantId).table('time_entries')
      .where({ tenant: tenantId }).select('entry_id').orderBy('entry_id');
    expect(surviving.map((row) => row.entry_id)).toEqual(entryIds);
    expect(await usageMinutes()).toBe(120);
    expect(await blockState()).toEqual(beforeBlock);
  });
});
