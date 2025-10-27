import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { TestContext } from '../../../../../test-utils/testContext';
import { generateInvoice } from '@product/actions/invoiceGeneration';
import { generateManualInvoice } from '@product/actions/manualInvoiceActions';
import { setupClientTaxConfiguration, assignServiceTaxRate, createTestService, createFixedPlanAssignment, ensureClientPlanBundlesTable } from '../../../../../test-utils/billingTestHelpers';
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

      await createFixedPlanAssignment(context, serviceId, {
        planName: 'Test Plan',
        baseRateCents: 1000,
        detailBaseRateCents: 1000,
        quantity: 1,
        billingFrequency: 'monthly',
        startDate: '2025-02-01',
        clientId: context.clientId
      });

      // Generate automatic invoice
      const autoInvoice = await generateInvoice(billingCycle);

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

      // Verify tax calculations match
      expect(autoInvoice!.tax).toBe(manualInvoice.tax);
      expect(autoInvoice!.subtotal).toBe(manualInvoice.subtotal);
      expect(autoInvoice!.total_amount).toBe(manualInvoice.total_amount);
    });
  });
});
