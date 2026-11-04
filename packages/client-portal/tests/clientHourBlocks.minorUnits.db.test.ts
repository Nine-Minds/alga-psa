import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import knexLib from 'knex';
import type { Knex } from 'knex';
import { computeRemainingBlockValueMinor } from '@alga-psa/shared/billingClients/hourBlockService';
import { currencyFractionDigits } from '@alga-psa/core';

// Guarded DB test for the client portal hour-block list: a cadence (contract-sourced) block
// carries currency_code, valid_from and a remaining value (derived from the exposed hourly_rate) in the currency's minor
// units, for currencies that are not 2-decimal (JPY has 0, KWD has 3). Run with
// HOUR_BLOCK_DB_TESTS=1 and the HOUR_BLOCK_DB_* env; skipped by default.

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
let clientId: string;

// The action is withAuth-wrapped and gated on the portal user's contact/permission; those gates are
// not under test, so stub them and point the connection at the real test DB.
vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'portal-user', user_type: 'client' }, { tenant }, ...args),
  getSession: vi.fn(async () => ({ user: { id: 'portal-user' } })),
}));
vi.mock('../src/actions/client-portal-actions/clientBillingPermissions', () => ({
  getClientIdFromPortalUser: vi.fn(async () => clientId),
  hasClientBillingReadPermission: vi.fn(async () => true),
}));
vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<any>('@alga-psa/db');
  return {
    ...actual,
    getConnection: vi.fn(async () => db),
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant })),
  };
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

async function cleanup() {
  for (const table of [
    'hour_blocks', 'recurring_service_periods', 'contract_lines', 'contracts',
    'service_catalog', 'service_types', 'clients', 'tenants',
  ]) {
    await db(table).where({ tenant }).delete();
  }
}

describe.runIf(enabled)('client portal hour blocks in non-2-decimal currencies', () => {
  beforeAll(async () => {
    db = knexLib({ client: 'pg', connection: config, pool: { min: 0, max: 2 } });
    tenant = uuidv4();
    clientId = uuidv4();
  });
  afterAll(async () => {
    await cleanup();
    await db.destroy();
  });

  it('returns currency, valid_from and minor-unit remaining value for JPY and KWD cadence blocks', async () => {
    expect(currencyFractionDigits('JPY', 'en-US')).toBe(0);
    expect(currencyFractionDigits('KWD', 'en-US')).toBe(3);

    const serviceTypeId = uuidv4();
    const serviceId = uuidv4();
    const contractId = uuidv4();
    const lineId = uuidv4();
    await db('tenants').insert({ tenant, client_name: 'Portal Tenant', email: 'portal@test.local', billing_source: 'test' });
    await db('clients').insert({ tenant, client_id: clientId, client_name: 'Portal Client' });
    await db('service_types').insert({ id: serviceTypeId, tenant, name: 'Portal Type', is_active: true, order_number: 1 });
    await db('service_catalog').insert({
      service_id: serviceId, tenant, service_name: 'Support', custom_service_type_id: serviceTypeId,
      billing_method: 'hourly', default_rate: 10000, unit_of_measure: 'hour',
      category_id: null, tax_rate_id: null, item_kind: 'service', is_active: true, is_license: false,
    });
    await db('contracts').insert({ tenant, contract_id: contractId, contract_name: 'Block Contract', currency_code: 'JPY', status: 'active', is_active: true });
    await db('contract_lines').insert({ tenant, contract_line_id: lineId, contract_id: contractId, contract_line_name: 'Block line', contract_line_type: 'Hourly' });

    const cases = [
      // 12,000 JPY/h (0 decimals), 90 minutes left -> 18,000 minor units.
      { currency: 'JPY', rate: 12000, minutes: 90, validFrom: '2026-11-01', expected: 18000 },
      // 15.500 KWD/h (3 decimals), 45 minutes left -> 11,625 minor units.
      { currency: 'KWD', rate: 15500, minutes: 45, validFrom: '2026-12-01', expected: 11625 },
    ];
    const blockIds: Record<string, string> = {};
    for (const [index, c] of cases.entries()) {
      const recordId = uuidv4();
      await db('recurring_service_periods').insert({
        tenant, record_id: recordId, schedule_key: `portal-${c.currency}`, period_key: c.validFrom,
        obligation_id: lineId, charge_family: 'prepaid_block', cadence_owner: 'client', due_position: 'advance',
        lifecycle_state: 'generated', service_period_start: c.validFrom, service_period_end: '2027-01-31',
        invoice_window_start: c.validFrom, invoice_window_end: '2027-01-31',
        provenance_kind: 'generated', source_rule_version: 'test',
      });
      const blockId = uuidv4();
      blockIds[c.currency] = blockId;
      await db('hour_blocks').insert({
        tenant, block_id: blockId, client_id: clientId, service_id: serviceId,
        total_minutes: 600, remaining_minutes: c.minutes, hourly_rate: c.rate, purchase_amount: c.rate * 10,
        currency_code: c.currency, status: 'active', source_type: 'contract',
        contract_line_id: lineId, service_period_record_id: recordId,
        valid_from: c.validFrom, expiration_date: '2027-01-31',
        purchased_at: new Date(Date.UTC(2026, 10, 1 + index)),
      });
    }

    const { getClientHourBlocks } = await import('../src/actions/client-portal-actions/client-billing');
    const blocks = (await getClientHourBlocks()) as Array<Record<string, any>>;
    expect(Array.isArray(blocks)).toBe(true);

    for (const c of cases) {
      const block = blocks.find((b) => b.block_id === blockIds[c.currency])!;
      expect(block).toBeDefined();
      expect(block.currency_code).toBe(c.currency);
      expect(block.valid_from).toBe(c.validFrom);
      expect(block.hourly_rate).toBe(c.rate);
      expect(block.remaining_minutes).toBe(c.minutes);
      expect(block.remaining_value).toBe(c.expected);
      expect(block.remaining_value).toBe(
        computeRemainingBlockValueMinor({ remaining_minutes: c.minutes, hourly_rate: c.rate }),
      );
    }
  });
});
