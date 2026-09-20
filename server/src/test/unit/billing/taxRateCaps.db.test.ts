import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import knex, { type Knex } from 'knex';
import { randomUUID } from 'node:crypto';

const context = vi.hoisted(() => ({ tenant: '', db: undefined as Knex.Transaction | undefined, denied: '' , productDenied: false, user: { user_id: 'tax-fixture' } as any }));
vi.mock('@alga-psa/db', async importOriginal => ({
  ...await importOriginal<typeof import('@alga-psa/db')>(),
  createTenantKnex: async () => ({ knex: context.db, tenant: context.tenant }),
}));
vi.mock('@alga-psa/auth/getCurrentUser', () => ({ getCurrentUser: async () => context.user }));
vi.mock('@alga-psa/analytics', () => ({ analytics: { capture: vi.fn() }, AnalyticsEvents: { INVOICE_GENERATED: 'invoice_generated' } }));
vi.mock('@alga-psa/auth', () => ({
  getSession: async () => ({ user: { ...context.user, id: context.user.user_id } }),
  withOptionalAuth: (fn: (...args: any[]) => unknown) => (...args: unknown[]) => fn(context.user, { tenant: context.tenant }, ...args),
  withAuth: (fn: (...args: any[]) => unknown) => (...args: unknown[]) => fn(context.user, { tenant: context.tenant }, ...args),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: async (_user: unknown, _resource: string, operation: string) => context.denied !== operation }));
vi.mock('@shared/services/productAccessGuard', () => {
  class ProductAccessError extends Error {}
  return { ProductAccessError, assertPsaOnlyTenantAccess: async () => { if (context.productDenied) throw new ProductAccessError(); } };
});
vi.mock('../../../lib/auth/rbac', () => ({ hasPermission: async (_user: unknown, resource: string, operation: string) => context.denied !== operation && context.denied !== resource }));
vi.mock('../../../lib/db/db', async importOriginal => ({
  ...await importOriginal<typeof import('../../../lib/db/db')>(),
  getConnection: async () => context.db,
}));
import { GET } from '../../../app/api/v1/financial/tax/rates/route';
import { ApiFinancialController } from '../../../lib/api/controllers/ApiFinancialController';
import { UnauthorizedError } from '../../../lib/api/middleware/apiMiddleware';
import { FinancialService } from '../../../lib/api/services/FinancialService';
import { taxRateListQuerySchema } from '../../../lib/api/schemas/financialSchemas';
import { addTaxRate, updateTaxRate, getTaxRates, getTaxRatePermissions } from '@alga-psa/billing/actions/taxRateActions';
import { TaxService } from '@alga-psa/billing/services/taxService';
import { BillingEngine } from '@alga-psa/billing/lib/billing/billingEngine';
import { computeRecurringQuantityCharges } from '@alga-psa/billing/lib/billing/compute/computeRecurringQuantityCharges';
import { createTaxCapDraft, taxCapPayload } from '@alga-psa/billing/components/billing-dashboard/taxCapForm';

let db: Knex;
let foreignTenant: string;
let foreignRate: string;
let clientId: string;
const rateData = (extra = {}) => ({ region_code: 'CAP', start_date: '2026-01-01', tax_percentage: 10, ...extra } as any);
beforeAll(async () => {
  const database = process.env.DB_NAME_SERVER || 'test_database';
  if (!database.includes('test')) throw new Error('Tax cap tests require an explicitly named test database');
  db = knex({ client: 'pg', connection: {
    host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER_SERVER || 'app_user', password: process.env.DB_PASSWORD_SERVER,
    database,
  }, pool: { min: 0, max: 2 } });
  await db.raw('select 1');
});
afterAll(async () => { await db?.destroy(); });
beforeEach(async () => {
  context.db = await db.transaction(); context.tenant = randomUUID(); context.denied = ''; context.productDenied = false; context.user = { user_id: 'tax-fixture' };
  foreignTenant = randomUUID(); foreignRate = randomUUID(); clientId = randomUUID();
  for (const tenant of [context.tenant, foreignTenant]) {
    await context.db('tenants').insert({ tenant, client_name: 'Tax cap fixture', email: `tax-${tenant}@example.test` });
    await context.db('tax_regions').insert({ tenant, region_code: 'CAP', region_name: 'Tax cap region' });
  }
  await context.db('clients').insert({ tenant: context.tenant, client_id: clientId, client_name: 'Tax cap client' });
  await context.db('tax_rates').insert({ ...rateData(), tenant: foreignTenant, tax_rate_id: foreignRate, currency_code: 'USD', cap_amount: 900 });
});
afterEach(async () => { await context.db?.rollback(); context.db = undefined; });

