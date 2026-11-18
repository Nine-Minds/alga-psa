import { afterEach, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import knexLib from 'knex';
import { processRenewalQueueHandler } from '../src/lib/handlers/processRenewalQueueHandler';

// Handler-level DB test for the Prepaid Block renewal trigger (alga-2026-0002695, captain decision
// 1a): processRenewalQueueHandler schedules the `renewal` issuance for an evergreen assignment whose
// anniversary passed, even though the queue's decision-date horizon does not include the row and the
// stored renewal_cycle_* columns still describe the previous cycle. Run with HOUR_BLOCK_DB_TESTS=1
// (see prepaidBlockExpiryJobs.db.test.ts for the env vars).
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

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<any>('@alga-psa/db');
  return { ...actual, createTenantKnex: vi.fn(async () => ({ knex: db, tenant })) };
});

const utcDay = (offsetYears: number, offsetDays: number) => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  d.setUTCFullYear(d.getUTCFullYear() + offsetYears);
  return d.toISOString().slice(0, 10);
};
const dateOnly = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

async function setup(opts: { configCreatedAt?: string } = {}) {
  db = knexLib({ client: 'pg', connection: config, pool: { min: 0, max: 4 } });
  tenant = uuidv4();
  const clientId = uuidv4();
  const typeId = uuidv4();
  const serviceId = uuidv4();
  const contractId = uuidv4();
  const lineId = uuidv4();
  const clientContractId = uuidv4();
  const yesterday = utcDay(0, -1);
  // The anniversary was yesterday: start two years ago, stored cycle = the previous one.
  const startDate = utcDay(-2, -1);

  await db('tenants').insert({ tenant, client_name: 'PBH Tenant', email: 'pbh@test.local', billing_source: 'test' });
  await db('default_billing_settings').insert({
    tenant, zero_dollar_invoice_handling: 'normal', suppress_zero_dollar_invoices: true,
  });
  await db('clients').insert({ tenant, client_id: clientId, client_name: 'PBH Client' });
  await db('service_types').insert({ id: typeId, tenant, name: 'PBH Type', is_active: true, order_number: 1 });
  await db('service_catalog').insert({
    service_id: serviceId, tenant, service_name: 'Remote Support', custom_service_type_id: typeId,
    billing_method: 'hourly', default_rate: 11000, unit_of_measure: 'hour',
    category_id: null, tax_rate_id: null, item_kind: 'service', is_active: true, is_license: false,
  });
  await db('contracts').insert({
    tenant, contract_id: contractId, contract_name: 'Evergreen', currency_code: 'EUR', status: 'active', created_at: `${startDate}T00:00:00Z`,
  });
  await db('client_contracts').insert({
    tenant, client_contract_id: clientContractId, client_id: clientId, contract_id: contractId,
    start_date: startDate, end_date: null, is_active: true, status: 'pending',
    renewal_mode: 'auto', notice_period_days: 30, renewal_term_months: 12,
    renewal_cycle_start: utcDay(-1, -1), renewal_cycle_end: yesterday, renewal_cycle_key: `evergreen:${yesterday}`,
    decision_due_date: utcDay(0, -31),
  });
  await db('contract_lines').insert({
    tenant, contract_line_id: lineId, contract_id: contractId, contract_line_name: 'PBH Line', contract_line_type: 'Hourly',
    created_at: `${startDate}T00:00:00Z`,
  });
  await db('contract_line_services').insert({ tenant, contract_line_id: lineId, service_id: serviceId });
  await db('contract_line_prepaid_blocks').insert({
    tenant, contract_line_id: lineId, block_minutes: 600, block_price: 100000, expiry_months: 12,
    trigger_on_expiry: true, trigger_on_renewal: true, sold_as_service_id: serviceId,
    created_at: opts.configCreatedAt ?? `${startDate}T00:00:00Z`,
  });
  return { clientId, serviceId, contractId, lineId, clientContractId, yesterday };
}

afterEach(async () => {
  if (!db) return;
  for (const table of [
    'hour_block_audit', 'hour_blocks', 'contract_line_block_issuances', 'contract_line_prepaid_blocks',
    'contract_line_services', 'contract_lines', 'client_contracts', 'contracts', 'service_catalog', 'service_types',
    'clients', 'default_billing_settings', 'tenants',
  ]) {
    await db(table).where({ tenant }).delete();
  }
  await db.destroy();
});

const issuances = (lineId: string) => db('contract_line_block_issuances').where({ tenant, contract_line_id: lineId });

describe.runIf(enabled)('processRenewalQueueHandler Prepaid Block renewal issuance', () => {
  it('schedules one renewal issuance due on the anniversary for an evergreen assignment outside the decision horizon; a second run adds nothing', async () => {
    const w = await setup();
    // An existing scheduled expiry issuance does not block the renewal block.
    const blockId = uuidv4();
    await db('hour_blocks').insert({
      block_id: blockId, tenant, client_id: w.clientId, service_id: w.serviceId, total_minutes: 600, remaining_minutes: 90,
      hourly_rate: 10000, purchase_amount: 100000, currency_code: 'EUR', status: 'active', purchased_at: '2026-01-01T00:00:00Z',
      source_type: 'contract', expiration_date: utcDay(0, 200), contract_line_id: w.lineId,
      client_contract_id: w.clientContractId, service_period_record_id: uuidv4(),
    });
    await db('contract_line_block_issuances').insert({
      tenant, issuance_id: uuidv4(), contract_line_id: w.lineId, client_contract_id: w.clientContractId, client_id: w.clientId,
      trigger_kind: 'expiry', due_date: utcDay(0, 200), status: 'scheduled', source_block_id: blockId,
    });

    await processRenewalQueueHandler({ tenantId: tenant });

    const rows = await issuances(w.lineId);
    const renewal = rows.filter((r) => r.trigger_kind === 'renewal');
    expect(renewal).toHaveLength(1);
    expect(renewal[0]).toMatchObject({ status: 'scheduled', client_contract_id: w.clientContractId });
    expect(dateOnly(renewal[0].due_date)).toBe(w.yesterday);
    expect(rows.find((r) => r.trigger_kind === 'expiry')!.status).toBe('superseded');
    // The block is not reset or extended.
    expect(await db('hour_blocks').where({ tenant, block_id: blockId }).first())
      .toMatchObject({ remaining_minutes: 90, status: 'active' });

    await processRenewalQueueHandler({ tenantId: tenant });
    expect((await issuances(w.lineId)).length).toBe(rows.length);
    expect((await issuances(w.lineId)).filter((r) => r.trigger_kind === 'renewal')).toHaveLength(1);
  });

  it('does not back-fill a line whose block config was created after the anniversary', async () => {
    const w = await setup({ configCreatedAt: new Date().toISOString() });
    await processRenewalQueueHandler({ tenantId: tenant });
    expect(await issuances(w.lineId)).toHaveLength(0);
  });
});
