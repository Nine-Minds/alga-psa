import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { generateInvoice } from 'server/src/lib/actions/invoiceGeneration';
import { v4 as uuidv4 } from 'uuid';
import { TextEncoder as NodeTextEncoder } from 'util';
import { TestContext } from '../../../../../test-utils/testContext';
import { createTestDateISO } from '../../../../../test-utils/dateUtils';
import { expectError } from '../../../../../test-utils/errorUtils';
import {
  createTestService,
  createFixedPlanAssignment,
  setupClientTaxConfiguration,
  assignServiceTaxRate,
  ensureDefaultBillingSettings,
  clearServiceTypeCache,
  ensureClientPlanBundlesTable
} from '../../../../../test-utils/billingTestHelpers';
import { setupCommonMocks } from '../../../../../test-utils/testMocks';

// Override DB_PORT to connect directly to PostgreSQL instead of pgbouncer
// This is critical for tests that use advisory locks or other features not supported by pgbouncer
process.env.DB_PORT = '5432';
process.env.DB_HOST = process.env.DB_HOST === 'pgbouncer' ? 'localhost' : process.env.DB_HOST;

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

describe('Billing Invoice Generation – Invoice Number Generation (Part 1)', () => {
  let context: TestContext;

  async function configureDefaultTax() {
    await setupClientTaxConfiguration(context, {
      regionCode: 'US-NY',
      regionName: 'New York',
      description: 'NY State Tax',
      startDate: '2020-01-01T00:00:00.000Z',
      taxPercentage: 8.875
    });
    await assignServiceTaxRate(context, '*', 'US-NY', { onlyUnset: false });
    await ensureClientPlanBundlesTable(context);
  }

  beforeAll(async () => {
    context = await setupContext({
      runSeeds: false,
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
        'contract_lines',
        'tax_rates',
        'tax_regions',
        'client_tax_settings',
        'client_tax_rates',
        'next_number'
      ],
      clientName: 'Invoice Number Test Client',
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
    await ensureDefaultBillingSettings(context);
  }, 120000);

  beforeEach(async () => {
    context = await resetContext();

    // Clear the service type cache to prevent stale IDs from being reused
    clearServiceTypeCache();

    const mockContext = setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      permissionCheck: () => true
    });
    mockedTenantId = mockContext.tenantId;
    mockedUserId = mockContext.userId;

    // Set up invoice numbering settings
    const nextNumberRecord = {
      tenant: context.tenantId,
      entity_type: 'INVOICE',
      prefix: 'INV-',
      last_number: 0,
      initial_value: 1,
      padding_length: 6
    };
    await context.db('next_number').insert(nextNumberRecord);

    // Configure default tax and billing defaults for the test client
    await configureDefaultTax();
    await ensureDefaultBillingSettings(context);
  }, 30000);

  afterEach(async () => {
    await rollbackContext();
  }, 30000);

  afterAll(async () => {
    await cleanupContext();
  }, 30000);

  it('should maintain sequence without gaps after failed generation attempts', async () => {
    await context.db('next_number').where({
      tenant: context.tenantId,
      entity_type: 'INVOICE'
    }).delete();

    await context.db('next_number').insert({
      tenant: context.tenantId,
      entity_type: 'INVOICE',
      prefix: 'INV-',
      last_number: 0,
      initial_value: 1,
      padding_length: 6
    });

    // Create a service
    const serviceId = await createTestService(context, {
      service_name: 'Basic Service',
      billing_method: 'fixed',
      default_rate: 10000,
      unit_of_measure: 'unit'
    });

    // Create two clients - one for successful generations, one for failed attempt
    const successClientId = await context.createEntity('clients', {
      client_name: 'Success Client',
      billing_cycle: 'monthly'
    }, 'client_id');

    const failClientId = await context.createEntity('clients', {
      client_name: 'Fail Client',
      billing_cycle: 'monthly'
    }, 'client_id');

    // Configure tax for both clients
    await setupClientTaxConfiguration(context, {
      regionCode: 'US-NY',
      clientId: successClientId
    });
    await setupClientTaxConfiguration(context, {
      regionCode: 'US-NY',
      clientId: failClientId
    });

    // Create billing cycles
    const successCycle1 = await context.createEntity('client_billing_cycles', {
      client_id: successClientId,
      billing_cycle: 'monthly',
      effective_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      period_start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      period_end_date: createTestDateISO({ year: 2023, month: 2, day: 1 })
    }, 'billing_cycle_id');

    const failCycle = await context.createEntity('client_billing_cycles', {
      client_id: failClientId,
      billing_cycle: 'monthly',
      effective_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      period_start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      period_end_date: createTestDateISO({ year: 2023, month: 2, day: 1 })
    }, 'billing_cycle_id');

    const successCycle2 = await context.createEntity('client_billing_cycles', {
      client_id: successClientId,
      billing_cycle: 'monthly',
      effective_date: createTestDateISO({ year: 2023, month: 2, day: 1 }),
      period_start_date: createTestDateISO({ year: 2023, month: 2, day: 1 }),
      period_end_date: createTestDateISO({ year: 2023, month: 3, day: 1 })
    }, 'billing_cycle_id');

    // Store current clientId and switch to success client for plan assignment
    const originalClientId = context.clientId;
    (context as any).clientId = successClientId;

    // Create fixed plan assignment with full configuration for success client
    await createFixedPlanAssignment(context, serviceId, {
      planName: 'Basic Plan',
      billingFrequency: 'monthly',
      baseRateCents: 10000,
      startDate: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      billingTiming: 'advance'
    });

    // Restore original clientId
    (context as any).clientId = originalClientId;

    // First successful generation
    const invoice1 = await generateInvoice(successCycle1);
    if (!invoice1) {
      throw new Error('Failed to generate first invoice');
    }
    expect(invoice1.invoice_number).toBe('INV-000001');

    // Failed generation attempt (no contract line for this client)
    await expectError(
      () => generateInvoice(failCycle),
      {
        messagePattern: new RegExp(`No active contract lines found for client ${failClientId}`)
      }
    );

    // Second successful generation - should be next in sequence
    const invoice2 = await generateInvoice(successCycle2);
    if (!invoice2) {
      throw new Error('Failed to generate second invoice');
    }
    expect(invoice2.invoice_number).toBe('INV-000002');

    // Verify invoice items were created - should be single consolidated row for fixed plan
    const invoice2Items = await context.db('invoice_charges')
      .where({ invoice_id: invoice2.invoice_id, tenant: context.tenantId });
    expect(invoice2Items).toHaveLength(1);

    // Verify the sequence in next_number table
    const nextNumber = await context.db('next_number')
      .where({
        tenant: context.tenantId,
        entity_type: 'INVOICE'
      })
      .first();

    expect(nextNumber.last_number).toBe('2');
  });

  it('should handle various prefix lengths and special characters', async () => {
    // Test cases for different prefixes
    const prefixTests = [
      { prefix: 'VERY-LONG-PREFIX-', expected: 'VERY-LONG-PREFIX-000001', clientName: 'Long Prefix Co' },
      { prefix: 'INV/2024/', expected: 'INV/2024/000001', clientName: 'Slash Prefix Co' },
      { prefix: '#Special@_', expected: '#Special@_000001', clientName: 'Special Chars Co' },
      { prefix: '測試-', expected: '測試-000001', clientName: 'Unicode Co' },
      { prefix: '$$_##_', expected: '$$_##_000001', clientName: 'Multiple Special Co' }
    ];

    for (const testCase of prefixTests) {
      // Create a new client for each test case
      const clientId = await context.createEntity('clients', {
        client_name: testCase.clientName,
        billing_cycle: 'monthly'
      }, 'client_id');

      // Configure tax for the new client
      await setupClientTaxConfiguration(context, {
        regionCode: 'US-NY',
        clientId: clientId
      });

      // Set up invoice numbering settings with test prefix
      await context.db('next_number').where({
        tenant: context.tenantId,
        entity_type: 'INVOICE'
      }).delete();

      await context.db('next_number').insert({
        tenant: context.tenantId,
        entity_type: 'INVOICE',
        prefix: testCase.prefix,
        last_number: 0,
        initial_value: 1,
        padding_length: 6
      });

      // Create a contract line for generating invoice
      const planId = await context.createEntity('contract_lines', {
        contract_line_name: 'Basic Plan',
        billing_frequency: 'monthly',
        is_custom: false,
        contract_line_type: 'Fixed'
      }, 'contract_line_id');

      const serviceId = await createTestService(context, {
        service_name: 'Basic Service',
        billing_method: 'fixed',
        default_rate: 10000,
        unit_of_measure: 'unit'
      });

      await context.db('contract_line_services').insert({
        contract_line_id: planId,
        service_id: serviceId,
        quantity: 1,
        tenant: context.tenantId
      });

      // Store current clientId and switch to test client for plan assignment
      const originalClientId = context.clientId;
      (context as any).clientId = clientId;

      await createFixedPlanAssignment(context, serviceId, {
        planName: 'Basic Plan',
        billingFrequency: 'monthly',
        baseRateCents: 10000,
        startDate: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        billingTiming: 'advance'
      });

      // Restore original clientId
      (context as any).clientId = originalClientId;

      // Create billing cycle for this client
      const billingCycle = await context.createEntity('client_billing_cycles', {
        client_id: clientId,
        billing_cycle: 'monthly',
        effective_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        period_start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        period_end_date: createTestDateISO({ year: 2023, month: 2, day: 1 })
      }, 'billing_cycle_id');

      await context.db('client_contract_lines').insert({
        client_contract_line_id: uuidv4(),
        client_id: clientId,
        contract_line_id: planId,
        start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        is_active: true,
        tenant: context.tenantId
      });

      // Generate invoice and verify prefix handling
      const invoice = await generateInvoice(billingCycle);
      if (!invoice) {
        throw new Error(`Failed to generate invoice for prefix: ${testCase.prefix}`);
      }
      expect(invoice.invoice_number).toBe(testCase.expected);

      // Verify invoice items were created - should be single consolidated row for fixed plan
      const invoiceItems = await context.db('invoice_charges')
        .where({ invoice_id: invoice.invoice_id, tenant: context.tenantId });
      expect(invoiceItems).toHaveLength(1);
    }
  });

  it('should handle high initial value settings correctly', async () => {
    // Set up invoice numbering settings with high initial value
    await context.db('next_number').where({
      tenant: context.tenantId,
      entity_type: 'INVOICE'
    }).delete();

    await context.db('next_number').insert({
      tenant: context.tenantId,
      entity_type: 'INVOICE',
      prefix: 'INV-',
      last_number: 0,
      initial_value: 1000000,
      padding_length: 6
    });

    // Create a service
    const serviceId = await createTestService(context, {
      service_name: 'Basic Service',
      billing_method: 'fixed',
      default_rate: 10000,
      tax_region: 'US-NY'
    });

    // Create billing cycles for consecutive months
    const billingCycle1 = await context.createEntity('client_billing_cycles', {
      client_id: context.clientId,
      billing_cycle: 'monthly',
      effective_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      period_start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      period_end_date: createTestDateISO({ year: 2023, month: 2, day: 1 })
    }, 'billing_cycle_id');

    const billingCycle2 = await context.createEntity('client_billing_cycles', {
      client_id: context.clientId,
      billing_cycle: 'monthly',
      effective_date: createTestDateISO({ year: 2023, month: 2, day: 1 }),
      period_start_date: createTestDateISO({ year: 2023, month: 2, day: 1 }),
      period_end_date: createTestDateISO({ year: 2023, month: 3, day: 1 })
    }, 'billing_cycle_id');

    // Create fixed plan assignment with full configuration
    await createFixedPlanAssignment(context, serviceId, {
      planName: 'Basic Plan',
      billingFrequency: 'monthly',
      baseRateCents: 10000,
      startDate: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      billingTiming: 'advance'
    });

    // Generate invoices and verify they increment correctly from initial value
    const invoice1 = await generateInvoice(billingCycle1);
    const invoice2 = await generateInvoice(billingCycle2);

    if (!invoice1) {
      throw new Error(`Failed to generate invoice1`);
    }

    if (!invoice2) {
      throw new Error(`Failed to generate invoice2`);
    }

    // Verify numbers start from initial value and increment
    expect(invoice1.invoice_number).toBe('INV-1000000');
    expect(invoice2.invoice_number).toBe('INV-1000001');

    // Verify invoice items were created for both invoices - should be single consolidated row per invoice for fixed plans
    const invoice1Items = await context.db('invoice_charges')
      .where({ invoice_id: invoice1.invoice_id, tenant: context.tenantId });
    expect(invoice1Items).toHaveLength(1);

    const invoice2Items = await context.db('invoice_charges')
      .where({ invoice_id: invoice2.invoice_id, tenant: context.tenantId });
    expect(invoice2Items).toHaveLength(1);
  });
});
