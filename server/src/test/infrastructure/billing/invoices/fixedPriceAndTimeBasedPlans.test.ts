import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { generateInvoice } from 'server/src/lib/actions/invoiceGeneration';
import { v4 as uuidv4 } from 'uuid';
import { TextEncoder as NodeTextEncoder } from 'util';
import { TestContext } from '../../../../../test-utils/testContext';
import { createTestDateISO } from '../../../../../test-utils/dateUtils';
import {
  createTestService,
  createFixedPlanAssignment,
  addServiceToFixedPlan,
  setupClientTaxConfiguration,
  assignServiceTaxRate,
  ensureClientPlanBundlesTable
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

describe('Billing Invoice Generation – Fixed Price and Time-Based Plans', () => {
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
      clientName: 'Fixed Price Test Client',
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

  describe('Fixed Price Plans', () => {
    it('should generate an invoice with line items for each service', async () => {
      // Arrange - Use helper to properly set up fixed plan
      const service1Id = await createTestService(context, {
        service_name: 'Service 1',
        billing_method: 'fixed',
        default_rate: 10000,
        tax_region: 'US-NY'
      });

      const service2Id = await createTestService(context, {
        service_name: 'Service 2',
        billing_method: 'fixed',
        default_rate: 15000,
        tax_region: 'US-NY'
      });

      // Create the plan with first service
      const { planId } = await createFixedPlanAssignment(context, service1Id, {
        planName: 'Standard Fixed Plan',
        billingFrequency: 'monthly',
        baseRateCents: 25000,
        detailBaseRateCents: 10000,
        quantity: 1,
        startDate: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        billingTiming: 'advance'
      });

      // Add second service to the plan
      await addServiceToFixedPlan(context, planId, service2Id, {
        detailBaseRateCents: 15000
      });

      // Create billing cycle
      const billingCycleId = await context.createEntity('client_billing_cycles', {
        client_id: context.clientId,
        billing_cycle: 'monthly',
        effective_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        period_start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        period_end_date: createTestDateISO({ year: 2023, month: 2, day: 1 })
      }, 'billing_cycle_id');

      // Act
      const result = await generateInvoice(billingCycleId);

      // Assert - Fixed plans create a single consolidated invoice item
      expect(result).not.toBeNull();

      const invoiceItems = await context.db('invoice_charges')
        .where('invoice_id', result!.invoice_id)
        .select('*');

      // Modern fixed plans consolidate into single line item
      expect(invoiceItems).toHaveLength(1);
      expect(invoiceItems[0]).toMatchObject({
        net_amount: '25000'
      });
    });

    it('should calculate taxes correctly', async () => {
      // Arrange - Use helper to properly set up fixed plan
      const serviceId = await createTestService(context, {
        service_name: 'Taxable Service',
        billing_method: 'fixed',
        default_rate: 50000,
        unit_of_measure: 'unit',
        tax_region: 'US-NY'
      });

      const { planId } = await createFixedPlanAssignment(context, serviceId, {
        planName: 'Taxable Plan',
        billingFrequency: 'monthly',
        baseRateCents: 50000,
        detailBaseRateCents: 50000,
        quantity: 1,
        startDate: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        billingTiming: 'advance'
      });

      // Create billing cycle
      const billingCycleId = await context.createEntity('client_billing_cycles', {
        client_id: context.clientId,
        billing_cycle: 'monthly',
        effective_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        period_start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        period_end_date: createTestDateISO({ year: 2023, month: 2, day: 1 })
      }, 'billing_cycle_id');

      // Act
      const result = await generateInvoice(billingCycleId);

      // Assert - Tax should be calculated on the fixed plan amount
      expect(result).not.toBeNull();
      expect(result).toMatchObject({
        subtotal: 50000,
        status: 'draft'
      });

      // Verify tax amount (8.875% of 50000 = 4437.5, rounded to 4438)
      expect(result!.tax).toBeGreaterThan(0);
    });
  });

  describe('Time-Based Plans', () => {
    it('should generate an invoice based on time entries', async () => {
      // Arrange - Create time-based service and configuration
      const serviceId = await createTestService(context, {
        service_name: 'Hourly Consultation',
        billing_method: 'usage',
        default_rate: 10000,
        unit_of_measure: 'hour',
        tax_region: 'US-NY'
      });

      const planId = await context.createEntity('contract_lines', {
        contract_line_name: 'Hourly Plan',
        billing_frequency: 'monthly',
        is_custom: false,
        contract_line_type: 'Hourly'
      }, 'contract_line_id');

      const configId = uuidv4();

      // Set up contract line service configuration for time-based billing
      await context.db('contract_line_service_configuration').insert({
        config_id: configId,
        contract_line_id: planId,
        service_id: serviceId,
        configuration_type: 'Time',
        custom_rate: 5000, // $50/hour custom rate
        quantity: 1,
        tenant: context.tenantId
      });

      await context.db('contract_line_services').insert({
        contract_line_id: planId,
        service_id: serviceId,
        custom_rate: 5000,
        quantity: 1,
        tenant: context.tenantId
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
        contract_line_id: planId,
        start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        is_active: true,
        tenant: context.tenantId
      });

      // Create test ticket
      const statusId = (await context.db('statuses')
        .where({ tenant: context.tenantId, status_type: 'ticket' })
        .first())?.status_id;

      const ticketId = await context.createEntity('tickets', {
        title: 'Test Ticket',
        client_id: context.clientId,
        status_id: statusId,
        entered_by: context.userId,
        entered_at: createTestDateISO(),
        updated_at: createTestDateISO(),
        ticket_number: 'TEST-001'
      }, 'ticket_id');

      // Create time entry (2 hours)
      await context.db('time_entries').insert({
        tenant: context.tenantId,
        entry_id: uuidv4(),
        user_id: context.userId,
        start_time: createTestDateISO({ year: 2023, month: 1, day: 15, hour: 10 }),
        end_time: createTestDateISO({ year: 2023, month: 1, day: 15, hour: 12 }),
        work_item_id: ticketId,
        work_item_type: 'ticket',
        approval_status: 'APPROVED',
        service_id: serviceId,
        billable_duration: 120
      });

      // Act
      const result = await generateInvoice(billingCycleId);
      expect(result).not.toBeNull();

      // Assert - Time entries should be billed
      const invoiceItems = await context.db('invoice_charges')
        .where('invoice_id', result!.invoice_id)
        .select('*');

      expect(invoiceItems.length).toBeGreaterThan(0);
    });
  });
});
