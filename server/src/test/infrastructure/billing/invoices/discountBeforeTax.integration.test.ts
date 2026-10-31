import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { setupCommonMocks } from '../../../../../test-utils/testMocks';
import { generateManualInvoice as generateManualInvoiceRaw } from '@alga-psa/billing/actions';
import { TestContext } from '../../../../../test-utils/testContext';
import { createTestService, assignServiceTaxRate, setupClientTaxConfiguration, ensureDefaultBillingSettings, ensureClientPlanBundlesTable,
  unwrapManualInvoice
} from '../../../../../test-utils/billingTestHelpers';
import { TextEncoder as NodeTextEncoder } from 'util';
import { v4 as uuidv4 } from 'uuid';

// generateManualInvoice returns {success, invoice}; unwrap so call sites keep
// receiving the invoice itself.
const generateManualInvoice = async (request: any): Promise<any> =>
  unwrapManualInvoice(await generateManualInvoiceRaw(request));


vi.mock('@alga-psa/auth', async () => {
  const { createAuthModuleMock } = await import('../../../../../test-utils/authModuleMock');
  return createAuthModuleMock();
});

vi.mock('server/src/lib/analytics/posthog', () => ({
  analytics: {
    capture: vi.fn(),
    identify: vi.fn(),
    trackPerformance: vi.fn(),
    getClient: () => null
  }
}));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  withTransaction: vi.fn(async (knex, callback) => callback(knex)),
  withAdminTransaction: vi.fn(async (callback, existingConnection) => callback(existingConnection as any))
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@alga-psa/core/secrets', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getSecretProviderInstance: () => ({
    getSecret: async () => undefined,
    getAppSecret: async () => undefined,
    setSecret: async () => {},
    getProviderName: () => 'MockSecretProvider',
    close: async () => {}
  })
}));

vi.mock('@alga-psa/core', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getSecretProviderInstance: () => ({
    getSecret: async () => undefined,
    getAppSecret: async () => undefined,
    setSecret: async () => {},
    getProviderName: () => 'MockSecretProvider',
    close: async () => {}
  })
}));

vi.mock('@alga-psa/workflows/persistence', () => ({
  WorkflowEventModel: {
    create: vi.fn(),
  },
}));

vi.mock('@alga-psa/workflow-streams', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/workflow-streams')>()),
  getRedisStreamClient: () => ({
    publishEvent: vi.fn(),
  }),
  toStreamEvent: (event: unknown) => event,
}));

vi.mock('server/src/lib/auth/rbac', () => ({
  hasPermission: vi.fn(() => Promise.resolve(true))
}));

const globalForVitest = globalThis as { TextEncoder: typeof NodeTextEncoder };
globalForVitest.TextEncoder = NodeTextEncoder;

const {
  beforeAll: setupContext,
  beforeEach: resetContext,
  afterEach: rollbackContext,
  afterAll: cleanupContext
} = TestContext.createHelpers();

let context: TestContext;

const cents = (value: unknown): number => Number.parseInt(value?.toString() ?? '0', 10);

async function getInvoiceItems(invoiceId: string) {
  return context.db('invoice_charges')
    .where({ invoice_id: invoiceId, tenant: context.tenantId })
    .orderBy('created_at', 'asc');
}

async function configureNyTax(taxPercentage = 10) {
  const taxRateId = await setupClientTaxConfiguration(context, {
    regionCode: 'US-NY',
    regionName: 'New York',
    taxPercentage,
    startDate: '2025-01-01T00:00:00.000Z'
  });

  await assignServiceTaxRate(context, '*', 'US-NY', { onlyUnset: false });
  await ensureClientPlanBundlesTable(context);

  return taxRateId;
}


