import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { TestContext } from '../../../../../test-utils/testContext';
import { v4 as uuidv4 } from 'uuid';
import { createInvoiceFromBillingResult } from '@alga-psa/billing/actions/invoiceGeneration';
import { generateManualInvoice } from '@alga-psa/billing/actions';
import { setupClientTaxConfiguration, assignServiceTaxRate, createTestService, ensureClientPlanBundlesTable } from '../../../../../test-utils/billingTestHelpers';
import { setupCommonMocks } from '../../../../../test-utils/testMocks';
import { TextEncoder as NodeTextEncoder } from 'util';
import type { IBillingResult, IBillingCharge } from 'server/src/interfaces/billing.interfaces';

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

vi.mock('@alga-psa/db', () => ({
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

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: () => ({
    getSecret: async () => undefined,
    getAppSecret: async () => undefined,
    setSecret: async () => {},
    getProviderName: () => 'MockSecretProvider',
    close: async () => {},
  }),
}));

vi.mock('@alga-psa/core', () => ({
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

describe('Billing Invoice Consistency Checks', () => {
  const {
    beforeAll: setupContext,
    beforeEach: resetContext,
    afterEach: rollbackContext,
    afterAll: cleanupContext
  } = TestContext.createHelpers();

let context: TestContext;

async function ensureDefaultTaxConfiguration() {
  await setupClientTaxConfiguration(context, {
    regionCode: 'US-NY',
    regionName: 'New York',
    description: 'NY State + City Tax',
    startDate: '2025-01-01T00:00:00.000Z',
    taxPercentage: 8.875
  });
}

async function ensureDefaultBillingSettings() {
  await context.db('default_billing_settings')
    .insert({
      tenant: context.tenantId,
      zero_dollar_invoice_handling: 'normal',
      suppress_zero_dollar_invoices: false,
      enable_credit_expiration: false,
      credit_expiration_days: 365,
      credit_expiration_notification_days: context.db.raw('ARRAY[30,7,1]::INTEGER[]')
    })
    .onConflict('tenant')
    .merge({
      zero_dollar_invoice_handling: 'normal',
      suppress_zero_dollar_invoices: false,
      enable_credit_expiration: false
    });
}

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
        'client_tax_settings'
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
    await ensureDefaultTaxConfiguration();
    await ensureDefaultBillingSettings();
    await ensureClientPlanBundlesTable(context);
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
    await ensureDefaultTaxConfiguration();
    await ensureDefaultBillingSettings();
    await ensureClientPlanBundlesTable(context);
  }, 30000);

  afterAll(async () => {
    await cleanupContext();
  }, 30000);

  afterEach(async () => {
    await rollbackContext();
  }, 30000);

  describe('Tax Calculation Consistency', () => {
    it('should calculate tax consistently between manual and automatic invoices', async () => {
      // Set up test data
      const serviceId = await createTestService(context, {
        service_name: 'Test Service',
        default_rate: 1000,
        tax_region: 'US-NY'
      });

      await assignServiceTaxRate(context, serviceId, 'US-NY', { onlyUnset: true });

      // Create billing cycle for automatic invoice
      const billingCycle = await context.createEntity('client_billing_cycles', {
        client_id: context.clientId,
        billing_cycle: 'monthly',
        effective_date: '2025-02-01',
        period_start_date: '2025-02-01',
        period_end_date: '2025-03-01'
      }, 'billing_cycle_id');

      const cycleRecord = await context.db('client_billing_cycles')
        .where({ billing_cycle_id: billingCycle, tenant: context.tenantId })
        .first();

      const cycleStart = cycleRecord.period_start_date ?? cycleRecord.effective_date;
      const cycleEnd = cycleRecord.period_end_date ?? cycleRecord.effective_date;

      const autoCharge: IBillingCharge = {
        tenant: context.tenantId,
        type: 'usage',
        serviceId,
        serviceName: 'Test Service',
        quantity: 1,
        rate: 1000,
        total: 1000,
        tax_amount: 0,
        tax_rate: 0,
        tax_region: 'US-NY',
        is_taxable: true,
        usageId: uuidv4(),
        servicePeriodStart: cycleStart,
        servicePeriodEnd: cycleEnd,
        billingTiming: 'arrears'
      };

      const billingResult: IBillingResult = {
        tenant: context.tenantId,
        charges: [autoCharge],
        totalAmount: 1000,
        discounts: [],
        adjustments: [],
        finalAmount: 1000
      };

      const createdAutoInvoice = await createInvoiceFromBillingResult(
        billingResult,
        context.clientId,
        cycleStart,
        cycleEnd,
        billingCycle,
        context.userId
      );

      // Generate manual invoice with same parameters
      const manualInvoice = await generateManualInvoice({
        clientId: context.clientId,
        items: [{
          service_id: serviceId,
          quantity: 1,
          description: 'Test Service',
          rate: 1000
        }]
      });

      const autoInvoiceRow = await context.db('invoices')
        .where({ invoice_id: createdAutoInvoice.invoice_id, tenant: context.tenantId })
        .first();
      const autoItems = await context.db('invoice_charges').where({
        invoice_id: createdAutoInvoice.invoice_id,
        tenant: context.tenantId
      });
      const autoTotals = {
        subtotal: Number(autoInvoiceRow?.subtotal ?? 0),
        tax: Number(autoInvoiceRow?.tax ?? 0),
        total_amount: Number(autoInvoiceRow?.total_amount ?? 0)
      };
      const manualItems = await context.db('invoice_charges').where({
        invoice_id: manualInvoice.invoice_id,
        tenant: context.tenantId
      });

      // Verify tax calculations match
      expect(autoTotals.tax).toBe(manualInvoice.tax);
      expect(autoTotals.subtotal).toBe(manualInvoice.subtotal);
      expect(autoTotals.total_amount).toBe(manualInvoice.total_amount);
    });
  });
});
