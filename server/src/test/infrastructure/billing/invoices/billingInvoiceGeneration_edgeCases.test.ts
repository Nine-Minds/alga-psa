import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { setupCommonMocks } from '../../../../../test-utils/testMocks';
import { TestContext } from '../../../../../test-utils/testContext';
import { generateInvoice } from '@alga-psa/billing/actions/invoiceGeneration';
import { createTestService, assignServiceTaxRate, setupClientTaxConfiguration, createFixedPlanAssignment, addServiceToFixedPlan, ensureClientPlanBundlesTable, materializeRecurringServicePeriods } from '../../../../../test-utils/billingTestHelpers';
import { TextEncoder as NodeTextEncoder } from 'util';
import { v4 as uuidv4 } from 'uuid';
import { seedBillingCycle } from '../../../../../test-utils/billingProfileTestHelpers';


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
        'invoice_charges',
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

    setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      permissionCheck: () => true
    });

    await configureTaxForClient(context.clientId, 10);
  }, 60000);

  beforeEach(async () => {
    context = await resetContext();
    setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      permissionCheck: () => true
    });

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
      clientId: context.clientId,
      billingTiming: 'advance'
    });

    await addServiceToFixedPlan(context, creditContractLineId, creditServiceB, {
      detailBaseRateCents: 7500
    });

    // generateInvoice refuses a window with no recurring service period, and
    // the fixture only materializes on request. Run it after the extra service
    // so the line is complete.
    await materializeRecurringServicePeriods(context, creditContractLineId);

    const billingCycleId = uuidv4();
    await seedBillingCycle(context.db, context.tenantId, {
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

    const invoiceItems = await context.db('invoice_charges')
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
      // Default billing timing is arrears, and an arrears cycle invoices the
      // service period before its own window.
      startDate: '2025-01-01',
      clientId: context.clientId,
      materializeServicePeriods: true
    });

    // This test is about a zero-dollar invoice that is actually produced, so
    // the client must not be on the suppressing default: with
    // suppress_zero_dollar_invoices set, generateInvoice returns null.
    await context.db('client_billing_settings')
      .insert({
        tenant: context.tenantId,
        client_id: context.clientId,
        zero_dollar_invoice_handling: 'normal',
        suppress_zero_dollar_invoices: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .onConflict(['tenant', 'client_id'])
      .merge({ zero_dollar_invoice_handling: 'normal', suppress_zero_dollar_invoices: false });

    const billingCycleId = uuidv4();
    await seedBillingCycle(context.db, context.tenantId, {
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

    const invoiceItems = await context.db('invoice_charges')
      .where({ invoice_id: invoice!.invoice_id, tenant: context.tenantId })
      .orderBy('net_amount', 'desc');

    expect(invoiceItems).toHaveLength(0);
  });
});