/** Everything an invoice stores must reconcile: lines sum to the invoice. */
async function expectInvoiceInvariants(invoice: any) {
  const items = await getInvoiceItems(invoice.invoice_id);
  const lineTax = items.reduce((sum: number, item: any) => sum + cents(item.tax_amount), 0);
  const lineNet = items.reduce((sum: number, item: any) => sum + cents(item.net_amount), 0);
  expect(lineTax).toBe(invoice.tax);
  expect(lineNet).toBe(invoice.subtotal);
  expect(invoice.total_amount).toBe(invoice.subtotal + invoice.tax);
  for (const item of items) {
    expect(cents(item.total_price)).toBe(cents(item.net_amount) + cents(item.tax_amount));
    expect(cents(item.tax_amount)).toBeGreaterThanOrEqual(0);
    if (item.is_discount) expect(cents(item.tax_amount)).toBe(0);
  }
  return items;
}

async function exemptService(name: string, rate: number) {
  // A service with no tax rate assigned is exempt.
  return createTestService(context, { service_name: name, default_rate: rate });
}

describe('Discounts apply before tax (integration, integer cents)', () => {
  beforeAll(async () => {
    context = await setupContext({
      runSeeds: false,
      cleanupTables: [
        'invoice_charges', 'invoices', 'client_billing_cycles', 'service_catalog',
        'tax_rates', 'tax_regions', 'client_tax_settings', 'client_tax_rates', 'transactions'
      ],
      clientName: 'Test Client',
      userType: 'internal'
    });
    setupCommonMocks({ tenantId: context.tenantId, userId: context.userId, permissionCheck: () => true });
    await ensureDefaultBillingSettings(context);
  }, 60000);

  beforeEach(async () => {
    context = await resetContext();
    setupCommonMocks({ tenantId: context.tenantId, userId: context.userId, permissionCheck: () => true });
    await ensureDefaultBillingSettings(context);
  }, 30000);

  afterEach(async () => { await rollbackContext(); }, 30000);
  afterAll(async () => { await cleanupContext(); }, 30000);

  it('a targeted discount on a taxable line lowers that line\'s tax', async () => {
    const taxable = await createTestService(context, { service_name: 'Hardware', default_rate: 10000, tax_region: 'US-NY' });
    await configureNyTax(10);
    const invoice = await generateManualInvoice({
      clientId: context.clientId,
      items: [
        { service_id: taxable, description: 'Hardware', quantity: 1, rate: 10000 },
        { description: 'Hardware discount', quantity: 1, rate: 2500, is_discount: true,
          discount_type: 'fixed', service_id: '', applies_to_service_id: taxable }
      ]
    });
    const items = await expectInvoiceInvariants(invoice);
    const line = items.find((i: any) => i.service_id === taxable)!;
    expect(cents(line.tax_amount)).toBe(750);
    expect(cents(line.total_price)).toBe(10750);
    expect(invoice.subtotal).toBe(7500);
    expect(invoice.tax).toBe(750);
    expect(invoice.total_amount).toBe(8250);
  });

  it('a targeted discount on an exempt line leaves the taxable line\'s tax unchanged', async () => {
    const taxable = await createTestService(context, { service_name: 'Hardware', default_rate: 10000, tax_region: 'US-NY' });
    const labor = await exemptService('Labor', 30000);
    await configureNyTax(10);
    await assignServiceTaxRate(context, labor, 'US-NY', { onlyUnset: false }).catch(() => {});
    await context.db('service_catalog').where({ tenant: context.tenantId, service_id: labor }).update({ tax_rate_id: null });

    const invoice = await generateManualInvoice({
      clientId: context.clientId,
      items: [
        { service_id: taxable, description: 'Hardware', quantity: 1, rate: 10000 },
        { service_id: labor, description: 'Labor', quantity: 1, rate: 30000 },
        { description: 'Labor discount', quantity: 1, rate: 5000, is_discount: true,
          discount_type: 'fixed', service_id: '', applies_to_service_id: labor }
      ]
    });
    const items = await expectInvoiceInvariants(invoice);
    expect(cents(items.find((i: any) => i.service_id === taxable)!.tax_amount)).toBe(1000);
    expect(cents(items.find((i: any) => i.service_id === labor)!.tax_amount)).toBe(0);
    expect(invoice.tax).toBe(1000);
    expect(invoice.subtotal).toBe(35000);
  });

  it('an invoice-wide fixed discount spreads over taxable and exempt lines alike', async () => {
    const taxable = await createTestService(context, { service_name: 'Hardware', default_rate: 10000, tax_region: 'US-NY' });
    const labor = await exemptService('Labor', 30000);
    await configureNyTax(10);
    await context.db('service_catalog').where({ tenant: context.tenantId, service_id: labor }).update({ tax_rate_id: null });

    const invoice = await generateManualInvoice({
      clientId: context.clientId,
      items: [
        { service_id: taxable, description: 'Hardware', quantity: 1, rate: 10000 },
        { service_id: labor, description: 'Labor', quantity: 1, rate: 30000 },
        { description: 'Invoice discount', quantity: 1, rate: 4000, is_discount: true,
          discount_type: 'fixed', service_id: '' }
      ]
    });
    const items = await expectInvoiceInvariants(invoice);
    // 4000 spread 1:3 -> 1000 on hardware, 3000 on exempt labor. Hardware is
    // taxed on 9000 only; labor's share must not lower the taxable base.
    expect(cents(items.find((i: any) => i.service_id === taxable)!.tax_amount)).toBe(900);
    expect(invoice.tax).toBe(900);
    expect(invoice.subtotal).toBe(36000);
    expect(invoice.total_amount).toBe(36900);
  });

  it('an invoice-wide percentage discount is applied before tax', async () => {
    const a = await createTestService(context, { service_name: 'A', default_rate: 10000, tax_region: 'US-NY' });
    const b = await createTestService(context, { service_name: 'B', default_rate: 5000, tax_region: 'US-NY' });
    await configureNyTax(10);
    const invoice = await generateManualInvoice({
      clientId: context.clientId,
      items: [
        { service_id: a, description: 'A', quantity: 1, rate: 10000 },
        { service_id: b, description: 'B', quantity: 1, rate: 5000 },
        { description: '10% off', quantity: 1, rate: 10, is_discount: true,
          discount_type: 'percentage', service_id: '' }
      ]
    });
    await expectInvoiceInvariants(invoice);
    expect(invoice.subtotal).toBe(13500);
    expect(invoice.tax).toBe(1350);
  });

  it('recalculating a percentage discount re-taxes on the recomputed discount', async () => {
    const a = await createTestService(context, { service_name: 'A', default_rate: 10000, tax_region: 'US-NY' });
    await configureNyTax(10);
    const invoice = await generateManualInvoice({
      clientId: context.clientId,
      items: [
        { service_id: a, description: 'A', quantity: 1, rate: 10000 },
        { description: '20% off', quantity: 1, rate: 20, is_discount: true,
          discount_type: 'percentage', service_id: '', applies_to_service_id: a }
      ]
    });
    expect(invoice.tax).toBe(800);
    const { updateManualInvoice } = await import('@alga-psa/billing/actions');
    const updated: any = unwrapManualInvoice(await updateManualInvoice(invoice.invoice_id, {
      clientId: context.clientId,
      items: [
        { service_id: a, description: 'A', quantity: 2, rate: 10000 },
        { description: '20% off', quantity: 1, rate: 20, is_discount: true,
          discount_type: 'percentage', service_id: '', applies_to_service_id: a }
      ]
    } as any));
    await expectInvoiceInvariants(updated);
    // Doubled line 20000, recomputed discount 4000, base 16000.
    expect(updated.subtotal).toBe(16000);
    expect(updated.tax).toBe(1600);
  });

  it('two regions: a region-scoped credit only lowers its own region, an untargeted discount spreads across both', async () => {
    const ny = await createTestService(context, { service_name: 'NY line', default_rate: 10000, tax_region: 'US-NY' });
    const ca = await createTestService(context, { service_name: 'CA line', default_rate: 10000, tax_region: 'US-CA' });
    await configureNyTax(10);
    const caRateId = await setupClientTaxConfiguration(context, {
      regionCode: 'US-CA', regionName: 'California', taxPercentage: 5, startDate: '2025-01-01T00:00:00.000Z'
    });
    await context.db('service_catalog').where({ tenant: context.tenantId, service_id: ny })
      .update({ tax_rate_id: (await context.db('tax_rates').where({ tenant: context.tenantId, region_code: 'US-NY', is_active: true }).first()).tax_rate_id });
    await context.db('service_catalog').where({ tenant: context.tenantId, service_id: ca }).update({ tax_rate_id: caRateId });

    const invoice = await generateManualInvoice({
      clientId: context.clientId,
      items: [
        { service_id: ny, description: 'NY line', quantity: 1, rate: 10000 },
        { service_id: ca, description: 'CA line', quantity: 1, rate: 10000 },
        { description: 'Invoice discount', quantity: 1, rate: 4000, is_discount: true,
          discount_type: 'fixed', service_id: '' }
      ]
    });
    const items = await expectInvoiceInvariants(invoice);
    // 4000 over two equal lines -> 2000 each: NY base 8000 @10% = 800, CA base 8000 @5% = 400.
    expect(cents(items.find((i: any) => i.service_id === ny)!.tax_amount)).toBe(800);
    expect(cents(items.find((i: any) => i.service_id === ca)!.tax_amount)).toBe(400);
    expect(invoice.tax).toBe(1200);
  });

  it('a discount larger than the taxable lines floors the base and tax at zero', async () => {
    const a = await createTestService(context, { service_name: 'A', default_rate: 3000, tax_region: 'US-NY' });
    await configureNyTax(10);
    const invoice = await generateManualInvoice({
      clientId: context.clientId,
      items: [
        { service_id: a, description: 'A', quantity: 1, rate: 3000 },
        { description: 'Big discount', quantity: 1, rate: 9000, is_discount: true,
          discount_type: 'fixed', service_id: '' }
      ]
    });
    const items = await expectInvoiceInvariants(invoice);
    expect(invoice.tax).toBe(0);
    expect(items.every((i: any) => cents(i.tax_amount) === 0)).toBe(true);
    expect(invoice.subtotal).toBe(-6000);
  });

  it('a manual negative line reduces the tax base', async () => {
    const a = await createTestService(context, { service_name: 'A', default_rate: 10000, tax_region: 'US-NY' });
    await configureNyTax(10);
    const invoice = await generateManualInvoice({
      clientId: context.clientId,
      items: [
        { service_id: a, description: 'A', quantity: 1, rate: 10000 },
        { service_id: a, description: 'Goodwill credit', quantity: 1, rate: -2000 }
      ]
    });
    const items = await expectInvoiceInvariants(invoice);
    expect(invoice.tax).toBe(800);
    expect(items.find((i: any) => cents(i.net_amount) < 0)!.is_discount).toBe(true);

    // Applied client credit / prepayment stays post-tax: creditActions only
    // reads the stored invoice tax and never re-enters tax calculation.
  });

  it('a finalized invoice keeps its stored (pre-change) tax', async () => {
    const a = await createTestService(context, { service_name: 'A', default_rate: 10000, tax_region: 'US-NY' });
    await configureNyTax(10);
    const invoice = await generateManualInvoice({
      clientId: context.clientId,
      items: [
        { service_id: a, description: 'A', quantity: 1, rate: 10000 },
        { description: 'Discount', quantity: 1, rate: 2500, is_discount: true,
          discount_type: 'fixed', service_id: '', applies_to_service_id: a }
      ]
    });
    // Simulate an invoice generated before this change: tax on the gross base.
    await context.db('invoice_charges').where({ tenant: context.tenantId, invoice_id: invoice.invoice_id, service_id: a })
      .update({ tax_amount: 1000, total_price: 11000 });
    await context.db('invoices').where({ tenant: context.tenantId, invoice_id: invoice.invoice_id })
      .update({ tax: 1000, total_amount: 8500, finalized_at: new Date() });

    const { finalizeInvoice } = await import('@alga-psa/billing/actions');
    await finalizeInvoice(invoice.invoice_id).catch(() => undefined);

    const stored = await context.db('invoices').where({ tenant: context.tenantId, invoice_id: invoice.invoice_id }).first();
    expect(cents(stored.tax)).toBe(1000);
    const line = await context.db('invoice_charges')
      .where({ tenant: context.tenantId, invoice_id: invoice.invoice_id, service_id: a }).first();
    expect(cents(line.tax_amount)).toBe(1000);
  });
});
