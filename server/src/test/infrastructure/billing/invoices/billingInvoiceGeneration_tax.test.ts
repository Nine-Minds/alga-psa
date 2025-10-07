import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { TestContext } from '../../../../../test-utils/testContext';
import {
  createTestService,
  createFixedPlanAssignment,
  addServiceToFixedPlan,
  setupCompanyTaxConfiguration,
  assignServiceTaxRate
} from '../../../../../test-utils/billingTestHelpers';
import { generateInvoice } from 'server/src/lib/actions/invoiceGeneration';
import { generateManualInvoice } from 'server/src/lib/actions/manualInvoiceActions';
import { TextEncoder as NodeTextEncoder } from 'util';

let mockedTenantId = '11111111-1111-1111-1111-111111111111';
let mockedUserId = 'mock-user-id';

vi.mock('server/src/lib/auth/getSession', () => ({
  getSession: vi.fn(async () => ({
    user: {
      id: mockedUserId,
      tenant: mockedTenantId
    }
  }))
}));

vi.mock('server/src/lib/analytics/posthog', () => ({
  analytics: {
    capture: vi.fn(),
    identify: vi.fn(),
    trackPerformance: vi.fn(),
    getClient: () => null
  }
}));

vi.mock('@alga-psa/shared/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/shared/db')>();
  return {
    ...actual,
    withTransaction: vi.fn(async (knex, callback) => callback(knex)),
    withAdminTransaction: vi.fn(async (callback, existingConnection) => callback(existingConnection as any))
  };
});

vi.mock('server/src/lib/auth/rbac', () => ({
  hasPermission: vi.fn(() => Promise.resolve(true))
}));

vi.mock('server/src/lib/actions/user-actions/userActions', () => ({
  getCurrentUser: vi.fn(async () => ({
    user_id: mockedUserId,
    tenant: mockedTenantId,
    user_type: 'internal',
    roles: []
  }))
}));

const globalForVitest = globalThis as { TextEncoder: typeof NodeTextEncoder };
globalForVitest.TextEncoder = NodeTextEncoder;

const {
  beforeAll: setupContext,
  beforeEach: resetContext,
  afterEach: rollbackContext,
  afterAll: cleanupContext
} = TestContext.createHelpers();

