import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { TestContext } from '../../../../../test-utils/testContext';
import { generateManualInvoice } from '@product/actions/manualInvoiceActions';
import { generateInvoice } from '@product/actions/invoiceGeneration';
import {
  createTestService,
  createFixedPlanAssignment,
  addServiceToFixedPlan,
  setupClientTaxConfiguration,
  assignServiceTaxRate,
  ensureDefaultBillingSettings,
  ensureClientPlanBundlesTable
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

vi.mock('@alga-psa/shared/db', () => ({
  withTransaction: vi.fn(async (knex, callback) => callback(knex)),
  withAdminTransaction: vi.fn(async (callback, existingConnection) => callback(existingConnection as any))
}));

vi.mock('@alga-psa/shared/core/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

vi.mock('@alga-psa/shared/core/secretProvider', () => ({
  getSecretProviderInstance: () => ({
    getSecret: async () => undefined,
    getAppSecret: async () => undefined,
    setSecret: async () => {},
    getProviderName: () => 'MockSecretProvider',
    close: async () => {}
  })
}));

vi.mock('@alga-psa/shared/core', () => ({
  getSecretProviderInstance: () => ({
    getSecret: async () => undefined,
    getAppSecret: async () => undefined,
    setSecret: async () => {},
    getProviderName: () => 'MockSecretProvider',
    close: async () => {}
  })
}));

vi.mock('@alga-psa/shared/workflow/persistence', () => ({
  WorkflowEventModel: {
    create: vi.fn()
  }
}));

vi.mock('@alga-psa/shared/workflow/streams', () => ({
  getRedisStreamClient: () => ({
    publishEvent: vi.fn()
  }),
  toStreamEvent: (event: unknown) => event
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

async function configureDefaultTax() {
  await setupClientTaxConfiguration(context, {
    regionCode: 'US-NY',
    regionName: 'New York',
    description: 'NY State + City Tax',
    startDate: '2025-01-01T00:00:00.000Z',
    taxPercentage: 8.875
  });

  await assignServiceTaxRate(context, '*', 'US-NY', { onlyUnset: false });
}

async function ensureBillingDefaults() {
  await configureDefaultTax();
  await ensureDefaultBillingSettings(context);
  await ensureClientPlanBundlesTable(context);
}

async function getInvoiceItems(invoiceId: string) {
  return context
    .db('invoice_items')
    .where({ invoice_id: invoiceId, tenant: context.tenantId })
    .orderBy('created_at', 'asc');
}

describe('Billing Invoice Subtotal Calculations', () => {
  beforeAll(async () => {
    context = await setupContext({
      runSeeds: false,
      cleanupTables: [
        'invoice_items',
        'invoices',
        'usage_tracking',
        'bucket_usage',
        'time_entries',
        'tickets',
        'client_billing_cycles',
        'client_contract_lines',
        'contract_line_services',
        'service_catalog',
        'contract_lines',
        'bucket_plans',
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

    await ensureBillingDefaults();
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

    await ensureBillingDefaults();
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

    const items = await getInvoiceItems(invoice.invoice_id);

    const expectedItem1 = Math.round(3.33 * 9999);
    const expectedItem2 = Math.round(2.5 * 14995);
    const expectedSubtotal = expectedItem1 + expectedItem2;

    expect(items).toHaveLength(2);
    expect(Number(items[0].net_amount)).toBe(expectedItem1);
    expect(Number(items[1].net_amount)).toBe(expectedItem2);
    expect(invoice.subtotal).toBe(expectedSubtotal);
  });

  it('calculates subtotal for multiple contract line services with mixed rates', async () => {
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
      baseRateCents: 22500, // Total of all services: 5000 + 7500 + 10000
      detailBaseRateCents: 5000,
      startDate: '2025-02-01'
    });

    await addServiceToFixedPlan(context, planId, serviceB, { detailBaseRateCents: 7500 });
    await addServiceToFixedPlan(context, planId, serviceC, { detailBaseRateCents: 10000 });

    const billingCycleId = await context.createEntity('client_billing_cycles', {
      client_id: context.clientId,
      billing_cycle: 'monthly',
      effective_date: '2025-02-01',
      period_start_date: '2025-02-01',
      period_end_date: '2025-03-01'
    }, 'billing_cycle_id');

    const invoice = await generateInvoice(billingCycleId);

    expect(invoice).not.toBeNull();

    const items = await getInvoiceItems(invoice!.invoice_id);
    const subtotal = items.reduce((total, item) => total + Number(item.net_amount), 0);

    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(subtotal).toBe(22500);
    expect(invoice!.subtotal).toBe(22500);
  });

  it('returns zero subtotal when manual invoice line items have zero quantity', async () => {
    const serviceA = await createTestService(context, {
      service_name: 'Consulting',
      default_rate: 5000,
      tax_region: 'US-NY'
    });

    const serviceB = await createTestService(context, {
      service_name: 'Development',
      default_rate: 7500,
      tax_region: 'US-NY'
    });

    const serviceC = await createTestService(context, {
      service_name: 'Training',
      default_rate: 10000,
      tax_region: 'US-NY'
    });

    const invoice = await generateManualInvoice({
      clientId: context.clientId,
      items: [
        {
          service_id: serviceA,
          description: 'Consulting services',
          unit_price: 5000,
          quantity: 0,
          rate: 5000
        },
        {
          service_id: serviceB,
          description: 'Development services',
          unit_price: 7500,
          quantity: 0,
          rate: 7500
        },
        {
          service_id: serviceC,
          description: 'Training services',
          unit_price: 10000,
          quantity: 0,
          rate: 10000
        }
      ]
    });

    expect(invoice.subtotal).toBe(0);

    const items = await getInvoiceItems(invoice.invoice_id);
    expect(items).toHaveLength(3);
    items.forEach(item => {
      expect(Number(item.net_amount)).toBe(0);
    });
  });

  it('calculates subtotal when contract line charges net to zero', async () => {
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
      planName: 'Zero Credit Plan',
      baseRateCents: 0,
      detailBaseRateCents: 5000,
      startDate: '2025-02-01'
    });

    await addServiceToFixedPlan(context, planId, creditServiceB, { detailBaseRateCents: -5000 });

    const billingCycleId = await context.createEntity('client_billing_cycles', {
      client_id: context.clientId,
      billing_cycle: 'monthly',
      effective_date: '2025-02-01',
      period_start_date: '2025-02-01',
      period_end_date: '2025-03-01'
    }, 'billing_cycle_id');

    const invoice = await generateInvoice(billingCycleId);

    expect(invoice).not.toBeNull();

    const items = await getInvoiceItems(invoice!.invoice_id);
    const subtotal = items.reduce((total, item) => total + Number(item.net_amount), 0);

    expect(subtotal).toBe(0);
    expect(invoice!.subtotal).toBe(0);
  });

  it('supports negative fixed-fee plans (credits) in subtotal totals', async () => {
    const creditService = await createTestService(context, {
      service_name: 'Credit Plan Service',
      default_rate: 12500,
      tax_region: 'US-NY'
    });

    const { planId } = await createFixedPlanAssignment(context, creditService, {
      planName: 'Credit Plan',
      baseRateCents: -12500,
      detailBaseRateCents: -12500,
      startDate: '2025-02-01'
    });

    const billingCycleId = await context.createEntity('client_billing_cycles', {
      client_id: context.clientId,
      billing_cycle: 'monthly',
      effective_date: '2025-02-01',
      period_start_date: '2025-02-01',
      period_end_date: '2025-03-01'
    }, 'billing_cycle_id');

    const invoice = await generateInvoice(billingCycleId);

    expect(invoice).not.toBeNull();
    expect(invoice!.subtotal).toBe(-12500);

    const items = await getInvoiceItems(invoice!.invoice_id);

    expect(items).toHaveLength(1);
    expect(Number(items[0].net_amount)).toBe(-12500);
  });
});
