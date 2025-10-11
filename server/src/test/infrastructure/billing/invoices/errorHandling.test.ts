import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { generateInvoice } from 'server/src/lib/actions/invoiceGeneration';
import { v4 as uuidv4 } from 'uuid';
import { TextEncoder as NodeTextEncoder } from 'util';
import { TestContext } from '../../../../../test-utils/testContext';
import { createTestDateISO } from '../../../../../test-utils/dateUtils';
import { expectError, expectNotFound } from '../../../../../test-utils/errorUtils';
import {
  createTestService,
  createFixedPlanAssignment,
  setupClientTaxConfiguration,
  assignServiceTaxRate
} from '../../../../../test-utils/billingTestHelpers';
import { setupCommonMocks } from '../../../../../test-utils/testMocks';

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

  it('should handle missing billing plans', async () => {
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
        messagePattern: new RegExp(`No active billing plans found for client ${newClientId}`)
      }
    );
  });

  it('should handle undefined service rates', async () => {
    // Create a service without a rate (rate = 0)
    const serviceId = await createTestService(context, {
      service_name: 'Service Without Rate',
      billing_method: 'fixed',
      default_rate: 0,  // Invalid rate
      tax_region: 'US-NY'
    });

    // Create billing cycle
    const billingCycleId = await context.createEntity('client_billing_cycles', {
      client_id: context.clientId,
      billing_cycle: 'monthly',
      effective_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      period_start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      period_end_date: createTestDateISO({ year: 2023, month: 2, day: 1 })
    }, 'billing_cycle_id');

    // Assign plan with invalid service
    await createFixedPlanAssignment(context, serviceId, {
      planName: 'Invalid Plan',
      billingFrequency: 'monthly',
      baseRateCents: 0,  // Invalid rate
      startDate: createTestDateISO({ year: 2023, month: 1, day: 1 })
    });

    await expectError(() => generateInvoice(billingCycleId));
  });

  it('should throw error when regenerating for same period', async () => {
    // Create a service
    const serviceId = await createTestService(context, {
      service_name: 'Monthly Service',
      billing_method: 'fixed',
      default_rate: 10000,
      tax_region: 'US-NY'
    });

    // Create billing cycle
    const billingCycleId = await context.createEntity('client_billing_cycles', {
      client_id: context.clientId,
      billing_cycle: 'monthly',
      effective_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      period_start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      period_end_date: createTestDateISO({ year: 2023, month: 2, day: 1 })
    }, 'billing_cycle_id');

    // Assign plan
    await createFixedPlanAssignment(context, serviceId, {
      planName: 'Standard Fixed Plan',
      billingFrequency: 'monthly',
      baseRateCents: 10000,
      startDate: createTestDateISO({ year: 2023, month: 1, day: 1 })
    });

    // Generate first invoice
    const firstInvoice = await generateInvoice(billingCycleId);

    // Verify invoice was created with consolidated fixed-fee item
    expect(firstInvoice).not.toBeNull();
    const invoiceItems = await context.db('invoice_items')
      .where({ invoice_id: firstInvoice!.invoice_id, tenant: context.tenantId });
    expect(invoiceItems).toHaveLength(1);

    // Attempt to generate second invoice for same period
    await expectError(
      () => generateInvoice(billingCycleId),
      {
        message: 'No active billing plans for this period'
      }
    );
  });
});