import { afterEach, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import knexLib from 'knex';
import { toCalendarDateStringInTimeZone } from '@alga-psa/core';
import { expiredHourBlocksHandler } from '../src/lib/handlers/expiredHourBlocksHandler';
import { expiringHourBlocksNotificationHandler } from '../src/lib/handlers/expiringHourBlocksNotificationHandler';

// Guarded DB tests for the Prepaid Block parts of the hour-block jobs (plan
// sections 6 and 9): the expiry job writes its auto_expiration audit row and
// re-draws the line, and the expiring-soon notification includes contract
// blocks with the contract name. Run with HOUR_BLOCK_DB_TESTS=1 (see
// hourBlockAutoExpireTimezone.db.test.ts for the env vars).
const enabled = process.env.HOUR_BLOCK_DB_TESTS === '1';

const config = {
  host: process.env.HOUR_BLOCK_DB_HOST || '127.0.0.1',
  port: Number(process.env.HOUR_BLOCK_DB_PORT || 6472),
  user: process.env.HOUR_BLOCK_DB_USER || 'app_user',
  password: process.env.HOUR_BLOCK_DB_PASSWORD || '',
  database: process.env.HOUR_BLOCK_DB_NAME || 'server',
};

let db: Knex;
let tenant: string;

const { publishEventMock } = vi.hoisted(() => ({ publishEventMock: vi.fn(async (_event: any) => undefined) }));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: publishEventMock,
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));
vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<any>('@alga-psa/db');
  return {
    ...actual,
    getConnection: vi.fn(async () => db),
    runWithTenant: vi.fn(async (_tenantId: string, fn: () => Promise<void>) => fn()),
  };
});

const today = () => toCalendarDateStringInTimeZone(new Date(), 'UTC');
const shiftDays = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

async function setup() {
  db = knexLib({ client: 'pg', connection: config, pool: { min: 0, max: 4 } });
  tenant = uuidv4();
  const userId = uuidv4();
  const clientId = uuidv4();
  const typeId = uuidv4();
  const serviceId = uuidv4();
  const ticketId = uuidv4();
  const contractId = uuidv4();
  const lineId = uuidv4();
  const clientContractId = uuidv4();

  await db('tenants').insert({ tenant, client_name: 'PBJ Tenant', email: 'pbj@test.local', billing_source: 'test' });
  await db('tenant_settings').insert({ tenant, settings: {} });
  await db('default_billing_settings').insert({
    tenant, credit_expiration_notification_days: [7], zero_dollar_invoice_handling: 'normal', suppress_zero_dollar_invoices: true,
  });
  await db('clients').insert({ tenant, client_id: clientId, client_name: 'PBJ Client' });
  await db('service_types').insert({ id: typeId, tenant, name: 'PBJ Type', is_active: true, order_number: 1 });
  await db('service_catalog').insert({
    service_id: serviceId, tenant, service_name: 'Remote Support', custom_service_type_id: typeId,
    billing_method: 'hourly', default_rate: 11000, unit_of_measure: 'hour',
    category_id: null, tax_rate_id: null, item_kind: 'service', is_active: true, is_license: false,
  });
  await db('users').insert({
    user_id: userId, tenant, username: `pbj_${userId.slice(0, 8)}`, hashed_password: 'x',
    email: `pbj_${userId.slice(0, 8)}@test.local`, user_type: 'internal', first_name: 'P', last_name: 'J',
  });
  await db('tickets').insert({ tenant, ticket_id: ticketId, client_id: clientId, title: 'PBJ', ticket_number: `PBJ-${ticketId.slice(0, 8)}` });
  await db('contracts').insert({ tenant, contract_id: contractId, contract_name: 'Gold Support', currency_code: 'EUR', status: 'active' });
  await db('client_contracts').insert({
    tenant, client_contract_id: clientContractId, client_id: clientId, contract_id: contractId,
    start_date: '2020-01-01', is_active: true,
  });
  await db('contract_lines').insert({
    tenant, contract_line_id: lineId, contract_id: contractId, contract_line_name: 'PBJ Line', contract_line_type: 'Hourly',
  });
  await db('contract_line_services').insert({ tenant, contract_line_id: lineId, service_id: serviceId });
  await db('contract_line_prepaid_blocks').insert({
    tenant, contract_line_id: lineId, block_minutes: 600, block_price: 100000, expiry_months: 12, sold_as_service_id: serviceId,
  });
  return { userId, clientId, serviceId, ticketId, contractId, lineId, clientContractId };
}

type W = Awaited<ReturnType<typeof setup>>;

