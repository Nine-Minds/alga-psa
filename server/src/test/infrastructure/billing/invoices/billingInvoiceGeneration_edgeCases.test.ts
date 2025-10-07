import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { TestContext } from '../../../../../test-utils/testContext';
import { generateInvoice } from 'server/src/lib/actions/invoiceGeneration';
import { setupCommonMocks } from '../../../../../test-utils/testMocks';
import { createTestService, assignServiceTaxRate, setupCompanyTaxConfiguration, createFixedPlanAssignment, addServiceToFixedPlan } from '../../../../../test-utils/billingTestHelpers';
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

const globalForVitest = globalThis as { TextEncoder: typeof NodeTextEncoder };
globalForVitest.TextEncoder = NodeTextEncoder;

const {
  beforeAll: setupContext,
  beforeEach: resetContext,
  afterEach: rollbackContext,
  afterAll: cleanupContext
} = TestContext.createHelpers();

let context: TestContext;

async function configureTaxForCompany(companyId: string, taxPercentage = 10) {
  await setupCompanyTaxConfiguration(context, {
    companyId,
    regionCode: 'US-NY',
    regionName: 'New York',
    taxPercentage
  });
  await assignServiceTaxRate(context, '*', 'US-NY', { onlyUnset: true });
}

describe('Billing Invoice Edge Cases', () => {
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
        'plan_services',
        'service_catalog',
        'billing_plans',
        'tax_rates',
        'tax_regions',
        'company_tax_settings',
        'company_tax_rates'
      ],
      companyName: 'Test Company',
      userType: 'internal'
    });

    const mockContext = setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      permissionCheck: () => true
    });
    mockedTenantId = mockContext.tenantId;
    mockedUserId = mockContext.userId;

    await configureTaxForCompany(context.companyId, 10);
  }, 60000);

  beforeEach(async () => {
    context = await resetContext();
    const mockContext = setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      permissionCheck: () => true
    });
    mockedTenantId = mockContext.tenantId;
    mockedUserId = mockContext.userId;

    await configureTaxForCompany(context.companyId, 10);
  }, 30000);

  afterEach(async () => {
    await rollbackContext();
  }, 30000);

  afterAll(async () => {
    await cleanupContext();
  }, 30000);

  it('should validate total calculation for negative subtotal (credit note)', async () => {
    const creditServiceA = await createTestService(context, {
      service_name: 'Credit Service A',
      default_rate: 5000,
      tax_region: 'US-NY'
    });
    const creditServiceB = await createTestService(context, {
      service_name: 'Credit Service B',
      default_rate: 7500,
      tax_region: 'US-NY'
    });

    const { planId } = await createFixedPlanAssignment(context, creditServiceA, {
      planName: 'Credit Plan',
      baseRateCents: -12500,
      detailBaseRateCents: 5000,
      startDate: '2025-02-01'
    });

    await addServiceToFixedPlan(context, planId, creditServiceB, {
      detailBaseRateCents: 7500
    });

    const billingCycle = await context.createEntity('company_billing_cycles', {
      company_id: context.companyId,
      billing_cycle: 'monthly',
      effective_date: '2025-02-01',
      period_start_date: '2025-02-01',
      period_end_date: '2025-03-01'
    }, 'billing_cycle_id');

    const invoice = await generateInvoice(billingCycle);

    expect(invoice).toBeDefined();
    expect(invoice!.subtotal).toBe(-12500);
    expect(invoice!.tax).toBe(0);
    expect(invoice!.total_amount).toBe(-12500);

    const invoiceItems = await context.db('invoice_items')
      .where({ invoice_id: invoice!.invoice_id, tenant: context.tenantId })
      .orderBy('net_amount', 'desc');

    expect(invoiceItems).toHaveLength(1);
    expect(Number(invoiceItems[0].net_amount)).toBe(-12500);
    expect(Number(invoiceItems[0].tax_amount)).toBe(0);
    expect(Number(invoiceItems[0].total_price)).toBe(-12500);
    expect(invoiceItems[0].description).toContain('Credit Plan');
  });

  it('should properly handle true zero-value invoices through the entire workflow', async () => {
    const freeService = await createTestService(context, {
      service_name: 'Free Service',
      default_rate: 1000,
      tax_region: 'US-NY'
    });

    const { planId } = await createFixedPlanAssignment(context, freeService, {
      planName: 'Free Plan',
      baseRateCents: 0,
      detailBaseRateCents: 1000,
      startDate: '2025-02-01'
    });

    const billingCycle = await context.createEntity('company_billing_cycles', {
      company_id: context.companyId,
      billing_cycle: 'monthly',
      effective_date: '2025-02-01',
      period_start_date: '2025-02-01',
      period_end_date: '2025-03-01'
    }, 'billing_cycle_id');

    const invoice = await generateInvoice(billingCycle);

    expect(invoice).toBeDefined();
    expect(invoice!.subtotal).toBe(0);
    expect(invoice!.tax).toBe(0);
    expect(invoice!.total_amount).toBe(0);

    const invoiceItems = await context.db('invoice_items')
      .where({ invoice_id: invoice!.invoice_id, tenant: context.tenantId })
      .orderBy('net_amount', 'desc');

    expect(invoiceItems).toHaveLength(1);
    expect(Number(invoiceItems[0].net_amount)).toBe(0);
    expect(Number(invoiceItems[0].tax_amount)).toBe(0);
    expect(Number(invoiceItems[0].total_price)).toBe(0);
  });
});
