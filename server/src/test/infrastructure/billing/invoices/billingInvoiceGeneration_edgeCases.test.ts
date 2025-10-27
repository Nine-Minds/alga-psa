import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { TestContext } from '../../../../../test-utils/testContext';
import { generateInvoice } from '@product/actions/invoiceGeneration';
import { setupCommonMocks } from '../../../../../test-utils/testMocks';
import { createTestService, assignServiceTaxRate, setupClientTaxConfiguration, createFixedPlanAssignment, addServiceToFixedPlan, ensureClientPlanBundlesTable } from '../../../../../test-utils/billingTestHelpers';
import { TextEncoder as NodeTextEncoder } from 'util';
import { v4 as uuidv4 } from 'uuid';

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
    debug: vi.fn(),
  },
}));

vi.mock('@alga-psa/shared/core/secretProvider', () => ({
  getSecretProviderInstance: () => ({
    getSecret: async () => undefined,
    getAppSecret: async () => undefined,
    setSecret: async () => {},
    getProviderName: () => 'MockSecretProvider',
    close: async () => {},
  }),
}));

vi.mock('@alga-psa/shared/core', () => ({
  getSecretProviderInstance: () => ({
    getSecret: async () => undefined,
    getAppSecret: async () => undefined,
    setSecret: async () => {},
    getProviderName: () => 'MockSecretProvider',
    close: async () => {},
  }),
}));

vi.mock('@alga-psa/shared/workflow/persistence', () => ({
  WorkflowEventModel: {
    create: vi.fn(),
  },
}));

vi.mock('@alga-psa/shared/workflow/streams', () => ({
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

async function configureTaxForClient(clientId: string, taxPercentage = 10) {
  await setupClientTaxConfiguration(context, {
    clientId,
    regionCode: 'US-NY',
    regionName: 'New York',
    taxPercentage
  });
  await assignServiceTaxRate(context, '*', 'US-NY', { onlyUnset: true });
  await ensureClientPlanBundlesTable(context);
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
      clientName: 'Test Client',
      userType: 'internal'
    });

    const mockContext = setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      permissionCheck: () => true
    });
    mockedTenantId = mockContext.tenantId;
    mockedUserId = mockContext.userId;

    await configureTaxForClient(context.clientId, 10);
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

    await configureTaxForClient(context.clientId, 10);
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

    const { contractLineId: creditContractLineId } = await createFixedPlanAssignment(context, creditServiceA, {
      planName: 'Credit Plan',
      baseRateCents: -12500,
      detailBaseRateCents: 5000,
      startDate: '2025-02-01',
      clientId: context.clientId
    });

    await addServiceToFixedPlan(context, creditContractLineId, creditServiceB, {
      detailBaseRateCents: 7500
    });

    const billingCycleId = uuidv4();
    await context.db('client_billing_cycles').insert({
      billing_cycle_id: billingCycleId,
      client_id: context.clientId,
      tenant: context.tenantId,
      billing_cycle: 'monthly',
      period_start_date: '2025-02-01T00:00:00.000Z',
      period_end_date: '2025-03-01T00:00:00.000Z',
      effective_date: '2025-02-01T00:00:00.000Z'
    });

    // Generate invoice
    const invoice = await generateInvoice(billingCycleId);

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
      billing_method: 'fixed',
      default_rate: 0, // $0.00
      unit_of_measure: 'unit',
      tax_region: 'US-NY'
    });

    await createFixedPlanAssignment(context, freeService, {
      planName: 'Free Plan',
      baseRateCents: 0,
      detailBaseRateCents: 0,
      startDate: '2025-02-01',
      clientId: context.clientId
    });

    const billingCycleId = uuidv4();
    await context.db('client_billing_cycles').insert({
      billing_cycle_id: billingCycleId,
      client_id: context.clientId,
      tenant: context.tenantId,
      billing_cycle: 'monthly',
      period_start_date: '2025-02-01T00:00:00.000Z',
      period_end_date: '2025-03-01T00:00:00.000Z',
      effective_date: '2025-02-01T00:00:00.000Z'
    });

    // Generate invoice
    const invoice = await generateInvoice(billingCycleId);

    expect(invoice).toBeDefined();
    expect(invoice!.subtotal).toBe(0);
    expect(invoice!.tax).toBe(0);
    expect(invoice!.total_amount).toBe(0);

    const invoiceItems = await context.db('invoice_items')
      .where({ invoice_id: invoice!.invoice_id, tenant: context.tenantId })
      .orderBy('net_amount', 'desc');

    expect(invoiceItems).toHaveLength(0);
  });
});
