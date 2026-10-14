import { afterEach, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import knexLib from 'knex';
import { toCalendarDateStringInTimeZone } from '@alga-psa/core';
import { expiredHourBlocksHandler } from '../src/lib/handlers/expiredHourBlocksHandler';

// Guarded DB tests for contract-end forfeiture in the expiry job (alga-2026-0002695,
// captain decision 2): active blocks of an ended, un-renewed assignment expire with a
// contract_end_expiration audit row. Run with HOUR_BLOCK_DB_TESTS=1 (see
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
    start_date: '2020-01-01', end_date: shiftDays(-1), is_active: true,
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
    expiration_date: opts.expiration, contract_line_id: w.lineId, client_contract_id: w.clientContractId,
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

async function insertBlock(w: W, opts: {
  lineId?: string | null; clientContractId?: string | null; remaining?: number; status?: string; expiration?: string | null; sourceType?: string;
}) {
  const blockId = uuidv4();
  const contractOwned = (opts.sourceType ?? 'contract') === 'contract';
  await db('hour_blocks').insert({
    block_id: blockId, tenant, client_id: w.clientId, service_id: w.serviceId,
    total_minutes: 600, remaining_minutes: opts.remaining ?? 90, hourly_rate: 10000, purchase_amount: 100000,
    currency_code: 'EUR', status: opts.status ?? 'active', purchased_at: '2025-06-01T00:00:00Z',
    source_type: opts.sourceType ?? 'contract', expiration_date: opts.expiration === undefined ? shiftDays(200) : opts.expiration,
    contract_line_id: contractOwned ? (opts.lineId ?? w.lineId) : null,
    client_contract_id: contractOwned ? (opts.clientContractId ?? w.clientContractId) : null,
  });
  return blockId;
}

const blockRow = (blockId: string) => db('hour_blocks').where({ tenant, block_id: blockId }).first();

async function insertIssuance(w: W, kind: string, status = 'scheduled', sourceBlockId: string | null = null) {
  const issuanceId = uuidv4();
  await db('contract_line_block_issuances').insert({
    tenant, issuance_id: issuanceId, contract_line_id: w.lineId, client_contract_id: w.clientContractId,
    client_id: w.clientId, trigger_kind: kind, due_date: shiftDays(30), status, source_block_id: sourceBlockId,
  });
  return issuanceId;
}

/** A second, still-running contract with its own line, assignment and block. */
async function addRunningContract(w: W) {
  const contractId = uuidv4();
  const lineId = uuidv4();
  const clientContractId = uuidv4();
  await db('contracts').insert({ tenant, contract_id: contractId, contract_name: 'Running', currency_code: 'EUR', status: 'active' });
  await db('client_contracts').insert({
    tenant, client_contract_id: clientContractId, client_id: w.clientId, contract_id: contractId, start_date: '2020-01-01', is_active: true,
  });
  await db('contract_lines').insert({ tenant, contract_line_id: lineId, contract_id: contractId, contract_line_name: 'Run line', contract_line_type: 'Hourly' });
  await db('contract_line_services').insert({ tenant, contract_line_id: lineId, service_id: w.serviceId });
  await db('contract_line_prepaid_blocks').insert({
    tenant, contract_line_id: lineId, block_minutes: 600, block_price: 100000, expiry_months: 12, sold_as_service_id: w.serviceId,
  });
  return { contractId, lineId, clientContractId };
}

describe.runIf(enabled)('Prepaid Block contract-end forfeiture', () => {
  it('expires active blocks of an ended assignment keeping the minutes, audits it, and cancels the line\'s scheduled issuances', async () => {
    const w = await setup();
    const forfeited = await insertBlock(w, { remaining: 90 });
    const exhausted = await insertBlock(w, { remaining: 0 });
    const expiryIssuance = await insertIssuance(w, 'expiry', 'scheduled', forfeited);

    await expiredHourBlocksHandler({ tenantId: tenant });

    const row = await blockRow(forfeited);
    expect(row.status).toBe('expired');
    expect(row.remaining_minutes).toBe(90);
    const audit = await db('hour_block_audit').where({ tenant, block_id: forfeited });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ type: 'contract_end_expiration' });
    expect(audit[0].metadata).toMatchObject({ client_contract_id: w.clientContractId, remaining_minutes_at_expiration: 90 });
    // Nothing left to forfeit on an exhausted block.
    expect((await blockRow(exhausted)).status).toBe('active');
    expect((await db('contract_line_block_issuances').where({ tenant, issuance_id: expiryIssuance }).first()).status).toBe('superseded');

    // Idempotent: a second run changes nothing.
    await expiredHourBlocksHandler({ tenantId: tenant });
    expect(await db('hour_block_audit').where({ tenant, block_id: forfeited })).toHaveLength(1);
  });

  it('cancels scheduled non-expiry issuances of the ended line', async () => {
    const w = await setup();
    await insertBlock(w, { remaining: 90 });
    const exhaustion = await insertIssuance(w, 'exhaustion');
    await expiredHourBlocksHandler({ tenantId: tenant });
    expect((await db('contract_line_block_issuances').where({ tenant, issuance_id: exhaustion }).first()).status).toBe('cancelled');
  });

  it('also forfeits when the assignment was deactivated before its end date', async () => {
    const w = await setup();
    await db('client_contracts').where({ tenant, client_contract_id: w.clientContractId }).update({ end_date: shiftDays(60), is_active: false });
    const blockId = await insertBlock(w, { remaining: 45 });
    await expiredHourBlocksHandler({ tenantId: tenant });
    expect((await blockRow(blockId)).status).toBe('expired');
    expect((await db('hour_block_audit').where({ tenant, block_id: blockId }).first()).type).toBe('contract_end_expiration');
  });

  it('leaves ad-hoc blocks, other contracts\' blocks and blocks of a still-running assignment untouched', async () => {
    const w = await setup();
    const other = await addRunningContract(w);
    const adHoc = await insertBlock(w, { sourceType: 'purchase', expiration: null, remaining: 300 });
    const otherBlock = await insertBlock(w, { lineId: other.lineId, clientContractId: other.clientContractId, remaining: 300 });
    const forfeited = await insertBlock(w, { remaining: 90 });

    await expiredHourBlocksHandler({ tenantId: tenant });

    expect((await blockRow(forfeited)).status).toBe('expired');
    expect((await blockRow(adHoc)).status).toBe('active');
    expect((await blockRow(otherBlock)).status).toBe('active');
    expect(await db('hour_block_audit').where({ tenant }).whereIn('block_id', [adHoc, otherBlock])).toHaveLength(0);

    // A still-running (open ended or future-dated) assignment is never forfeited.
    await db('client_contracts').where({ tenant, client_contract_id: w.clientContractId }).update({ end_date: shiftDays(10) });
    const live = await insertBlock(w, { remaining: 10 });
    await expiredHourBlocksHandler({ tenantId: tenant });
    expect((await blockRow(live)).status).toBe('active');
  });

  it('leaves pending blocks alone while the assignment is ended (the next pass forfeits them once active)', async () => {
    const w = await setup();
    const pending = await insertBlock(w, { status: 'pending', remaining: 600 });
    await expiredHourBlocksHandler({ tenantId: tenant });
    expect((await blockRow(pending)).status).toBe('pending');
    expect(await db('hour_block_audit').where({ tenant, block_id: pending })).toHaveLength(0);

    // Activation (finalize) makes it active; the following pass forfeits it with minutes kept.
    await db('hour_blocks').where({ tenant, block_id: pending }).update({ status: 'active' });
    await expiredHourBlocksHandler({ tenantId: tenant });
    const row = await blockRow(pending);
    expect(row.status).toBe('expired');
    expect(row.remaining_minutes).toBe(600);
  });

  it('skips a renewing assignment whose renewal contract is already active (its blocks are about to be re-owned)', async () => {
    const w = await setup();
    const renewalContractId = uuidv4();
    await db('contracts').insert({ tenant, contract_id: renewalContractId, contract_name: 'Renewal', currency_code: 'EUR', status: 'active' });
    await db('client_contracts').where({ tenant, client_contract_id: w.clientContractId })
      .update({ status: 'renewing', created_draft_contract_id: renewalContractId });
    const blockId = await insertBlock(w, { remaining: 90 });

    await expiredHourBlocksHandler({ tenantId: tenant });
    expect((await blockRow(blockId)).status).toBe('active');

    // Renewal contract not (yet) active: the block is forfeited as usual.
    await db('contracts').where({ tenant, contract_id: renewalContractId }).update({ status: 'draft' });
    await expiredHourBlocksHandler({ tenantId: tenant });
    expect((await blockRow(blockId)).status).toBe('expired');
  });

  it('keeps time that drew a forfeited block billed exactly once (not re-drawn onto another block)', async () => {
    const w = await setup();
    const other = await addRunningContract(w);
    const forfeited = await insertBlock(w, { remaining: 30 });
    const otherBlock = await insertBlock(w, { lineId: other.lineId, clientContractId: other.clientContractId, remaining: 600 });
    const entryId = uuidv4();
    const start = new Date(`${shiftDays(-5)}T08:00:00.000Z`);
    await db('time_entries').insert({
      entry_id: entryId, tenant, user_id: w.userId, service_id: w.serviceId,
      work_item_id: w.ticketId, work_item_type: 'ticket',
      start_time: start.toISOString(), end_time: new Date(start.getTime() + 60 * 60000).toISOString(),
      work_date: shiftDays(-5), work_timezone: 'UTC', billable_duration: 60,
      approval_status: 'APPROVED', invoiced: false, contract_line_id: w.lineId,
    });
    await db('hour_block_time_allocations').insert({ tenant, block_id: forfeited, time_entry_id: entryId, minutes: 60 });

    await expiredHourBlocksHandler({ tenantId: tenant });
    await expiredHourBlocksHandler({ tenantId: tenant });

    const allocations = await db('hour_block_time_allocations').where({ tenant, time_entry_id: entryId });
    expect(allocations.map((a) => [a.block_id, Number(a.minutes)])).toEqual([[forfeited, 60]]);
    expect((await blockRow(otherBlock)).remaining_minutes).toBe(600);
    expect((await blockRow(forfeited)).status).toBe('expired');
  });
});
