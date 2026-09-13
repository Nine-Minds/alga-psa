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
  it('honors persisted threshold minima and gaps with PostgreSQL numeric values', async () => {
    const first = randomUUID(), second = randomUUID();
    await context.db!('tax_rate_thresholds').insert([
      { tax_rate_threshold_id: first, tax_rate_id: defaultRateId, min_amount: 10000, max_amount: 20000, rate: 5 },
      { tax_rate_threshold_id: second, tax_rate_id: defaultRateId, min_amount: 30000, max_amount: null, rate: 10 },
    ]);
    const service = new TaxService();
    for (const [amount, expectedTax, ids] of [
      [5000, 0, []], [10000, 0, []], [15000, 250, [first]],
      [25000, 500, [first]], [35000, 1000, [first, second]],
    ] as const) {
      const result = await service.calculateTax(clientId, amount, '2026-06-01');
      expect(result.taxAmount).toBe(expectedTax);
      expect(result.taxRate).toBeCloseTo(expectedTax / amount * 100);
      expect(result.appliedThresholds?.map(threshold => threshold.tax_rate_threshold_id)).toEqual(ids);
    }
  });

  it('clamps the default-rate simple path at a persisted cap and treats null/zero as distinct', async () => {
    const service = new TaxService();
    const setCap = (cap: number | null) =>
      context.db!('tax_rates').where({ tenant: context.tenant, tax_rate_id: defaultRateId }).update({ cap_amount: cap });

    await setCap(300);
    expect(await service.calculateTax(clientId, 10000, '2026-06-01')).toEqual({ taxAmount: 300, taxRate: 5 });

    await setCap(null);
    expect(await service.calculateTax(clientId, 10000, '2026-06-01')).toEqual({ taxAmount: 500, taxRate: 5 });

    await setCap(0);
    expect(await service.calculateTax(clientId, 10000, '2026-06-01')).toEqual({ taxAmount: 0, taxRate: 5 });
  });

  it('persists cap_amount through the create and update actions', async () => {
    const saved = await context.db!('tax_rates').where({ tenant: context.tenant, tax_rate_id: defaultRateId }).first();
    const { tax_rate_id: omitted, ...data } = saved;
    const created = await addTaxRate({ ...data, start_date: '2025-01-01', end_date: '2026-01-01', cap_amount: 1234 });
    expect(created).toHaveProperty('tax_rate_id');
    if (!('tax_rate_id' in created)) throw new Error('Expected a persisted tax rate');
    expect(Number(created.cap_amount)).toBe(1234);

    const updated = await updateTaxRate({ ...created, cap_amount: 4321 });
    expect(updated).toMatchObject({ tax_rate_id: created.tax_rate_id });
    const readback = await context.db!('tax_rates').where({ tenant: context.tenant, tax_rate_id: created.tax_rate_id }).first();
    expect(Number(readback.cap_amount)).toBe(4321);
  });

  it('keeps a regional period inside one rate interval as a single segment', async () => {
    // 2026-02-01 -> 2026-03-01 is 28 days at the 5% rate.
    const result = await new TaxService().calculateTaxForPeriod(clientId, 28000, '2026-02-01', '2026-03-01', region);
    expect(result.taxAmount).toBe(1400);
    expect(result.taxRate).toBe(5);
    expect(result.segments).toEqual([
      { start_date: '2026-02-01', end_date: '2026-03-01', days: 28, netAmount: 28000, taxAmount: 1400, taxRate: 5 },
    ]);
  });

  it('pro-rates and ceiling-rounds a regional period across a rate change', async () => {
    // 2026-06-15 -> 2026-07-15 is 30 days, split 16/14 at the 5% -> 7% change.
    const result = await new TaxService().calculateTaxForPeriod(clientId, 30000, '2026-06-15', '2026-07-15', region);
    expect(result.segments).toEqual([
      { start_date: '2026-06-15', end_date: '2026-07-01', days: 16, netAmount: 16000, taxAmount: 800, taxRate: 5 },
      { start_date: '2026-07-01', end_date: '2026-07-15', days: 14, netAmount: 14000, taxAmount: 980, taxRate: 7 },
    ]);
    expect(result.taxAmount).toBe(1780);
  });

  it('charges the boundary day at the new regional rate (inclusive start, exclusive end)', async () => {
    const result = await new TaxService().calculateTaxForPeriod(clientId, 20000, '2026-06-30', '2026-07-02', region);
    expect(result.segments).toEqual([
      { start_date: '2026-06-30', end_date: '2026-07-01', days: 1, netAmount: 10000, taxAmount: 500, taxRate: 5 },
      { start_date: '2026-07-01', end_date: '2026-07-02', days: 1, netAmount: 10000, taxAmount: 700, taxRate: 7 },
    ]);
    expect(result.taxAmount).toBe(1200);
  });

  it('applies a period cap on the default-rate path and zeroes days outside rate validity', async () => {
    const service = new TaxService();
    await context.db!('tax_rates').where({ tenant: context.tenant, tax_rate_id: defaultRateId }).update({ cap_amount: 400 });
    // 2026-02-01 -> 2026-03-01 is one 28-day segment: 500 uncapped, capped at 400.
    const capped = await service.calculateTaxForPeriod(clientId, 10000, '2026-02-01', '2026-03-01');
    expect(capped.taxAmount).toBe(400);
    expect(capped.segments[0].taxAmount).toBe(400);

    await context.db!('tax_rates').where({ tenant: context.tenant, tax_rate_id: defaultRateId }).update({ cap_amount: null });
    // 2026-06-15 -> 2026-07-15: 16 days taxed at 5%, 14 days after the default rate ends.
    const spanning = await service.calculateTaxForPeriod(clientId, 30000, '2026-06-15', '2026-07-15');
    expect(spanning.segments).toEqual([
      { start_date: '2026-06-15', end_date: '2026-07-01', days: 16, netAmount: 16000, taxAmount: 800, taxRate: 5 },
      { start_date: '2026-07-01', end_date: '2026-07-15', days: 14, netAmount: 14000, taxAmount: 0, taxRate: 0 },
    ]);
    expect(spanning.taxAmount).toBe(800);
  });

  it('rejects an empty period and a period before any regional rate', async () => {
    const service = new TaxService();
    await expect(service.calculateTaxForPeriod(clientId, 10000, '2026-07-01', '2026-07-01', region))
      .rejects.toThrow('Tax period end date must be after start date');
    await expect(service.calculateTaxForPeriod(clientId, 10000, '2025-01-01', '2025-02-01', region))
      .rejects.toMatchObject({ code: 'NO_TAX_RATE' });
  });

  it('combines only universal and matching currency rates across a period', async () => {
    await context.db!('tax_rates').where({ tenant: context.tenant, region_code: region }).update({ is_active: false });
    await context.db!('tax_rates').insert([
      { tenant: context.tenant, tax_rate_id: randomUUID(), region_code: region, tax_percentage: 1, start_date: '2026-01-01', currency_code: null },
      { tenant: context.tenant, tax_rate_id: randomUUID(), region_code: region, tax_percentage: 5, start_date: '2026-01-01', currency_code: 'USD' },
      { tenant: context.tenant, tax_rate_id: randomUUID(), region_code: region, tax_percentage: 7, start_date: '2026-01-01', currency_code: 'EUR' },
    ]);
    const service = new TaxService();
    // 28000 cents over 28 days: universal 1% + matching currency rate.
    expect((await service.calculateTaxForPeriod(clientId, 28000, '2026-02-01', '2026-03-01', region, true, 'USD')).taxAmount).toBe(1680);
    expect((await service.calculateTaxForPeriod(clientId, 28000, '2026-02-01', '2026-03-01', region, true, 'EUR')).taxAmount).toBe(2240);
    expect((await service.calculateTaxForPeriod(clientId, 28000, '2026-02-01', '2026-03-01', region, true, undefined)).taxAmount).toBe(280);
  });

  it('isolates period tax by region and tenant', async () => {
    const service = new TaxService();
    // The OTHER region's 30% rate and the foreign tenant's 90% rate must not leak.
    const result = await service.calculateTaxForPeriod(clientId, 28000, '2026-02-01', '2026-03-01', 'OTHER');
    expect(result.taxAmount).toBe(8400);
    expect(result.segments[0].taxRate).toBe(30);
  });

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
