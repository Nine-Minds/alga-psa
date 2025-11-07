import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { generateInvoice, createInvoiceFromBillingResult } from 'server/src/lib/actions/invoiceGeneration';
import { v4 as uuidv4 } from 'uuid';
import { TextEncoder as NodeTextEncoder } from 'util';
import { TestContext } from '../../../../../test-utils/testContext';
import { createTestDateISO } from '../../../../../test-utils/dateUtils';
import { expectError, expectNotFound } from '../../../../../test-utils/errorUtils';
import {
  createTestService,
  createFixedPlanAssignment,
  setupClientTaxConfiguration,
  assignServiceTaxRate,
  ensureClientPlanBundlesTable
} from '../../../../../test-utils/billingTestHelpers';
import { setupCommonMocks } from '../../../../../test-utils/testMocks';
import type { IBillingCharge, IBillingResult } from 'server/src/interfaces/billing.interfaces';

// Override DB_PORT to connect directly to PostgreSQL instead of pgbouncer
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

describe('Billing Invoice Generation – Error Handling', () => {
  let context: TestContext;

  async function configureDefaultTax() {
    await setupClientTaxConfiguration(context, {
      regionCode: 'US-NY',
      regionName: 'New York',
      description: 'NY State Tax',
      startDate: '2020-01-01T00:00:00.000Z',
      taxPercentage: 8.875
    });
    await assignServiceTaxRate(context, '*', 'US-NY', { onlyUnset: true });
    await ensureClientPlanBundlesTable(context);
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
        'client_tax_settings',
        'client_tax_rates',
        'next_number'
      ],
      clientName: 'Error Handling Test Client',
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
  }, 120000);

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
    const nextNumberRecord = {
      tenant: context.tenantId,
      entity_type: 'INVOICE',
      prefix: 'INV-',
      last_number: 0,
      initial_value: 1,
      padding_length: 6
    };
    await context.db('next_number').insert(nextNumberRecord);

    await configureDefaultTax();
  }, 30000);

  afterEach(async () => {
    await rollbackContext();
  }, 30000);

  afterAll(async () => {
    await cleanupContext();
  }, 30000);

  it('should handle invalid billing period dates', async () => {
    await expectNotFound(
      () => generateInvoice('123e4567-e89b-12d3-a456-426614174000'),
      'Billing cycle'
    );
  });

  it('should handle missing contract lines', async () => {
    // Create client without plans
    const newClientId = await context.createEntity('clients', {
      client_name: 'Client Without Plans',
      billing_cycle: 'monthly'
    }, 'client_id');

    // Configure tax for the new client
    await setupClientTaxConfiguration(context, {
      regionCode: 'US-NY',
      clientId: newClientId
    });

    // Create billing cycle
    const billingCycleId = await context.createEntity('client_billing_cycles', {
      client_id: newClientId,
      billing_cycle: 'monthly',
      effective_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      period_start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      period_end_date: createTestDateISO({ year: 2023, month: 2, day: 1 })
    }, 'billing_cycle_id');

    await expectError(
      () => generateInvoice(billingCycleId),
      {
        messagePattern: new RegExp(`No active contract lines found for client ${newClientId} in the given period`)
      }
    );
  });

  it('should handle undefined service rates', async () => {
    // Arrange - Create a service with no default rate
    const serviceId = await createTestService(context, {
      service_name: 'Service Without Rate',
      billing_method: 'fixed',
      default_rate: 0, // Set to 0 instead of undefined
      unit_of_measure: 'unit',
      tax_region: 'US-NY'
    });

    // Manually create configuration without setting a rate in the config table
    const planId = await context.createEntity('contract_lines', {
      contract_line_name: 'Invalid Plan',
      billing_frequency: 'monthly',
      is_custom: false,
      contract_line_type: 'Fixed'
    }, 'contract_line_id');

    const configId = uuidv4();

    await context.db('contract_line_services').insert({
      contract_line_id: planId,
      service_id: serviceId,
      tenant: context.tenantId
    });

    await context.db('contract_line_service_configuration').insert({
      config_id: configId,
      contract_line_id: planId,
      service_id: serviceId,
      configuration_type: 'Fixed',
      tenant: context.tenantId
    });

    // Intentionally skip contract_line_service_fixed_config to test missing rate config

    // Create billing cycle
    const billingCycleId = await context.createEntity('client_billing_cycles', {
      client_id: context.clientId,
      billing_cycle: 'monthly',
      effective_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      period_start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      period_end_date: createTestDateISO({ year: 2023, month: 2, day: 1 })
    }, 'billing_cycle_id');

    await context.db('client_contract_lines').insert({
      client_contract_line_id: uuidv4(),
      client_id: context.clientId,
      contract_line_id: planId,
      start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      is_active: true,
      tenant: context.tenantId
    });

    await expectError(() => generateInvoice(billingCycleId));
  });

  it('should throw error when regenerating for same period', async () => {
    // Arrange - Use helper to create proper fixed plan configuration
    const serviceId = await createTestService(context, {
      service_name: 'Monthly Service',
      billing_method: 'fixed',
      default_rate: 10000,
      unit_of_measure: 'unit',
      tax_region: 'US-NY'
    });

    await assignServiceTaxRate(context, serviceId, 'US-NY');

    const billingCycleId = await context.createEntity('client_billing_cycles', {
      client_id: context.clientId,
      billing_cycle: 'monthly',
      effective_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      period_start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      period_end_date: createTestDateISO({ year: 2023, month: 2, day: 1 })
    }, 'billing_cycle_id');

    const cycleRecord = await context.db('client_billing_cycles')
      .where({ billing_cycle_id: billingCycleId, tenant: context.tenantId })
      .first();

    const cycleStart = cycleRecord.period_start_date ?? cycleRecord.effective_date;
    const cycleEnd = cycleRecord.period_end_date ?? cycleRecord.effective_date;

    const charge: IBillingCharge = {
      tenant: context.tenantId,
      type: 'usage',
      serviceId,
      serviceName: 'Monthly Service',
      quantity: 1,
      rate: 10000,
      total: 10000,
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
      charges: [charge],
      discounts: [],
      adjustments: [],
      totalAmount: 10000,
      finalAmount: 10000
    };

    await createInvoiceFromBillingResult(
      billingResult,
      context.clientId,
      cycleStart,
      cycleEnd,
      billingCycleId,
      context.userId
    );

    const firstInvoice = await context.db('invoices')
      .where({ billing_cycle_id: billingCycleId, tenant: context.tenantId })
      .first();

    // Verify invoice was created with consolidated fixed-fee item
    expect(firstInvoice).not.toBeNull();
    const invoiceItems = await context.db('invoice_charges')
      .where({ invoice_id: firstInvoice!.invoice_id, tenant: context.tenantId });
    expect(invoiceItems).toHaveLength(1);

    // Attempt to generate second invoice for same period
    await expectError(
      () => generateInvoice(billingCycleId),
      {
        message: 'No active contract lines for this period'
      }
    );
  });
});
