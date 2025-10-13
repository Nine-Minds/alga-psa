import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { TestContext } from '../../../../../test-utils/testContext';
import { generateInvoice } from 'server/src/lib/actions/invoiceGeneration';
import { setupCommonMocks } from '../../../../../test-utils/testMocks';
import { createTestService, assignServiceTaxRate, setupClientTaxConfiguration, createFixedPlanAssignment, addServiceToFixedPlan } from '../../../../../test-utils/billingTestHelpers';
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

async function configureTaxForClient(clientId: string, taxPercentage = 10) {
  await setupClientTaxConfiguration(context, {
    clientId,
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

    const { planId } = await createFixedPlanAssignment(context, creditServiceA, {
      planName: 'Credit Plan',
      baseRateCents: -12500,
      detailBaseRateCents: 5000,
      startDate: '2025-02-01'
    });

    await addServiceToFixedPlan(context, planId, creditServiceB, {
      detailBaseRateCents: 7500
    });

    // Create a contract line
    const planId = await context.createEntity('contract_lines', {
      contract_line_name: 'Credit Plan',
      billing_frequency: 'monthly',
      is_custom: false,
      contract_line_type: 'Fixed'
    }, 'contract_line_id');

    // Assign services to plan
    await context.db('contract_line_services').insert([
      {
        contract_line_id: planId,
        service_id: serviceA,
        quantity: 1,
        tenant: context.tenantId
      },
      {
        contract_line_id: planId,
        service_id: serviceB,
        quantity: 1,
        tenant: context.tenantId
      }
    ]);

    // Create billing cycle
    const billingCycle = await context.createEntity('client_billing_cycles', {
      client_id: context.clientId,
      billing_cycle: 'monthly',
      effective_date: '2025-02-01',
      period_start_date: '2025-02-01',
      period_end_date: '2025-03-01'
    }, 'billing_cycle_id');

    // Assign plan to client
    await context.db('client_contract_lines').insert({
      client_contract_line_id: uuidv4(),
      client_id: client_id,
      contract_line_id: planId,
      start_date: '2025-02-01',
      is_active: true,
      tenant: context.tenantId
    });

    // Generate invoice
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
      service_type: 'Fixed',
      default_rate: 0, // $0.00
      unit_of_measure: 'unit',
      tax_region: 'US-NY',
      is_taxable: true // Even though it's taxable, tax on $0 is $0
    }, 'service_id');

    // Create a contract line with the free service
    const planId = await context.createEntity('contract_lines', {
      contract_line_name: 'Free Plan',
      billing_frequency: 'monthly',
      is_custom: false,
      contract_line_type: 'Fixed'
    }, 'contract_line_id');

    // Assign free service to plan
    await context.db('contract_line_services').insert({
      contract_line_id: planId,
      service_id: freeService,
      quantity: 1,
      tenant: context.tenantId
    });

    const billingCycle = await context.createEntity('client_billing_cycles', {
      client_id: context.clientId,
      billing_cycle: 'monthly',
      effective_date: '2025-02-01',
      period_start_date: '2025-02-01',
      period_end_date: '2025-03-01'
    }, 'billing_cycle_id');

    // Assign plan to client
    await context.db('client_contract_lines').insert({
      client_contract_line_id: uuidv4(),
      client_id: client_id,
      contract_line_id: planId,
      start_date: '2025-02-01',
      is_active: true,
      tenant: context.tenantId
    });

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
