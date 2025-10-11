import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { TestContext } from '../../../../../test-utils/testContext';
import { generateManualInvoice } from 'server/src/lib/actions/manualInvoiceActions';
import { generateInvoice } from 'server/src/lib/actions/invoiceGeneration';
import {
  createTestService,
  createFixedPlanAssignment,
  addServiceToFixedPlan,
  setupClientTaxConfiguration,
  assignServiceTaxRate
} from '../../../../../test-utils/billingTestHelpers';
import { setupCommonMocks } from '../../../../../test-utils/testMocks';
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

describe('Billing Invoice Subtotal Calculations', () => {
  let context: TestContext;

  async function configureDefaultTax() {
    await setupClientTaxConfiguration(context, {
      regionCode: 'US-NY',
      regionName: 'New York',
      description: 'NY State + City Tax',
      startDate: '2025-01-01T00:00:00.000Z',
      taxPercentage: 8.875
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
        'client_billing_cycles',
        'client_billing_plans',
        'plan_service_configuration',
        'plan_service_fixed_config',
        'service_catalog',
        'billing_plan_fixed_config',
        'billing_plans',
        'tax_rates',
        'tax_regions',
        'client_tax_settings',
        'client_tax_rates'
      ],
      clientName: 'Subtotal Test Client',
      userType: 'internal'
    });

    const mockContext = setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      permissionCheck: () => true
    });
    mockedTenantId = mockContext.tenantId;
    mockedUserId = mockContext.userId;

    await configureDefaultTax();
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
    await configureDefaultTax();
  }, 30000);

  afterEach(async () => {
    await rollbackContext();
  }, 30000);

  afterAll(async () => {
    await cleanupContext();
  }, 30000);

  it('handles rounding for fractional quantities on manual invoices', async () => {
    const fractionalServiceA = await createTestService(context, {
      service_name: 'Fractional Service A',
      default_rate: 9999,
      tax_region: 'US-NY'
    });

    const fractionalServiceB = await createTestService(context, {
      service_name: 'Fractional Service B',
      default_rate: 14995,
      tax_region: 'US-NY'
    });

    const invoice = await generateManualInvoice({
      clientId: context.clientId,
      items: [
        {
          service_id: fractionalServiceA,
          description: 'Fractional Service A',
          quantity: 3.33,
          rate: 9999
        },
        {
          service_id: fractionalServiceB,
          description: 'Fractional Service B',
          quantity: 2.5,
          rate: 14995
        }
      ]
    });

    const items = await context.db('invoice_items')
      .where({ invoice_id: invoice.invoice_id, tenant: context.tenantId })
      .orderBy('created_at', 'asc');

    expect(items).toHaveLength(2);

    const expectedItem1 = Math.round(3.33 * 9999);
    const expectedItem2 = Math.round(2.5 * 14995);
    const expectedSubtotal = expectedItem1 + expectedItem2;

    expect(Number(items[0].net_amount)).toBe(expectedItem1);
    expect(Number(items[1].net_amount)).toBe(expectedItem2);
    expect(invoice.subtotal).toBe(expectedSubtotal);
  });

  it('totals multiple fixed-fee services within a plan', async () => {
    const serviceA = await createTestService(context, {
      service_name: 'Service A',
      default_rate: 5000,
      tax_region: 'US-NY'
    });
    const serviceB = await createTestService(context, {
      service_name: 'Service B',
      default_rate: 7500,
      tax_region: 'US-NY'
    });
    const serviceC = await createTestService(context, {
      service_name: 'Service C',
      default_rate: 10000,
      tax_region: 'US-NY'
    });

    const { planId } = await createFixedPlanAssignment(context, serviceA, {
      planName: 'Subtotal Plan',
      baseRateCents: 22500,
      detailBaseRateCents: 5000,
      startDate: '2025-02-01'
    });

    await addServiceToFixedPlan(context, planId, serviceB, { detailBaseRateCents: 7500 });
    await addServiceToFixedPlan(context, planId, serviceC, { detailBaseRateCents: 10000 });

    const billingCycle = await context.createEntity('client_billing_cycles', {
      client_id: context.clientId,
      billing_cycle: 'monthly',
      effective_date: '2025-02-01',
      period_start_date: '2025-02-01',
      period_end_date: '2025-03-01',
      tenant: context.tenantId
    }, 'billing_cycle_id');

    const invoice = await generateInvoice(billingCycle);

    expect(invoice).not.toBeNull();
    expect(invoice!.subtotal).toBe(22500);

    const items = await context.db('invoice_items')
      .where({ invoice_id: invoice!.invoice_id, tenant: context.tenantId })
      .orderBy('created_at', 'asc');

    expect(items).toHaveLength(1);
    expect(Number(items[0].net_amount)).toBe(22500);
  });

  it('keeps subtotal zero when plan services carry zero quantity allocations', async () => {
    const zeroQtyService = await createTestService(context, {
      service_name: 'Zero Qty Service',
      default_rate: 1000,
      tax_region: 'US-NY'
    });

    const { planId } = await createFixedPlanAssignment(context, zeroQtyService, {
      planName: 'Zero Quantity Plan',
      baseRateCents: 0,
      detailBaseRateCents: 0,
      quantity: 0,
      startDate: '2025-02-01'
    });

    const billingCycle = await context.createEntity('client_billing_cycles', {
      client_id: context.clientId,
      billing_cycle: 'monthly',
      effective_date: '2025-02-01',
      period_start_date: '2025-02-01',
      period_end_date: '2025-03-01',
      tenant: context.tenantId
    }, 'billing_cycle_id');

    const invoice = await generateInvoice(billingCycle);

    expect(invoice).not.toBeNull();
    expect(invoice!.subtotal).toBe(0);

    const items = await context.db('invoice_items')
      .where({ invoice_id: invoice!.invoice_id, tenant: context.tenantId })
      .orderBy('created_at', 'asc');

    expect(items).toHaveLength(1);
    expect(Number(items[0].net_amount)).toBe(0);
  });

  it('supports negative fixed-fee plans (credits) in subtotal totals', async () => {
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

    await addServiceToFixedPlan(context, planId, creditServiceB, { detailBaseRateCents: 7500 });

    const billingCycle = await context.createEntity('client_billing_cycles', {
      client_id: context.clientId,
      billing_cycle: 'monthly',
      effective_date: '2025-02-01',
      period_start_date: '2025-02-01',
      period_end_date: '2025-03-01',
      tenant: context.tenantId
    }, 'billing_cycle_id');

    const invoice = await generateInvoice(billingCycle);

    expect(invoice).not.toBeNull();
    expect(invoice!.subtotal).toBe(-12500);

    const items = await context.db('invoice_items')
      .where({ invoice_id: invoice!.invoice_id, tenant: context.tenantId })
      .orderBy('created_at', 'asc');

    expect(items).toHaveLength(1);
    expect(Number(items[0].net_amount)).toBe(-12500);
  });
});
