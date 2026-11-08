import { afterEach, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import knexLib from 'knex';
import type { Knex } from 'knex';
import { evaluatePrepaidBalanceAlertsForTenant } from 'server/src/lib/eventBus/subscribers/prepaidBalanceAlertEvaluator';
import { replenishOpenPrepaidBalanceAlerts } from 'server/src/lib/eventBus/subscribers/prepaidAutoReplenishment';

// Guarded DB tests for Prepaid Block usage-triggered follow-ons (plan sections
// 6 and 9): the alert subject, the draft/auto_issue follow-on invoice, the
// one-open-follow-on rule, horizon suppression and the manual issue action.
// Run with HOUR_BLOCK_DB_TESTS=1 (see prepaidBlockInvoicing.db.test.ts for the
// env vars).
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
let userId: string;

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn({ user_id: userId, user_type: 'internal' }, { tenant }, ...args),
  getSession: vi.fn(async () => ({ user: { id: userId } })),
}));
vi.mock('@alga-psa/auth/withAuth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn({ user_id: userId, user_type: 'internal' }, { tenant }, ...args),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));
vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<any>('@alga-psa/db');
  return { ...actual, createTenantKnex: vi.fn(async () => ({ knex: db, tenant })) };
});
vi.mock('@alga-psa/core', async () => {
  const actual = await vi.importActual<any>('@alga-psa/core');
  return { ...actual, enqueueImmediateJob: vi.fn(async () => undefined) };
});
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));
vi.mock('@alga-psa/billing/services/accountingSync/syncProducers', () => ({
  enqueueInvoiceAutoExport: vi.fn(async () => undefined),
  enqueueInvoiceVoid: vi.fn(async () => undefined),
}));
vi.mock('@alga-psa/billing/services/accountingSync/invoiceTerminalStatusHandlers', () => ({
  notifyInvoiceTerminalStatus: vi.fn(async () => undefined),
}));
vi.mock('@alga-psa/billing/services/accountingSync/accountingSyncSettings', () => ({
  hasConnectedQboRealm: vi.fn(async () => false),
}));
vi.mock('@alga-psa/billing/services/autopayBridge', () => ({
  signalAutopayInvoiceSettled: vi.fn(async () => undefined),
  startInvoiceAutopay: vi.fn(async () => undefined),
}));

interface World {
  clientId: string;
  serviceId: string;
  lineId: string;
  clientContractId: string;
  blockId: string;
}

async function setup(opts: {
  total?: number;
  remaining?: number;
  tier?: 'draft' | 'auto_issue';
  thresholdPercent?: number | null;
  contractEnd?: string | null;
} = {}): Promise<World> {
  db = knexLib({ client: 'pg', connection: config, pool: { min: 0, max: 4 } });
  tenant = uuidv4();
  userId = uuidv4();
  const clientId = uuidv4();
  const typeId = uuidv4();
  const serviceId = uuidv4();
  const contractId = uuidv4();
  const lineId = uuidv4();
  const clientContractId = uuidv4();
  const blockId = uuidv4();

  await db('tenants').insert({ tenant, client_name: 'PBR Tenant', email: 'pbr@test.local', billing_source: 'test' });
  await db('clients').insert({ tenant, client_id: clientId, client_name: 'PBR Client' });
  await db('service_types').insert({ id: typeId, tenant, name: 'PBR Type', is_active: true, order_number: 1 });
  await db('service_catalog').insert({
    service_id: serviceId, tenant, service_name: 'Remote Support', custom_service_type_id: typeId,
    billing_method: 'hourly', default_rate: 11000, unit_of_measure: 'hour',
    category_id: null, tax_rate_id: null, item_kind: 'service', is_active: true, is_license: false,
  });
  await db('users').insert({
    user_id: userId, tenant, username: `pbr_${userId.slice(0, 8)}`, hashed_password: 'x',
    email: `pbr_${userId.slice(0, 8)}@test.local`, user_type: 'internal', first_name: 'P', last_name: 'R',
  });
  await db('contracts').insert({ tenant, contract_id: contractId, contract_name: 'PBR Contract', currency_code: 'EUR', status: 'active', is_active: true });
  await db('client_contracts').insert({
    tenant, client_contract_id: clientContractId, client_id: clientId, contract_id: contractId,
    start_date: '2020-01-01', end_date: opts.contractEnd ?? null, is_active: true,
    ...(opts.contractEnd ? { renewal_mode: 'none' } : {}),
  });
  await db('contract_lines').insert({
    tenant, contract_line_id: lineId, contract_id: contractId, contract_line_name: 'PBR Line', contract_line_type: 'Hourly',
  });
  await db('contract_line_services').insert({ tenant, contract_line_id: lineId, service_id: serviceId });
  await db('contract_line_prepaid_blocks').insert({
    tenant, contract_line_id: lineId, block_minutes: 2400, block_price: 440000, expiry_months: 12,
    trigger_on_exhaustion: true, trigger_threshold_percent: opts.thresholdPercent ?? null,
    replenishment_tier: opts.tier ?? 'draft', sold_as_service_id: serviceId,
  });
  await db('hour_blocks').insert({
    block_id: blockId, tenant, client_id: clientId, service_id: serviceId,
    total_minutes: opts.total ?? 2400, remaining_minutes: opts.remaining ?? 0, hourly_rate: 11000, purchase_amount: 440000,
    currency_code: 'EUR', status: 'active', purchased_at: new Date().toISOString(), source_type: 'contract',
    expiration_date: new Date(Date.now() + 200 * 86400000).toISOString().slice(0, 10),
    contract_line_id: lineId, client_contract_id: clientContractId, service_period_record_id: uuidv4(),
  });
  return { clientId, serviceId, lineId, clientContractId, blockId };
}

