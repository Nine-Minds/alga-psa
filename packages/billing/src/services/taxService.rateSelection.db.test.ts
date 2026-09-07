import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import knex, { type Knex } from 'knex';
import { randomUUID } from 'node:crypto';

const context = vi.hoisted(() => ({ tenant: '', db: undefined as Knex.Transaction | undefined }));
vi.mock('@alga-psa/db', async importOriginal => ({
  ...await importOriginal<typeof import('@alga-psa/db')>(),
  createTenantKnex: async () => ({ knex: context.db, tenant: context.tenant }),
}));
// Isolate rate selection from default-profile provisioning. Rate queries and
// tenant scoping use real Knex/PostgreSQL; no query results are substituted.
vi.mock('../models/clientTaxSettings', () => ({ default: {
  get: async () => ({ is_reverse_charge_applicable: false }),
  getTaxRateThresholds: async () => [],
} }));
import { TaxService } from './taxService';

let db: Knex;
let clientId: string;
let defaultRateId: string;
const region = 'TEST-RATE';

beforeAll(async () => {
  const database = process.env.DB_NAME_SERVER || 'test_database';
  if (!database.includes('test')) throw new Error('Tax selection tests require an explicitly named test database');
  db = knex({ client: 'pg', connection: {
    host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER_SERVER || 'app_user', password: process.env.DB_PASSWORD_SERVER,
    database,
  }, pool: { min: 0, max: 2 } });
  await db.raw('select 1');
});
afterAll(async () => { await db?.destroy(); });
beforeEach(async () => {
  context.db = await db.transaction();
  context.tenant = randomUUID();
  clientId = randomUUID();
  defaultRateId = randomUUID();
  const foreignTenant = randomUUID();
  for (const tenant of [context.tenant, foreignTenant]) {
    await context.db('tenants').insert({ tenant, client_name: 'Tax rate fixture', email: `tax-${tenant}@example.test` });
    if (tenant === context.tenant) {
      await context.db('clients').insert({ tenant, client_id: clientId, client_name: 'Tax rate client' });
    }
    await context.db('tax_regions').insert({ tenant, region_code: region, region_name: 'Test region' });
  }
  await context.db('tax_regions').insert({ tenant: context.tenant, region_code: 'OTHER', region_name: 'Other region' });
  const rate = (overrides: Record<string, unknown>) => ({
    tenant: context.tenant, tax_rate_id: randomUUID(), region_code: region,
    tax_percentage: 5, start_date: '2026-01-01', end_date: null,
    is_active: true, is_composite: false, currency_code: null, ...overrides,
  });
  await context.db('tax_rates').insert([
    rate({ tax_rate_id: defaultRateId, end_date: '2026-07-01' }),
    rate({ tax_percentage: 7, start_date: '2026-07-01' }),
    rate({ tax_percentage: 50, is_active: false }),
    rate({ tax_percentage: 30, region_code: 'OTHER' }),
    rate({ tenant: foreignTenant, tax_percentage: 90 }),
  ]);
  await context.db('client_tax_rates').insert({ tenant: context.tenant, client_id: clientId, tax_rate_id: defaultRateId, is_default: true });
});
afterEach(async () => { await context.db?.rollback(); context.db = undefined; });

describe('TaxService PostgreSQL rate selection', () => {
  it.each([['2026-01-01', 5], ['2026-06-30', 5], ['2026-07-01', 7]] as const)(
    'selects the active rate at %s, excluding other tenants and regions', async (date, taxRate) => {
      expect(await new TaxService().calculateTax(clientId, 10000, date, region)).toEqual({ taxAmount: taxRate * 100, taxRate });
    },
  );
  it('rejects a date before any active regional rate starts', async () => {
    await expect(new TaxService().calculateTax(clientId, 10000, '2025-12-31', region)).rejects.toMatchObject({ code: 'NO_TAX_RATE' });
  });
  it.each([[undefined, 1], ['USD', 6], ['EUR', 8], ['GBP', 1]] as const)(
    'combines only universal and matching currency rates (%s)', async (currency, taxRate) => {
      await context.db!('tax_rates').where({ tenant: context.tenant, region_code: region }).update({ is_active: false });
      await context.db!('tax_rates').insert([
        { tenant: context.tenant, tax_rate_id: randomUUID(), region_code: region, tax_percentage: 1, start_date: '2026-01-01', currency_code: null },
        { tenant: context.tenant, tax_rate_id: randomUUID(), region_code: region, tax_percentage: 5, start_date: '2026-01-01', currency_code: 'USD' },
        { tenant: context.tenant, tax_rate_id: randomUUID(), region_code: region, tax_percentage: 7, start_date: '2026-01-01', currency_code: 'EUR' },
      ]);
      expect(await new TaxService().calculateTax(clientId, 10000, '2026-08-01', region, true, currency)).toEqual({ taxAmount: taxRate * 100, taxRate });
    },
  );
  it.each([['2025-12-31', 0], ['2026-01-01', 5], ['2026-07-01', 0]] as const)(
    'applies default-rate start and exclusive end dates (%s)', async (date, taxRate) => {
      expect(await new TaxService().calculateTax(clientId, 10000, date)).toEqual({ taxAmount: taxRate * 100, taxRate });
    },
  );
  it.each([['USD', 5], ['EUR', 0]] as const)('filters the default rate by currency (%s)', async (currency, taxRate) => {
    await context.db!('tax_rates').where({ tenant: context.tenant, tax_rate_id: defaultRateId }).update({ currency_code: 'USD' });
    expect(await new TaxService().calculateTax(clientId, 10000, '2026-06-01', undefined, true, currency)).toEqual({ taxAmount: taxRate * 100, taxRate });
  });
  it.each([[0, 0], [-10000, 0], [333, 17]])('normalizes the PostgreSQL default percentage for %s cents', async (amount, taxAmount) => {
    expect(await new TaxService().calculateTax(clientId, amount, '2026-06-01')).toEqual({ taxAmount, taxRate: 5 });
  });
  it('preserves a fractional PostgreSQL percentage and rounds only the resulting tax cents', async () => {
    await context.db!('tax_rates').where({ tenant: context.tenant, tax_rate_id: defaultRateId }).update({ tax_percentage: 7.25 });
    expect(await new TaxService().calculateTax(clientId, 333, '2026-06-01')).toEqual({ taxAmount: 25, taxRate: 7.25 });
  });
});
