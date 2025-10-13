import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { finalizeInvoice } from 'server/src/lib/actions/invoiceModification';
import { generateInvoice } from 'server/src/lib/actions/invoiceGeneration';
import { v4 as uuidv4 } from 'uuid';
import { TextEncoder as NodeTextEncoder } from 'util';
import { TestContext } from '../../../../../test-utils/testContext';
import { createTestDateISO } from '../../../../../test-utils/dateUtils';
import {
  setupClientTaxConfiguration,
  assignServiceTaxRate,
  createTestService,
  createFixedPlanAssignment,
  createBucketContractLineAssignment,
  createBucketUsageRecord
} from '../../../../../test-utils/billingTestHelpers';
import { setupCommonMocks } from '../../../../../test-utils/testMocks';

// Force connection directly to PostgreSQL on port 5432 (not pgbouncer on 6432)
// This is required for tests that need direct database access
process.env.DB_PORT = '5432';

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

describe('Billing Invoice Generation – Usage, Bucket Contract Lines, and Finalization', () => {
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
      startDate: '2023-01-01T00:00:00.000Z',
      taxPercentage: 10
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
        'client_contract_lines',
        'contract_line_services',
        'service_catalog',
        'contract_lines',
        'bucket_contract_lines',
        'tax_rates',
        'tax_regions',
        'client_tax_settings',
        'client_tax_rates',
        'next_number'
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

    // Set up invoice numbering settings
    await context.db('next_number').insert({
      tenant: context.tenantId,
      entity_type: 'INVOICE',
      prefix: 'INV-',
      last_number: 0,
      initial_value: 1,
      padding_length: 6
    });

    await ensureDefaultTaxConfiguration();
  }, 30000);

  afterEach(async () => {
    await rollbackContext();
  }, 30000);

  afterAll(async () => {
    await cleanupContext();
  }, 30000);

  describe('Usage-Based Contract Lines', () => {
    it('should generate an invoice based on usage records', async () => {
      // Arrange - Create usage-based service
      const serviceId = await createTestService(context, {
        service_name: 'Data Transfer',
        billing_method: 'per_unit',
        default_rate: 1000, // $10.00 per GB
        unit_of_measure: 'GB',
        tax_region: 'US-NY'
      });

      const contractLineId = await context.createEntity('contract_lines', {
        contract_line_name: 'Usage Contract Line',
        billing_frequency: 'monthly',
        is_custom: false,
        contract_line_type: 'Usage'
      }, 'contract_line_id');

      const configId = uuidv4();

      // Set up contract line service configuration for usage billing
      await context.db('contract_line_service_configuration').insert({
        config_id: configId,
        contract_line_id: contractLineId,
        service_id: serviceId,
        configuration_type: 'Usage',
        tenant: context.tenantId
      });

      await context.db('contract_line_services').insert({
        contract_line_id: contractLineId,
        service_id: serviceId,
        tenant: context.tenantId
      });

      // Create billing cycle and assign contract line
      const billingCycleId = await context.createEntity('client_billing_cycles', {
        client_id: context.clientId,
        billing_cycle: 'monthly',
        effective_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        period_start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        period_end_date: createTestDateISO({ year: 2023, month: 1, day: 31 })
      }, 'billing_cycle_id');

      await context.db('client_contract_lines').insert({
        client_contract_line_id: uuidv4(),
        client_id: context.clientId,
        contract_line_id: contractLineId,
        start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        is_active: true,
        tenant: context.tenantId
      });

      // Create usage records
      await context.db('usage_tracking').insert([
        {
          tenant: context.tenantId,
          usage_id: uuidv4(),
          client_id: context.clientId,
          service_id: serviceId,
          usage_date: '2023-01-15',
          quantity: '50'
        },
        {
          tenant: context.tenantId,
          usage_id: uuidv4(),
          client_id: context.clientId,
          service_id: serviceId,
          usage_date: '2023-01-20',
          quantity: '30'
        }
      ]);

      // Act
      const result = await generateInvoice(billingCycleId);
      expect(result).not.toBeNull();

      // Assert - Verify invoice totals including tax
      const expectedSubtotal = 80000; // 80 GB * $10.00 = $800.00
      const expectedTax = 8000; // 10% of $800.00 = $80.00
      const expectedTotal = 88000; // $800.00 + $80.00 = $880.00

      expect(result).toMatchObject({
        subtotal: expectedSubtotal,
        tax: expectedTax,
        total_amount: expectedTotal,
        status: 'draft'
      });

      // Verify invoice items
      const invoiceItems = await context.db('invoice_items')
        .where('invoice_id', result!.invoice_id)
        .select('*');

      expect(invoiceItems).toHaveLength(2);
      expect(invoiceItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            description: expect.stringContaining('Data Transfer'),
            quantity: expect.stringMatching(/^50(?:\.0+)?$/),
            unit_price: '1000',
            net_amount: '50000'
          }),
          expect.objectContaining({
            description: expect.stringContaining('Data Transfer'),
            quantity: expect.stringMatching(/^30(?:\.0+)?$/),
            unit_price: '1000',
            net_amount: '30000'
          })
        ])
      );
    });
  });

  describe('Bucket Contract Lines', () => {
    it('should handle overage charges correctly', async () => {
      // Arrange - Create service for bucket contract line
      const serviceId = await createTestService(context, {
        service_name: 'Consulting Hours',
        billing_method: 'per_unit',
        default_rate: 7500, // $75.00 per hour overage
        unit_of_measure: 'hour',
        tax_region: 'US-NY'
      });

      const contractLineId = await context.createEntity('contract_lines', {
        contract_line_name: 'Bucket Contract Line',
        billing_frequency: 'monthly',
        is_custom: false,
        contract_line_type: 'Bucket'
      }, 'contract_line_id');

      const bucketContractLineId = await context.createEntity('bucket_contract_lines', {
        contract_line_id: contractLineId,
        total_hours: 40,
        billing_period: 'Monthly',
        overage_rate: 7500,
        tenant: context.tenantId
      }, 'bucket_contract_line_id');

      // Set up contract line service configuration for bucket billing
      const configId = uuidv4();
      await context.db('contract_line_service_configuration').insert({
        config_id: configId,
        contract_line_id: contractLineId,
        service_id: serviceId,
        configuration_type: 'Bucket',
        tenant: context.tenantId
      });

      // Create billing cycle and assign contract line
      const billingCycleId = await context.createEntity('client_billing_cycles', {
        client_id: context.clientId,
        billing_cycle: 'monthly',
        effective_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        period_start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        period_end_date: createTestDateISO({ year: 2023, month: 1, day: 31 })
      }, 'billing_cycle_id');

      await context.db('client_contract_lines').insert({
        client_contract_line_id: uuidv4(),
        client_id: context.clientId,
        contract_line_id: contractLineId,
        start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        is_active: true,
        tenant: context.tenantId
      });

      // Create bucket usage
      await context.db('bucket_usage').insert({
        usage_id: uuidv4(),
        bucket_contract_line_id: bucketContractLineId,
        client_id: context.clientId,
        period_start: '2023-01-01',
        period_end: '2023-01-31',
        minutes_used: 45,
        overage_minutes: 5,
        service_catalog_id: serviceId,
        tenant: context.tenantId
      });

      // Act
      const result = await generateInvoice(billingCycleId);
      expect(result).not.toBeNull();

      // Assert - Verify invoice totals including tax
      const expectedSubtotal = 37500; // 5 hours * $75.00 = $375.00
      const expectedTax = 3750; // 10% of $375.00 = $37.50
      const expectedTotal = 41250; // $375.00 + $37.50 = $412.50

      expect(result).toMatchObject({
        subtotal: expectedSubtotal,
        tax: expectedTax,
        total_amount: expectedTotal,
        status: 'draft'
      });

      // Verify invoice items for overage
      const invoiceItems = await context.db('invoice_items')
        .where('invoice_id', result!.invoice_id)
        .select('*');

      expect(invoiceItems).toHaveLength(1);
      expect(invoiceItems[0]).toMatchObject({
        description: expect.stringContaining('Consulting Hours'),
        quantity: expect.stringMatching(/^5(?:\.0+)?$/),
        unit_price: '7500',
        net_amount: '37500'
      });
    });
  });

  describe('Invoice Finalization', () => {
    it('should finalize an invoice correctly', async () => {
      // Arrange
      const serviceId = await context.createEntity('service_catalog', {
        service_name: 'Basic Service',
        description: 'Test service: Basic Service',
        service_type: 'Fixed',
        default_rate: 20000,
        unit_of_measure: 'unit'
      }, 'service_id');

      const { planId: contractLineId } = await createFixedPlanAssignment(context, serviceId, {
        planName: 'Simple Contract Line',
        billingFrequency: 'monthly',
        baseRateCents: 20000,
        detailBaseRateCents: 20000,
        quantity: 1,
        startDate: createTestDateISO({ year: 2023, month: 1, day: 1 })
      });

      // Create billing cycle
      const billingCycleId = await context.createEntity('client_billing_cycles', {
        client_id: context.clientId,
        billing_cycle: 'monthly',
        effective_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        period_start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        period_end_date: createTestDateISO({ year: 2023, month: 1, day: 31 })
      }, 'billing_cycle_id');

      await context.db('client_contract_lines').insert({
        client_contract_line_id: uuidv4(),
        client_id: context.clientId,
        contract_line_id: contractLineId,
        start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        is_active: true,
        tenant: context.tenantId
      });

      // Generate draft invoice
      let invoice = await generateInvoice(billingCycleId);
      expect(invoice).not.toBeNull();

      // Verify pre-finalization state
      const expectedSubtotal = 20000; // $200.00
      const expectedTax = 2000; // 10% of $200.00 = $20.00
      const expectedTotal = 22000; // $200.00 + $20.00 = $220.00

      expect(invoice).toMatchObject({
        subtotal: expectedSubtotal,
        tax: expectedTax,
        total_amount: expectedTotal,
        status: 'draft'
      });

      // Verify invoice items before finalization
      const invoiceItemsBeforeFinalization = await context.db('invoice_items')
        .where('invoice_id', invoice!.invoice_id)
        .select('*');

      expect(invoiceItemsBeforeFinalization).toHaveLength(1);
      expect(invoiceItemsBeforeFinalization[0]).toMatchObject({
        description: expect.stringContaining('Simple Contract Line'),
        net_amount: '20000'
      });

      // Act - Finalize the invoice
      await finalizeInvoice(invoice!.invoice_id);

      // Reload invoice to verify finalized state
      invoice = await context.db('invoices')
        .where({ invoice_id: invoice!.invoice_id })
        .first();

      // Assert - Verify finalization
      expect(invoice).not.toBeNull();
      expect(invoice!.invoice_id).toBe(invoice!.invoice_id);
      expect(invoice!.status).toBe('sent');
      expect(invoice!.finalized_at).toBeInstanceOf(Date);
      expect(Number(invoice!.subtotal)).toBe(expectedSubtotal);
      expect(Number(invoice!.tax)).toBe(expectedTax);
      expect(Number(invoice!.total_amount)).toBe(expectedTotal);

      // Verify invoice items remain consistent after finalization
      const invoiceItemsAfterFinalization = await context.db('invoice_items')
        .where('invoice_id', invoice!.invoice_id)
        .select('*');

      expect(invoiceItemsAfterFinalization).toHaveLength(1);
      expect(invoiceItemsAfterFinalization[0]).toMatchObject({
        description: expect.stringContaining('Simple Contract Line'),
        net_amount: '20000'
      });
    });
  });
});