async function insertContractBlock(w: W, opts: { total: number; remaining: number; expiration: string; purchasedAt: string }) {
  const blockId = uuidv4();
  await db('hour_blocks').insert({
    block_id: blockId, tenant, client_id: w.clientId, service_id: w.serviceId,
    total_minutes: opts.total, remaining_minutes: opts.remaining, hourly_rate: 10000, purchase_amount: 100000,
    currency_code: 'EUR', status: 'active', purchased_at: opts.purchasedAt, source_type: 'contract',
    expiration_date: opts.expiration, contract_line_id: w.lineId, client_contract_id: w.clientContractId, service_period_record_id: uuidv4(),
  });
  return blockId;
}

afterEach(async () => {
  if (!db) return;
  publishEventMock.mockClear();
  await db('role_permissions').where({ tenant }).delete();
  await db('permissions').where({ tenant }).delete();
  for (const table of [
    'hour_block_time_allocations', 'hour_block_audit', 'hour_block_service_scopes', 'hour_blocks',
    'contract_line_block_issuances', 'time_entries', 'tickets', 'contract_line_prepaid_blocks', 'contract_line_services',
    'contract_lines', 'client_contracts', 'contracts', 'service_catalog', 'service_types', 'users', 'clients',
    'tenant_settings', 'default_billing_settings', 'tenants',
  ]) {
    await db(table).where({ tenant }).delete();
  }
  await db.destroy();
});

describe.runIf(enabled)('Prepaid Block expiry job', () => {
  it('expires a contract block with an auto_expiration audit row and re-draws the line onto the remaining block', async () => {
    const w = await setup();
    const expiring = await insertContractBlock(w, { total: 600, remaining: 30, expiration: shiftDays(-1), purchasedAt: '2025-01-01T00:00:00Z' });
    const newer = await insertContractBlock(w, { total: 600, remaining: 600, expiration: shiftDays(200), purchasedAt: '2025-06-01T00:00:00Z' });

    // An uninvoiced entry on the line with no draw yet (e.g. logged while the
    // expiring block was the only candidate and was exhausted by other work).
    const entryId = uuidv4();
    const start = new Date(`${today()}T08:00:00.000Z`);
    await db('time_entries').insert({
      entry_id: entryId, tenant, user_id: w.userId, service_id: w.serviceId,
      work_item_id: w.ticketId, work_item_type: 'ticket',
      start_time: start.toISOString(), end_time: new Date(start.getTime() + 60 * 60000).toISOString(),
      work_date: today(), work_timezone: 'UTC', billable_duration: 60,
      approval_status: 'APPROVED', invoiced: false, contract_line_id: w.lineId,
    });

    await expiredHourBlocksHandler({ tenantId: tenant });

    expect((await db('hour_blocks').where({ tenant, block_id: expiring }).first()).status).toBe('expired');
    const audit = await db('hour_block_audit').where({ tenant, block_id: expiring });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ type: 'auto_expiration' });
    expect(audit[0].metadata.remaining_minutes_at_expiration).toBe(30);

    // The line was re-drawn: the entry now draws from the still-active block.
    const allocations = await db('hour_block_time_allocations').where({ tenant, time_entry_id: entryId });
    expect(allocations.map((a) => [a.block_id, Number(a.minutes)])).toEqual([[newer, 60]]);
    expect((await db('hour_blocks').where({ tenant, block_id: newer }).first()).remaining_minutes).toBe(540);
  });
});

describe.runIf(enabled)('Prepaid Block expiring-soon notification', () => {
  it('includes contract blocks and names their contract', async () => {
    const w = await setup();
    const blockId = await insertContractBlock(w, { total: 600, remaining: 120, expiration: shiftDays(7), purchasedAt: '2025-06-01T00:00:00Z' });
    const clientBlockId = uuidv4();
    await db('hour_blocks').insert({
      block_id: clientBlockId, tenant, client_id: w.clientId, service_id: w.serviceId,
      total_minutes: 600, remaining_minutes: 600, hourly_rate: 10000, purchase_amount: 60000,
      currency_code: 'EUR', status: 'active', purchased_at: new Date().toISOString(), source_type: 'grant',
      expiration_date: shiftDays(7),
    });

    await expiringHourBlocksNotificationHandler({ tenantId: tenant });

    expect(publishEventMock).toHaveBeenCalledTimes(1);
    const payload = publishEventMock.mock.calls[0][0].payload;
    const byId = Object.fromEntries(payload.blocks.map((b: any) => [b.blockId, b]));
    expect(byId[blockId]).toMatchObject({ remainingMinutes: 120, contractName: 'Gold Support' });
    expect(byId[clientBlockId].contractName ?? null).toBeNull();
  });
});