const update = (tax_rate_id: string, extra = {}) => updateTaxRate({ tax_rate_id, ...extra } as any);
const read = (tax_rate_id: string) => context.db!('tax_rates').where({ tenant: context.tenant, tax_rate_id }).first();

describe('tax cap action persistence and authorization', () => {
  it.each([['JPY', '5', 100, 5], ['BHD', '5.001', 100000, 5001]] as const)(
    'carries exact %s form units through persistence and invoice tax', async (currency, text, net, expected) => {
      const draft = { ...createTaxCapDraft({}, 'en'), currency, text, touched: true };
      const created: any = await addTaxRate(rateData(taxCapPayload(draft, 'en', false)));
      expect(created).toMatchObject({ currency_code: currency, cap_amount: expected });
      expect((await new TaxService().calculateTax(clientId, net, '2026-06-01', 'CAP', true, currency)).taxAmount).toBe(expected);
      await expect(new TaxService().calculateTax(clientId, net, '2026-06-01', 'CAP', true, 'EUR'))
        .rejects.toMatchObject({ code: 'NO_TAX_RATE' });
    },
  );
  it('round trips add/edit/zero/clear via actions and changes tax calculation', async () => {
    const created: any = await addTaxRate(rateData({ cap_amount: 500, currency_code: 'USD' }));
    expect(created).toMatchObject({ cap_amount: 500, currency_code: 'USD' });
    for (const [cap_amount, expected] of [[500, 500], [300, 300], [0, 0], [null, 1000]] as const) {
      expect(await update(created.tax_rate_id, { cap_amount })).toMatchObject({ cap_amount });
      expect((await read(created.tax_rate_id)).cap_amount).toBe(cap_amount === null ? null : String(cap_amount));
      expect((await getTaxRates() as any[]).find(rate => rate.tax_rate_id === created.tax_rate_id).cap_amount).toBe(cap_amount);
      expect((await new TaxService().calculateTax(clientId, 10000, '2026-06-01', 'CAP', true, 'USD')).taxAmount).toBe(expected);
      // Exercise the real production database loader as well as TaxService:
      // invoice previews and recurring drafts consume these preloaded rows.
      const engine = new BillingEngine();
      Object.assign(engine, { knex: context.db, tenant: context.tenant });
      const taxContext = await (engine as any).loadChargeComputeTaxContext({
        client: { client_id: clientId, is_tax_exempt: false },
        locationId: null,
        services: [{ tax_rate_id: created.tax_rate_id }],
      });
      const result = computeRecurringQuantityCharges({
        clientContractLine: { client_contract_line_id: randomUUID(), currency_code: 'USD' } as any,
        client: { client_id: clientId }, contractCurrency: 'USD', chargeType: 'product',
        timing: { duePosition: 'arrears', servicePeriodStart: '2026-05-01', servicePeriodEnd: '2026-06-01',
          servicePeriodStartExclusive: '2026-05-01', servicePeriodEndExclusive: '2026-06-01', coverageRatio: 1 },
        services: [{ service_id: randomUUID(), service_name: 'Configured tax cap product',
          tax_rate_id: created.tax_rate_id, price_rate: 10000 }],
      }, taxContext);
      expect(result.charges[0]).toMatchObject({ total: 10000, tax_amount: expected, tax_rate: 10 });
    }
  });
  it('preserves omitted fields and rejects clearing currency while a cap remains', async () => {
    const created: any = await addTaxRate(rateData({ cap_amount: 0, currency_code: 'JPY' }));
    expect(await update(created.tax_rate_id, { description: 'Renamed', cap_amount: undefined })).toMatchObject({ cap_amount: 0, currency_code: 'JPY' });
    expect(await update(created.tax_rate_id, { currency_code: null })).toHaveProperty('actionError');
    expect(await read(created.tax_rate_id)).toMatchObject({ cap_amount: '0', currency_code: 'JPY' });
    expect(await update(created.tax_rate_id, { cap_amount: null, currency_code: null })).toMatchObject({ cap_amount: null, currency_code: null });
  });
  it.each([0, 500])('preserves legacy unresolved cap %s, rejects changes without currency, allows resolving or clearing', async cap_amount => {
    const id = randomUUID();
    // A fixture models pre-existing legacy persistence; all mutations under test use actions.
    await context.db!('tax_rates').insert({ ...rateData(), tenant: context.tenant, tax_rate_id: id, cap_amount, currency_code: null });
    expect(await update(id, { description: 'Legacy' })).toMatchObject({ cap_amount, currency_code: null });
    expect(await update(id, { cap_amount, currency_code: null })).toMatchObject({ cap_amount, currency_code: null });
    expect(await update(id, { cap_amount: cap_amount + 1 })).toHaveProperty('actionError');
    expect(await update(id, { currency_code: 'BHD' })).toMatchObject({ cap_amount, currency_code: 'BHD' });
    expect(await update(id, { cap_amount: null })).toMatchObject({ cap_amount: null, currency_code: 'BHD' });
  });
  it('normalizes maximum-safe bigint strings and rejects malformed/range inputs without writing', async () => {
    const created: any = await addTaxRate(rateData({ cap_amount: Number.MAX_SAFE_INTEGER, currency_code: 'BHD' }));
    expect(created.cap_amount).toBe(Number.MAX_SAFE_INTEGER);
    expect((await getTaxRates() as any[])[0].cap_amount).toBe(Number.MAX_SAFE_INTEGER);
    for (const cap_amount of [-1, 1.1, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, '0.00000000000000000001', '9007199254740990.9', '1e2', '0xFF', '+1', 'abc']) {
      expect(await update(created.tax_rate_id, { cap_amount })).toHaveProperty('actionError');
    }
    expect((await read(created.tax_rate_id)).cap_amount).toBe(String(Number.MAX_SAFE_INTEGER));
  });
  it('requires explicit supported currency for new caps including zero', async () => {
    for (const cap_amount of [0, 500]) {
      expect(await addTaxRate(rateData({ cap_amount }))).toHaveProperty('actionError');
      expect(await addTaxRate(rateData({ cap_amount, currency_code: 'ZZZ' }))).toHaveProperty('actionError');
    }
    expect(await getTaxRates()).toEqual([]);
  });
  it('blocks forged tenant reads and updates and overwrites caller tenant on create', async () => {
    const created: any = await addTaxRate(rateData({ tenant: foreignTenant, cap_amount: 500, currency_code: 'USD' }));
    expect(created.tenant).toBe(context.tenant);
    expect(await update(foreignRate, { tenant: foreignTenant, cap_amount: 0 })).toHaveProperty('actionError');
    expect(await getTaxRates()).toHaveLength(1);
    expect((await context.db!('tax_rates').where({ tax_rate_id: foreignRate }).first()).cap_amount).toBe('900');
  });
  it('denies read/create/update and product access without mutation, and reports read-only controls', async () => {
    const created: any = await addTaxRate(rateData());
    context.denied = 'create'; expect(await addTaxRate(rateData())).toHaveProperty('permissionError');
    context.denied = 'update'; expect(await update(created.tax_rate_id, { cap_amount: 0, currency_code: 'USD' })).toHaveProperty('permissionError');
    expect(await getTaxRatePermissions()).toMatchObject({ canUpdate: false });
    context.denied = 'read'; expect(await getTaxRates()).toHaveProperty('permissionError');
    expect(await getTaxRatePermissions()).toHaveProperty('permissionError');
    context.denied = ''; context.productDenied = true;
    expect(await update(created.tax_rate_id, { cap_amount: 0, currency_code: 'USD' })).toHaveProperty('permissionError');
    expect(await getTaxRates()).toHaveProperty('permissionError');
    expect(await read(created.tax_rate_id)).toMatchObject({ cap_amount: null, currency_code: null });
  });
  it('lists actual normalized tax rates through the API service with tax filters and tenant scope', async () => {
    await addTaxRate(rateData({ cap_amount: Number.MAX_SAFE_INTEGER, currency_code: 'BHD', description: 'API fixture' }));
    const service = new FinancialService();
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: context.db, tenant: context.tenant });
    const apiContext = { tenant: context.tenant, userId: 'fixture', user: { user_id: 'fixture' } } as any;
    const query = taxRateListQuerySchema.parse({ region_code: 'CAP', effective_date: '2026-06-01', limit: '1' });
    const result = await service.listTaxRates(query, apiContext);
    expect(result.total).toBe(1);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({ tenant: context.tenant, cap_amount: Number.MAX_SAFE_INTEGER, currency_code: 'BHD', tax_percentage: 10 });
    expect(result.data[0]).not.toHaveProperty('transaction_id');
    expect((await service.listTaxRates({ ...query, effective_date: '2025-01-01' }, apiContext)).total).toBe(0);
    context.denied = 'read';
    await expect(service.listTaxRates(query, apiContext)).rejects.toMatchObject({ statusCode: 403 });
    context.denied = ''; context.productDenied = true;
    await expect(service.listTaxRates(query, apiContext)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('GET serializes the tax resource and pagination, and retains authentication and financial permission checks', async () => {
    await addTaxRate(rateData({ cap_amount: 0, currency_code: 'USD' }));
    const request = new Request('http://localhost/api/v1/financial/tax/rates?limit=1&region_code=CAP');
    const apiContext = { tenant: context.tenant, userId: 'fixture', user: { user_id: 'fixture' } } as any;
    const authentication = vi.spyOn(ApiFinancialController.prototype as any, 'authenticate')
      .mockResolvedValue(Object.assign(request, { context: apiContext }));
    const permission = vi.spyOn(ApiFinancialController.prototype as any, 'checkPermission').mockResolvedValue(undefined);
    const connection = vi.spyOn(FinancialService.prototype as any, 'getKnex').mockResolvedValue({ knex: context.db, tenant: context.tenant });
    try {
      const response = await GET(request);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        data: [{ cap_amount: 0, currency_code: 'USD', region_code: 'CAP' }],
        pagination: { page: 1, limit: 1, total: 1, totalPages: 1 },
        meta: { resource: 'financial/tax/rates' },
      });
      expect(authentication).toHaveBeenCalled();
      expect(permission).toHaveBeenCalledWith(expect.anything(), 'read');
      authentication.mockRejectedValue(new UnauthorizedError('API key required'));
      expect((await GET(request)).status).toBe(401);
    } finally { authentication.mockRestore(); permission.mockRestore(); connection.mockRestore(); }
  });


  it('keeps an explicit rate cap stable when the tenant base currency changes', async () => {
    await context.db!('default_billing_settings').insert({ tenant: context.tenant, default_currency_code: 'USD' });
    const created: any = await addTaxRate(rateData({ cap_amount: 500, currency_code: 'GBP' }));
    await context.db!('default_billing_settings').where({ tenant: context.tenant }).update({ default_currency_code: 'JPY' });
    expect((await getTaxRates() as any[])[0]).toMatchObject({ cap_amount: 500, currency_code: 'GBP' });
    expect(await update(created.tax_rate_id, { description: 'After base currency change' }))
      .toMatchObject({ cap_amount: 500, currency_code: 'GBP' });
    const tax = await new TaxService().calculateTax(clientId, 10000, '2026-06-01', 'CAP', true, 'GBP');
    expect(tax.taxAmount).toBe(500);
    expect(await read(created.tax_rate_id)).toMatchObject({ cap_amount: '500', currency_code: 'GBP' });
  });

  it('GET paginates explicit null, zero, unresolved legacy and maximum-safe cap responses exactly', async () => {
    await addTaxRate(rateData({ start_date: '2023-01-01', end_date: '2024-01-01' }));
    await addTaxRate(rateData({ start_date: '2024-01-01', end_date: '2025-01-01', cap_amount: 0, currency_code: 'JPY' }));
    await context.db!('tax_rates').insert({ ...rateData({ start_date: '2025-01-01', end_date: '2026-01-01' }), tenant: context.tenant, tax_rate_id: randomUUID(), cap_amount: 123, currency_code: null });
    await addTaxRate(rateData({ start_date: '2026-01-01', cap_amount: Number.MAX_SAFE_INTEGER, currency_code: 'BHD' }));
    const apiContext = { tenant: context.tenant, userId: 'fixture', user: { user_id: 'fixture' } } as any;
    const authentication = vi.spyOn(ApiFinancialController.prototype as any, 'authenticate')
      .mockImplementation(async (request: any) => Object.assign(request, { context: apiContext }));
    const permission = vi.spyOn(ApiFinancialController.prototype as any, 'checkPermission').mockResolvedValue(undefined);
    const connection = vi.spyOn(FinancialService.prototype as any, 'getKnex').mockResolvedValue({ knex: context.db, tenant: context.tenant });
    try {
      const pages: any[] = [];
      for (const page of [1, 2]) {
        const response = await GET(new Request(`http://localhost/api/v1/financial/tax/rates?region_code=CAP&sort=start_date&order=asc&limit=2&page=${page}`));
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.pagination).toMatchObject({ page, limit: 2, total: 4, totalPages: 2, hasNext: page === 1, hasPrev: page === 2 });
        pages.push(...body.data);
      }
      expect(pages.map(rate => ({ cap: rate.cap_amount, currency: rate.currency_code }))).toEqual([
        { cap: null, currency: null }, { cap: 0, currency: 'JPY' },
        { cap: 123, currency: null }, { cap: Number.MAX_SAFE_INTEGER, currency: 'BHD' },
      ]);
      expect(pages.every(rate => rate.tenant === context.tenant)).toBe(true);
    } finally { authentication.mockRestore(); permission.mockRestore(); connection.mockRestore(); }
  });

  it('GET rejects a caller lacking financial read even when billing read is allowed', async () => {
    context.denied = 'financial';
    const request = new Request('http://localhost/api/v1/financial/tax/rates');
    const authentication = vi.spyOn(ApiFinancialController.prototype as any, 'authenticate')
      .mockResolvedValue(Object.assign(request, { context: { tenant: context.tenant, userId: 'fixture', user: context.user } }));
    const list = vi.spyOn(FinancialService.prototype, 'listTaxRates');
    try {
      // Exercise the real inherited checkPermission; only the permission lookup
      // and authentication boundary are fixture-controlled.
      expect((await GET(request)).status).toBe(403);
      expect(list).not.toHaveBeenCalled();
    } finally { authentication.mockRestore(); list.mockRestore(); }
  });

  it('verifies the migrated shared tax schema and negative-cap constraint in PostgreSQL', async () => {
    const columns = await context.db!('information_schema.columns').where({ table_schema: 'public', table_name: 'tax_rates' })
      .whereIn('column_name', ['cap_amount', 'currency_code']).select('column_name', 'data_type', 'is_nullable');
    expect(columns).toEqual(expect.arrayContaining([
      { column_name: 'cap_amount', data_type: 'bigint', is_nullable: 'YES' },
      { column_name: 'currency_code', data_type: 'character varying', is_nullable: 'YES' },
    ]));
    const constraints = await context.db!.raw("SELECT conname, convalidated FROM pg_constraint WHERE conrelid = 'public.tax_rates'::regclass AND conname = 'tax_rates_cap_amount_check'");
    expect(constraints.rows).toEqual([{ conname: 'tax_rates_cap_amount_check', convalidated: true }]);
    await expect(context.db!.transaction(async tx => {
      await tx('tax_rates').insert({ ...rateData(), tenant: context.tenant, tax_rate_id: randomUUID(), cap_amount: -1, currency_code: 'USD' });
    })).rejects.toMatchObject({ code: '23514', constraint: 'tax_rates_cap_amount_check' });
  });

});