afterEach(async () => {
  if (!db) return;
  for (const table of [
    'prepaid_balance_alert_deliveries', 'prepaid_balance_alerts', 'hour_block_time_allocations', 'hour_block_audit',
    'hour_block_service_scopes', 'hour_blocks', 'contract_line_block_issuances', 'transactions', 'invoice_charge_details',
    'invoice_charges', 'invoices', 'client_billing_cycles', 'client_billing_profiles', 'contract_line_prepaid_blocks', 'contract_line_services', 'client_billing_settings',
    'contract_lines', 'client_contracts', 'contracts', 'service_catalog', 'service_types', 'users', 'clients', 'next_number', 'tenants',
  ]) {
    if (await db.schema.hasTable(table)) await db(table).where({ tenant }).delete();
  }
  await db.destroy();
});

const evaluate = (w: World) => evaluatePrepaidBalanceAlertsForTenant(db, tenant, w.clientId);
const replenish = (w: World) => replenishOpenPrepaidBalanceAlerts(db, tenant, w.clientId);
const alerts = () => db('prepaid_balance_alerts').where({ tenant, alert_type: 'prepaid_block' });
const pendingBlocks = () => db('hour_blocks').where({ tenant, status: 'pending' });

describe.runIf(enabled)('Prepaid Block usage-triggered follow-on', () => {
  it('exhaustion drafts exactly one follow-on invoice in the contract currency; a second trigger while pending is a no-op', async () => {
    const w = await setup();
    await evaluate(w);
    const [alert] = await alerts();
    expect(alert).toMatchObject({ hour_block_id: w.blockId, contract_line_id: w.lineId, bucket_percent: null });
    expect(alert.dedupe_key).toBe(`prepaid_block:${w.lineId}:${w.blockId}:exhausted`);

    const first = await replenish(w);
    expect(first.created).toBe(1);

    const pending = await pendingBlocks();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ contract_line_id: w.lineId, total_minutes: 2400, currency_code: 'EUR' });
    const invoice = await db('invoices').where({ tenant, invoice_id: pending[0].source_invoice_id }).first();
    expect(invoice).toMatchObject({ status: 'draft', currency_code: 'EUR' });
    expect(Number(invoice.total_amount)).toBe(440000);
    const issuance = await db('contract_line_block_issuances').where({ tenant, contract_line_id: w.lineId }).first();
    expect(issuance).toMatchObject({ trigger_kind: 'exhaustion', status: 'invoiced', source_block_id: w.blockId });
    expect((await alerts())[0]).toMatchObject({ replenishment_status: 'pending', replenishment_invoice_id: invoice.invoice_id });

    // Second trigger: re-evaluate and re-run replenishment.
    await evaluate(w);
    const second = await replenish(w);
    expect(second.created).toBe(0);
    expect(await alerts()).toHaveLength(1);
    expect(await pendingBlocks()).toHaveLength(1);
    expect(await db('invoices').where({ tenant })).toHaveLength(1);
  });

  it('auto_issue finalizes the follow-on and activates the block at finalize (no payment wait)', async () => {
    const w = await setup({ tier: 'auto_issue' });
    await evaluate(w);
    const summary = await replenish(w);
    expect(summary).toMatchObject({ created: 1, autoIssued: 1 });

    const blocks = await db('hour_blocks').where({ tenant, contract_line_id: w.lineId, status: 'active' }).whereNot({ block_id: w.blockId });
    expect(blocks).toHaveLength(1);
    expect(blocks[0].total_minutes).toBe(2400);
    expect((await alerts())[0].replenishment_status).toBe('issued');
    expect(await pendingBlocks()).toHaveLength(0);
  });

  it('threshold fires once per block', async () => {
    const w = await setup({ total: 1000, remaining: 150, thresholdPercent: 80 });
    await evaluate(w);
    const rows = await alerts();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ bucket_percent: 80 });
    expect(rows[0].dedupe_key).toBe(`prepaid_block:${w.lineId}:${w.blockId}:80pct`);

    expect((await replenish(w)).created).toBe(1);
    expect(await db('contract_line_block_issuances').where({ tenant, trigger_kind: 'threshold' })).toHaveLength(1);

    // More usage and repeated evaluation: still the same single episode.
    await db('hour_blocks').where({ tenant, block_id: w.blockId }).update({ remaining_minutes: 100 });
    await evaluate(w);
    await evaluate(w);
    expect((await replenish(w)).created).toBe(0);
    expect(await alerts()).toHaveLength(1);
    expect(await pendingBlocks()).toHaveLength(1);
  });

  it('the horizon suppresses the follow-on when the contract ends soon', async () => {
    const w = await setup({ contractEnd: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10) });
    await evaluate(w);
    const summary = await replenish(w);
    expect(summary.created).toBe(0);
    expect(summary.skipped).toBe(1);
    expect((await alerts())[0].replenishment_status).toBe('skipped');
    expect(await pendingBlocks()).toHaveLength(0);
    expect(await db('invoices').where({ tenant })).toHaveLength(0);
    expect(await db('contract_line_block_issuances').where({ tenant })).toHaveLength(0);
  });

  it('refuses when an open scheduled issuance exists, and supersedes only a pending expiry issuance', async () => {
    const w = await setup();
    await db('contract_line_block_issuances').insert({
      tenant, issuance_id: uuidv4(), contract_line_id: w.lineId, client_contract_id: w.clientContractId,
      client_id: w.clientId, trigger_kind: 'manual', due_date: '2099-01-01', status: 'scheduled',
    });
    await evaluate(w);
    expect((await replenish(w)).created).toBe(0);
    expect(await pendingBlocks()).toHaveLength(0);

    await db('contract_line_block_issuances').where({ tenant }).update({ trigger_kind: 'expiry', source_block_id: w.blockId });
    expect((await replenish(w)).created).toBe(1);
    const rows = await db('contract_line_block_issuances').where({ tenant }).orderBy('created_at');
    expect(rows.map((r) => [r.trigger_kind, r.status])).toEqual([['expiry', 'superseded'], ['exhaustion', 'invoiced']]);
  });
});

describe.runIf(enabled)('issueNextPrepaidBlock', () => {
  it('queues a manual issuance due today and refuses while one is open', async () => {
    const w = await setup({ remaining: 500 });
    const { issueNextPrepaidBlock } = await import('@alga-psa/billing/actions/prepaidBlockActions');
    const result = await (issueNextPrepaidBlock as any)(w.lineId);
    expect(result.issuanceId).toBeTruthy();
    const row = await db('contract_line_block_issuances').where({ tenant, issuance_id: result.issuanceId }).first();
    expect(row).toMatchObject({ trigger_kind: 'manual', status: 'scheduled', client_contract_id: w.clientContractId, client_id: w.clientId });

    const again = await (issueNextPrepaidBlock as any)(w.lineId);
    expect(again.message ?? again.error ?? JSON.stringify(again)).toMatch(/already scheduled/);
    expect(await db('contract_line_block_issuances').where({ tenant })).toHaveLength(1);
  });
});
