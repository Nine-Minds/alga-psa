import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import knex, { type Knex } from 'knex';
import { randomUUID } from 'node:crypto';

const context = vi.hoisted(() => ({ tenant: '', db: undefined as Knex.Transaction | undefined }));
vi.mock('@alga-psa/db', async importOriginal => ({
  ...await importOriginal<typeof import('@alga-psa/db')>(),
  createTenantKnex: async () => ({ knex: context.db, tenant: context.tenant }),
}));
vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: (...args: any[]) => unknown) => (...args: unknown[]) => fn({ user_id: 'tax-fixture' }, { tenant: context.tenant }, ...args),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: async () => true }));
vi.mock('@shared/services/productAccessGuard', () => ({
  assertPsaOnlyTenantAccess: async () => undefined,
  ProductAccessError: class extends Error {},
}));
import ClientTaxSettings from '../models/clientTaxSettings';
import { TaxService } from './taxService';
import { addTaxRate, updateTaxRate } from '../actions/taxRateActions';

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
  it('create and update actions persist a valid rate through their real transactions', async () => {
    const saved = await context.db!('tax_rates').where({ tenant: context.tenant, tax_rate_id: defaultRateId }).first();
    const { tax_rate_id: omitted, ...data } = saved;
    const created = await addTaxRate({ ...data, start_date: '2025-01-01', end_date: '2026-01-01' });
    expect(created).toHaveProperty('tax_rate_id');
    if (!('tax_rate_id' in created)) throw new Error('Expected a persisted tax rate');
    expect(await context.db!('tax_rates').where({ tenant: context.tenant, tax_rate_id: created.tax_rate_id }).first())
      .toEqual(created);
    const updated = await updateTaxRate({ ...created, tax_percentage: 8 });
    expect(updated).toMatchObject({ tax_rate_id: created.tax_rate_id });
    const readback = await context.db!('tax_rates').where({ tenant: context.tenant, tax_rate_id: created.tax_rate_id }).first();
    expect(Number(readback.tax_percentage)).toBe(8);
  });
  it('create and update actions reject overlapping ranges without persisting changes', async () => {
    const before = await context.db!('tax_rates').where({ tenant: context.tenant }).orderBy('tax_rate_id');
    const { tax_rate_id, ...proposed } = before.find(rate => rate.tax_rate_id === defaultRateId)!;
    const creation = await addTaxRate({ ...proposed, start_date: '2026-01-01', end_date: null });
    expect(creation).toMatchObject({ actionError: 'Tax rate date range overlaps with an existing rate for this region.', messageKey: 'msp/billing-settings:errors.taxRate.overlap' });
    const update = await updateTaxRate({ ...proposed, tax_rate_id, start_date: '2026-01-01', end_date: null });
    expect(update).toMatchObject({ actionError: 'Tax rate date range overlaps with an existing rate for this region.', messageKey: 'msp/billing-settings:errors.taxRate.overlap' });
    expect(await context.db!('tax_rates').where({ tenant: context.tenant }).orderBy('tax_rate_id')).toEqual(before);
  });
  it('excludes the edited rate while preserving tenant and region boundaries in overlap validation', async () => {
    // OTHER and foreign-tenant rates overlap, but cannot block this edit.
    await context.db!('tax_rates').where({ tenant: context.tenant, region_code: region })
      .whereNot('tax_rate_id', defaultRateId).delete();
    await expect(new TaxService().validateTaxRateDateRange(region, '2026-01-01', null, defaultRateId))
      .resolves.toBeUndefined();
    await expect(new TaxService().validateTaxRateDateRange(region, '2026-01-01', null))
      .rejects.toThrow('overlaps with existing rate');
  });
  it.each([
    ['2026-01-01', null, '2026-07-01', null, true],
    ['2026-07-01', null, '2026-07-01', null, true],
    ['2026-01-01', null, '2026-07-01', '2026-08-01', true],
    ['2026-07-01', null, '2026-01-01', '2026-07-01', false],
    ['2026-01-01', '2026-07-01', '2026-07-01', null, false],
    ['2026-01-01', '2026-08-01', '2026-07-01', null, true],
    ['2026-07-01', '2026-08-01', '2026-01-01', null, true],
  ] as const)('validates proposed [%s, %s) against existing [%s, %s)', async (start, end, existingStart, existingEnd, overlaps) => {
    const validationRegion = 'VALIDATE';
    await context.db!('tax_regions').insert({ tenant: context.tenant, region_code: validationRegion, region_name: 'Validation fixture' });
    await context.db!('tax_rates').insert({
      tenant: context.tenant, tax_rate_id: randomUUID(), region_code: validationRegion,
      tax_percentage: 5, start_date: existingStart, end_date: existingEnd,
    });
    const validation = new TaxService().validateTaxRateDateRange(validationRegion, start, end);
    if (overlaps) await expect(validation).rejects.toThrow('overlaps with existing rate');
    else await expect(validation).resolves.toBeUndefined();
  });
  it('uses the default billing profile when another profile has a conflicting reverse-charge setting', async () => {
    const service = new TaxService();
    await service.calculateTax(clientId, 10000, '2026-06-01', region);
    const [sibling] = await context.db!('client_billing_profiles').insert({
      tenant: context.tenant, client_id: clientId, name: 'Separate billing entity',
      is_default: false, is_active: true,
    }).returning('billing_profile_id');
    await context.db!('client_tax_settings').insert({
      tenant: context.tenant, client_id: clientId, billing_profile_id: sibling.billing_profile_id,
      is_reverse_charge_applicable: true,
    });
    expect((await ClientTaxSettings.get(clientId, sibling.billing_profile_id))?.is_reverse_charge_applicable).toBe(true);
    expect(await service.calculateTax(clientId, 10000, '2026-06-01', region))
      .toEqual({ taxAmount: 500, taxRate: 5 });
    await ClientTaxSettings.update(clientId, { is_reverse_charge_applicable: true });
    await ClientTaxSettings.update(clientId, { is_reverse_charge_applicable: false }, sibling.billing_profile_id);
    expect(await service.calculateTax(clientId, 10000, '2026-06-01', region))
      .toEqual({ taxAmount: 0, taxRate: 0 });
  });
  it('persists default-profile reverse charge and applies it before regional rate lookup', async () => {
    const service = new TaxService();
    expect(await service.calculateTax(clientId, 10000, '2026-06-01', region, true, 'EUR'))
      .toEqual({ taxAmount: 500, taxRate: 5 });
    const settings = await ClientTaxSettings.get(clientId);
    expect(settings?.is_reverse_charge_applicable).toBe(false);
    await ClientTaxSettings.update(clientId, { is_reverse_charge_applicable: true });
    expect((await ClientTaxSettings.get(clientId))?.is_reverse_charge_applicable).toBe(true);
    // No rate exists for this region: exemption must happen before rate lookup.
    expect(await new TaxService().calculateTax(clientId, 10000, '2026-06-01', 'UNCONFIGURED', true, 'EUR'))
      .toEqual({ taxAmount: 0, taxRate: 0 });
    await ClientTaxSettings.update(clientId, { is_reverse_charge_applicable: false });
    await expect(new TaxService().calculateTax(clientId, 10000, '2026-06-01', 'UNCONFIGURED', true, 'EUR'))
      .rejects.toMatchObject({ code: 'NO_TAX_RATE' });
  });
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