// No charge calculator, tax resolver, or persistence service is mocked here.
// Source fixtures and generated invoices live in the per-test rollback transaction.
describe('T018: recurring draft preview and persisted tax cap', () => {
  it.each([[500, 500], [null, 1000], [0, 0]] as const)(
    'cap %s produces GBP draft tax %s through real automated generation', async (cap, expected) => {
      const fixtureUser = await context.db!('users as user')
        .join('service_catalog as service', 'service.tenant', 'user.tenant')
        .where({ 'user.user_type': 'internal', 'service.billing_method': 'hourly' }).select('user.*').first();
      if (!fixtureUser) throw new Error('The migrated test DB must seed a tenant with an internal user and hourly service.');
      context.user = fixtureUser; context.tenant = fixtureUser.tenant;
      const { createInvoiceTicketSourceFixture } = await import('../../../../test-utils/invoiceTicketProductionFixtures');
      const ids = await createInvoiceTicketSourceFixture(context.db!, { tenant: context.tenant, userId: fixtureUser.user_id }, async ids => {
        const tx = context.db!;
        // One 100.00 hourly charge, no usage or overtime. Keep the client's
        // default USD to prove the GBP contract/invoice currency is propagated.
        await tx('contracts').where({ tenant: context.tenant, contract_id: ids.contractId }).update({ currency_code: 'GBP' });
        await tx('contract_lines').where({ tenant: context.tenant, contract_line_id: ids.lineId }).update({ enable_overtime: false });
        await tx('usage_tracking').where({ tenant: context.tenant, client_id: ids.clientId }).delete();
        const usageConfigs = await tx('contract_line_service_configuration').where({ tenant: context.tenant, contract_line_id: ids.usageLineId }).pluck('config_id');
        await tx('contract_line_service_usage_config').where({ tenant: context.tenant }).whereIn('config_id', usageConfigs).delete();
        await tx('contract_line_service_configuration').where({ tenant: context.tenant, contract_line_id: ids.usageLineId }).delete();
        await tx('contract_line_services').where({ tenant: context.tenant, contract_line_id: ids.usageLineId }).delete();
        await tx('contract_lines').where({ tenant: context.tenant, contract_line_id: ids.usageLineId }).delete();
        const entry = await tx('time_entries').where({ tenant: context.tenant, contract_line_id: ids.lineId }).first();
        await tx('time_entries').where({ tenant: context.tenant, contract_line_id: ids.lineId }).whereNot({ entry_id: entry.entry_id }).delete();
        await tx('time_entries').where({ tenant: context.tenant, entry_id: entry.entry_id }).update({ billable_duration: 60, end_time: '2026-08-15T11:00:00Z' });
        await tx('service_prices').where({ tenant: context.tenant }).whereIn('service_id', [ids.serviceId, ids.usageServiceId]).update({ currency_code: 'GBP', rate: 10000 });
        await tx('contract_line_services').where({ tenant: context.tenant, contract_line_id: ids.lineId }).update({ custom_rate: 10000 });
        await tx('contract_line_service_configuration').where({ tenant: context.tenant, contract_line_id: ids.lineId }).update({ custom_rate: 10000 });
        // Configure through the same form serializer and authenticated action as the UI.
        // Clearing is an actual 5.00 -> null update, not creation of an uncapped row.
        expect(await updateTaxRate({ tax_rate_id: ids.taxRateId, cap_amount: 500, currency_code: 'GBP' } as any))
          .toMatchObject({ cap_amount: 500, currency_code: 'GBP' });
        const draft = { ...createTaxCapDraft({}, 'en'), currency: 'GBP', text: cap == null ? '' : cap === 0 ? '0' : '5.00', touched: true };
        expect(await updateTaxRate({ tax_rate_id: ids.taxRateId, ...taxCapPayload(draft, 'en', false) } as any))
          .toMatchObject({ cap_amount: cap, currency_code: 'GBP' });
      }, { materializeServicePeriods: false });
      const { syncRecurringServicePeriodsForContractLine } = await import('@alga-psa/billing/actions/recurringServicePeriodSync');
      await syncRecurringServicePeriodsForContractLine(context.db!, { tenant: context.tenant, contractLineId: ids.lineId, sourceRunPrefix: 'tax-cap-invoice-test' });
      const { previewInvoice, generateInvoice } = await import('@alga-psa/billing/actions/invoiceGeneration');
      const preview = await previewInvoice(ids.cycleId);
      expect(preview.success, JSON.stringify(preview)).toBe(true);
      const generated: any = await generateInvoice(ids.cycleId);
      expect(generated?.invoice_id, JSON.stringify(generated)).toBeTruthy();
      const persisted = await context.db!('invoices').where({ tenant: context.tenant, invoice_id: generated.invoice_id }).first();
      expect(persisted).toMatchObject({ status: 'draft', currency_code: 'GBP' });
      expect(Number(persisted.subtotal)).toBe(10000);
      expect(Number(persisted.tax)).toBe(expected);
      expect(Number(persisted.total_amount)).toBe(10000 + expected);
      if (!preview.success) throw new Error(preview.error);
      expect(preview.data.tax).toBe(expected);
      expect(preview.data.currencyCode).toBe('GBP');
      const charges = await context.db!('invoice_charges').where({ tenant: context.tenant, invoice_id: generated.invoice_id });
      expect(charges).toHaveLength(1);
      expect(Number(charges[0].tax_amount)).toBe(expected);
    },
  );
});