describe('Billing Invoice Tax Calculations', () => {
  let context: TestContext;

  async function ensureDefaultTax() {
    await setupCompanyTaxConfiguration(context, {
      regionCode: 'US-NY',
      regionName: 'New York',
      description: 'NY State + City Tax',
      startDate: '2025-01-01T00:00:00.000Z',
      taxPercentage: 10 // easier math for tests
    });
    await assignServiceTaxRate(context, '*', 'US-NY', { onlyUnset: true });
  }

  beforeAll(async () => {
    context = await setupContext({
      runSeeds: true,
      cleanupTables: [
        'invoice_items',
        'invoices',
        'usage_tracking',
        'bucket_usage',
        'time_entries',
        'tickets',
        'company_billing_cycles',
        'company_billing_plans',
        'plan_service_configuration',
        'plan_service_fixed_config',
        'service_catalog',
        'billing_plan_fixed_config',
        'billing_plans',
        'tax_rates',
        'tax_regions',
        'company_tax_settings',
        'company_tax_rates'
      ],
      companyName: 'Tax Test Company',
      userType: 'internal'
    });

    mockedTenantId = context.tenantId;
    mockedUserId = context.userId;
    await ensureDefaultTax();
  }, 60000);

  beforeEach(async () => {
    context = await resetContext();
    mockedTenantId = context.tenantId;
    mockedUserId = context.userId;
    await ensureDefaultTax();
  }, 30000);

  afterEach(async () => {
    await rollbackContext();
  }, 30000);

  afterAll(async () => {
    await cleanupContext();
  }, 30000);

  it('preserves tax when discounts drive subtotal to zero (manual invoice)', async () => {
    const taxableService = await createTestService(context, {
      service_name: 'Taxable Service',
      default_rate: 10000,
      tax_region: 'US-NY'
    });

    const discountService = await createTestService(context, {
      service_name: 'Offset Discount',
      default_rate: 10000
    });

    const invoice = await generateManualInvoice({
      companyId: context.companyId,
      items: [
        {
          service_id: taxableService,
          description: 'Primary taxable service',
          quantity: 1,
          rate: 10000
        },
        {
          service_id: discountService,
          description: 'Full discount',
          quantity: 1,
          rate: -10000
        }
      ]
    });

    expect(invoice.subtotal).toBe(0);
    expect(invoice.tax).toBe(1000);
    expect(invoice.total_amount).toBe(1000);

    const items = await context.db('invoice_items')
      .where({ invoice_id: invoice.invoice_id, tenant: context.tenantId })
      .orderBy('created_at', 'asc');

    expect(items).toHaveLength(2);
    const taxableItem = items.find((item) => item.service_id === taxableService)!;
    const discountItem = items.find((item) => item.service_id === discountService)!;

    expect(Number(taxableItem.net_amount)).toBe(10000);
    expect(Number(taxableItem.tax_amount)).toBe(1000);
    expect(Number(discountItem.net_amount)).toBe(-10000);
    expect(Number(discountItem.tax_amount)).toBe(0);
  });

  it('distributes tax across services from different regions', async () => {
    // Ensure California tax rate exists (7.25%)
    await setupCompanyTaxConfiguration(context, {
      regionCode: 'US-CA',
      regionName: 'California',
      description: 'CA State Tax',
      taxPercentage: 7.25,
      startDate: '2025-01-01T00:00:00.000Z'
    });

    const nyService = await createTestService(context, {
      service_name: 'NY Service',
      default_rate: 10000,
      tax_region: 'US-NY'
    });

    const caService = await createTestService(context, {
      service_name: 'CA Service',
      default_rate: 20000,
      tax_region: 'US-CA'
    });

    await assignServiceTaxRate(context, caService, 'US-CA');

    const { planId } = await createFixedPlanAssignment(context, nyService, {
      planName: 'Multi Region Plan',
      baseRateCents: 30000,
      detailBaseRateCents: 10000,
      startDate: '2025-02-01'
    });

    await addServiceToFixedPlan(context, planId, caService, { detailBaseRateCents: 20000 });

    const billingCycle = await context.createEntity('company_billing_cycles', {
      company_id: context.companyId,
      billing_cycle: 'monthly',
      effective_date: '2025-02-01',
      period_start_date: '2025-02-01',
      period_end_date: '2025-03-01',
      tenant: context.tenantId
    }, 'billing_cycle_id');

    const invoice = await generateInvoice(billingCycle);

    expect(invoice).not.toBeNull();

    const nyServiceRecord = await context.db('service_catalog')
      .where({ tenant: context.tenantId, service_id: nyService })
      .first('tax_rate_id');

    const caServiceRecord = await context.db('service_catalog')
      .where({ tenant: context.tenantId, service_id: caService })
      .first('tax_rate_id');

    const nyRate = nyServiceRecord?.tax_rate_id
      ? await context.db('tax_rates')
          .where({ tenant: context.tenantId, tax_rate_id: nyServiceRecord.tax_rate_id })
          .first('tax_percentage')
      : null;

    const caRate = caServiceRecord?.tax_rate_id
      ? await context.db('tax_rates')
          .where({ tenant: context.tenantId, tax_rate_id: caServiceRecord.tax_rate_id })
          .first('tax_percentage')
      : null;

    const nyTaxPercent = nyRate ? Number(nyRate.tax_percentage) : 0;
    const caTaxPercent = caRate ? Number(caRate.tax_percentage) : 0;

    const expectedNyTax = Math.round(10000 * (nyTaxPercent / 100));
    const theoreticalCaTax = Math.round(20000 * (caTaxPercent / 100));
    const actualCaTax = invoice!.tax - expectedNyTax;

    expect(invoice!.tax).toBeGreaterThan(expectedNyTax);
    expect(actualCaTax).toBeGreaterThan(0);
    expect(actualCaTax).toBeLessThanOrEqual(theoreticalCaTax);

    const expectedTaxTotal = expectedNyTax + actualCaTax;

    const items = await context.db('invoice_items')
      .where({ invoice_id: invoice!.invoice_id, tenant: context.tenantId })
      .orderBy('created_at', 'asc');

    expect(items).toHaveLength(1);
    expect(Number(items[0].tax_amount)).toBe(expectedTaxTotal);
  });
});
