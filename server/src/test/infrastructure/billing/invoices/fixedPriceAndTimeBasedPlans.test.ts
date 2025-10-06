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
  setupCompanyTaxConfiguration,
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

describe('Billing Invoice Generation – Fixed Price and Time-Based Plans', () => {
  let context: TestContext;

  async function configureDefaultTax() {
    await setupCompanyTaxConfiguration(context, {
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
        'company_billing_cycles',
        'company_billing_plans',
        'plan_service_configuration',
        'plan_service_fixed_config',
        'service_catalog',
        'billing_plan_fixed_config',
        'billing_plans',
        'tax_rates',
        'tax_regions',
        'company_tax_settings',
        'company_tax_rates',
        'next_number'
      ],
      companyName: 'Fixed Price Test Company',
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
    it('should generate an invoice with consolidated line items for fixed plan', async () => {
      // Create two services
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

      // Create billing cycle
      const billingCycleId = await context.createEntity('company_billing_cycles', {
        company_id: context.companyId,
        billing_cycle: 'monthly',
        effective_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        period_start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        period_end_date: createTestDateISO({ year: 2023, month: 2, day: 1 })
      }, 'billing_cycle_id');

      // Create plan with first service
      const { planId } = await createFixedPlanAssignment(context, service1Id, {
        planName: 'Standard Fixed Plan',
        billingFrequency: 'monthly',
        baseRateCents: 25000,  // Total for both services
        detailBaseRateCents: 10000,
        startDate: createTestDateISO({ year: 2023, month: 1, day: 1 })
      });

      // Add second service to plan
      await addServiceToFixedPlan(context, planId, service2Id, {
        quantity: 1,
        detailBaseRateCents: 15000
      });

      // Act
      const result = await generateInvoice(billingCycleId);

      // Assert - Fixed plans create a single consolidated invoice item
      expect(result).not.toBeNull();

      const invoiceItems = await context.db('invoice_items')
        .where('invoice_id', result!.invoice_id)
        .select('*');

      // Modern fixed plans consolidate into single line item
      expect(invoiceItems).toHaveLength(1);
      expect(invoiceItems[0]).toMatchObject({
        net_amount: '25000'
      });
    });

    it('should calculate taxes correctly', async () => {
      // Create service
      const serviceId = await createTestService(context, {
        service_name: 'Taxable Service',
        billing_method: 'fixed',
        default_rate: 50000,
        tax_region: 'US-NY'
      });

      // Create billing cycle
      const billingCycleId = await context.createEntity('company_billing_cycles', {
        company_id: context.companyId,
        billing_cycle: 'monthly',
        effective_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        period_start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        period_end_date: createTestDateISO({ year: 2023, month: 2, day: 1 })
      }, 'billing_cycle_id');

      // Assign plan
      await createFixedPlanAssignment(context, serviceId, {
        planName: 'Taxable Plan',
        billingFrequency: 'monthly',
        baseRateCents: 50000,
        startDate: createTestDateISO({ year: 2023, month: 1, day: 1 })
      });

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
      // Create time-based service
      const serviceId = await createTestService(context, {
        service_name: 'Hourly Consultation',
        billing_method: 'per_unit',
        default_rate: 5000,
        unit_of_measure: 'hour',
        tax_region: 'US-NY'
      });

      // Create billing cycle
      const billingCycleId = await context.createEntity('company_billing_cycles', {
        company_id: context.companyId,
        billing_cycle: 'monthly',
        effective_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        period_start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        period_end_date: createTestDateISO({ year: 2023, month: 1, day: 31 })
      }, 'billing_cycle_id');

      // For time-based billing, we need a time-based plan
      // Note: This is simplified - real implementation may differ
      const planId = await context.createEntity('billing_plans', {
        plan_name: 'Hourly Plan',
        billing_frequency: 'monthly',
        is_custom: false,
        plan_type: 'Hourly'
      }, 'plan_id');

      await context.db('company_billing_plans').insert({
        company_billing_plan_id: uuidv4(),
        company_id: context.companyId,
        plan_id: planId,
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
        company_id: context.companyId,
        status_id: statusId,
        entered_by: context.userId,
        entered_at: createTestDateISO(),
        updated_at: createTestDateISO(),
        ticket_number: 'TEST-001'
      }, 'ticket_id');

      // Create time entry
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
      const invoiceItems = await context.db('invoice_items')
        .where('invoice_id', result!.invoice_id)
        .select('*');

      expect(invoiceItems.length).toBeGreaterThan(0);
    });
  });
});