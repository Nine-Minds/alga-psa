import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { generateInvoice } from '@alga-psa/billing/actions/invoiceGeneration';
import { v4 as uuidv4 } from 'uuid';
import { TextEncoder as NodeTextEncoder } from 'util';
import { TestContext } from '../../../../../test-utils/testContext';
import { createTestDateISO } from '../../../../../test-utils/dateUtils';
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

const {
  beforeAll: setupContext,
  beforeEach: resetContext,
  afterEach: rollbackContext,
  afterAll: cleanupContext
} = TestContext.createHelpers();

describe('Billing Invoice Generation – Pricing Schedule Rate Overrides', () => {
  let context: TestContext;
  async function attachPlanToContract(params: {
    contractId: string;
    clientContractId: string;
    contractLineId: string;
    clientContractLineId?: string;
  }) {
    const { contractId, clientContractId, contractLineId, clientContractLineId } = params;

    await context.db('contract_lines')
      .where({
        tenant: context.tenantId,
        contract_line_id: contractLineId
      })
      .update({
        contract_id: contractId,
        display_order: 1,
        custom_rate: null
      });

    if (clientContractLineId) {
      await context.db('client_contract_lines')
        .where({
          tenant: context.tenantId,
          client_contract_line_id: clientContractLineId
        })
        .update({
          client_contract_id: clientContractId,
          contract_line_id: contractLineId,
          is_active: true
        });
    }
  }

  async function ensureClientPlanBundlesTable(): Promise<void> {
    const hasTable = await context.db.schema.hasTable('client_plan_bundles');
    if (!hasTable) {
      await context.db.schema.createTable('client_plan_bundles', (table) => {
        table.uuid('bundle_id').primary();
        table.uuid('client_id').notNullable();
        table.uuid('tenant').notNullable();
        table.boolean('is_active').notNullable().defaultTo(true);
        table.timestamp('start_date').notNullable();
        table.timestamp('end_date');
        table.boolean('po_required').notNullable().defaultTo(false);
        table.string('po_number');
        table.timestamps(true, true);
      });
    }
  }

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
        'invoice_charges',
        'invoices',
        'usage_tracking',
        'bucket_usage',
        'time_entries',
        'tickets',
        'client_billing_cycles',
        'client_contract_lines',
        'contract_line_services',
        'contract_line_service_configuration',
        'contract_line_service_fixed_config',
        'service_catalog',
        'contract_lines',
        'contracts',
        'client_contracts',
        'contract_pricing_schedules',
        'bucket_plans',
        'tax_rates',
        'tax_regions',
        'client_tax_settings',
        'client_tax_rates',
        'next_number'
      ],
      clientName: 'Pricing Schedule Test Client',
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
    await ensureClientPlanBundlesTable();
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
    await ensureClientPlanBundlesTable();
  }, 30000);

  afterEach(async () => {
    await rollbackContext();
  }, 30000);

  afterAll(async () => {
    await cleanupContext();
  }, 30000);

  describe('Pricing Schedule Override Rates', () => {
    it('should use pricing schedule rate instead of contract base rate', async () => {
      // Arrange - Create a fixed plan with base rate
      const serviceId = await createTestService(context, {
        service_name: 'Consulting Service',
        billing_method: 'fixed',
        default_rate: 10000, // $100/hour default
        tax_region: 'US-NY'
      });

      const { contractLineId, clientContractLineId } = await createFixedPlanAssignment(context, serviceId, {
        planName: 'Consulting Plan',
        billingFrequency: 'monthly',
        baseRateCents: 10000, // $100 base rate
        detailBaseRateCents: 10000,
        quantity: 1,
        startDate: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        billingTiming: 'advance'
      });

      // Create a contract to hold the pricing schedule
      const contractId = await context.createEntity('contracts', {
        contract_name: 'Client Contract',
        billing_frequency: 'monthly',
        is_active: true
      }, 'contract_id');

      // Link the contract to the client
      const clientContractId = await context.createEntity('client_contracts', {
        client_id: context.clientId,
        contract_id: contractId,
        start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        end_date: null,
        is_active: true
      }, 'client_contract_id');

      await attachPlanToContract({
        contractId,
        clientContractId,
        contractLineId,
        clientContractLineId
      });

      // Add pricing schedule with higher rate
      const scheduleId = uuidv4();
      await context.db('contract_pricing_schedules').insert({
        schedule_id: scheduleId,
        contract_id: contractId,
        tenant: context.tenantId,
        effective_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        end_date: null,
        custom_rate: 15000, // $150/hour override rate
        notes: 'Q1 rate increase'
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

      // Assert - Invoice should use pricing schedule rate
      expect(result).not.toBeNull();
      expect(result!.subtotal).toBe(15000);

      const invoiceItems = await context.db('invoice_charges')
        .where('invoice_id', result!.invoice_id)
        .select('*');

      expect(invoiceItems).toHaveLength(1);
      const item = invoiceItems[0];
      expect(parseInt(item.net_amount)).toBe(15000);
      expect(parseInt(item.unit_price ?? item.net_amount)).toBe(15000);
    });

    it('should fall back to contract rate when no pricing schedule exists', async () => {
      // Arrange
      const serviceId = await createTestService(context, {
        service_name: 'Default Service',
        billing_method: 'fixed',
        default_rate: 10000,
        tax_region: 'US-NY'
      });

      const { contractLineId, clientContractLineId } = await createFixedPlanAssignment(context, serviceId, {
        planName: 'Default Plan',
        billingFrequency: 'monthly',
        baseRateCents: 10000,
        detailBaseRateCents: 10000,
        quantity: 1,
        startDate: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        billingTiming: 'advance'
      });

      const contractId = await context.createEntity('contracts', {
        contract_name: 'Default Contract',
        billing_frequency: 'monthly',
        is_active: true
      }, 'contract_id');

      const clientContractId = await context.createEntity('client_contracts', {
        client_id: context.clientId,
        contract_id: contractId,
        start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        end_date: null,
        is_active: true
      }, 'client_contract_id');

      await attachPlanToContract({
        contractId,
        clientContractId,
        contractLineId,
        clientContractLineId
      });

      // Create billing cycle (without pricing schedule)
      const billingCycleId = await context.createEntity('client_billing_cycles', {
        client_id: context.clientId,
        billing_cycle: 'monthly',
        effective_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        period_start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        period_end_date: createTestDateISO({ year: 2023, month: 2, day: 1 })
      }, 'billing_cycle_id');

      // Act
      const result = await generateInvoice(billingCycleId);

      // Assert - Should use contract rate since no pricing schedule
      expect(result).not.toBeNull();
      expect(result!.subtotal).toBe(10000); // Should use base rate

      const invoiceItems = await context.db('invoice_charges')
        .where('invoice_id', result!.invoice_id)
        .select('*');

      expect(invoiceItems).toHaveLength(1);
      expect(parseInt(invoiceItems[0].net_amount)).toBe(10000);
    });

    it('should apply correct pricing schedule for specific billing period', async () => {
      // Arrange - Create service
      const serviceId = await createTestService(context, {
        service_name: 'Rate Changing Service',
        billing_method: 'fixed',
        default_rate: 10000,
        tax_region: 'US-NY'
      });

      const { contractLineId, clientContractLineId } = await createFixedPlanAssignment(context, serviceId, {
        planName: 'Flexible Rate Plan',
        billingFrequency: 'monthly',
        baseRateCents: 10000,
        detailBaseRateCents: 10000,
        quantity: 1,
        startDate: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        billingTiming: 'advance'
      });

      // Create contract with two pricing schedules
      const contractId = await context.createEntity('contracts', {
        contract_name: 'Multi-Rate Contract',
        billing_frequency: 'monthly',
        is_active: true
      }, 'contract_id');

      const clientContractId = await context.createEntity('client_contracts', {
        client_id: context.clientId,
        contract_id: contractId,
        start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        end_date: null,
        is_active: true
      }, 'client_contract_id');

      await attachPlanToContract({
        contractId,
        clientContractId,
        clientContractLineId,
        contractLineId
      });

      // Schedule 1: Jan-Feb @ $100/hour
      await context.db('contract_pricing_schedules').insert({
        schedule_id: uuidv4(),
        contract_id: contractId,
        tenant: context.tenantId,
        effective_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        end_date: createTestDateISO({ year: 2023, month: 2, day: 28 }),
        custom_rate: 10000,
        notes: 'January rate'
      });

      // Schedule 2: Mar+ @ $150/hour
      await context.db('contract_pricing_schedules').insert({
        schedule_id: uuidv4(),
        contract_id: contractId,
        tenant: context.tenantId,
        effective_date: createTestDateISO({ year: 2023, month: 3, day: 1 }),
        end_date: null,
        custom_rate: 15000,
        notes: 'Q1 rate increase'
      });

      // Create January billing cycle
      const januaryBillingCycleId = await context.createEntity('client_billing_cycles', {
        client_id: context.clientId,
        billing_cycle: 'monthly',
        effective_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        period_start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        period_end_date: createTestDateISO({ year: 2023, month: 2, day: 1 })
      }, 'billing_cycle_id');

      // Create March billing cycle
      const marchBillingCycleId = await context.createEntity('client_billing_cycles', {
        client_id: context.clientId,
        billing_cycle: 'monthly',
        effective_date: createTestDateISO({ year: 2023, month: 3, day: 1 }),
        period_start_date: createTestDateISO({ year: 2023, month: 3, day: 1 }),
        period_end_date: createTestDateISO({ year: 2023, month: 4, day: 1 })
      }, 'billing_cycle_id');

      // Act - Generate invoices for both periods
      const januaryInvoice = await generateInvoice(januaryBillingCycleId);
      const marchInvoice = await generateInvoice(marchBillingCycleId);

      // Assert - Both should succeed with different rates active
      expect(januaryInvoice).not.toBeNull();
      expect(marchInvoice).not.toBeNull();

      expect(januaryInvoice!.subtotal).toBe(10000);
      expect(marchInvoice!.subtotal).toBe(15000);

      const januaryItems = await context.db('invoice_charges')
        .where('invoice_id', januaryInvoice!.invoice_id)
        .select('*');
      const marchItems = await context.db('invoice_charges')
        .where('invoice_id', marchInvoice!.invoice_id)
        .select('*');

      expect(januaryItems).toHaveLength(1);
      expect(parseInt(januaryItems[0].net_amount)).toBe(10000);
      expect(marchItems).toHaveLength(1);
      expect(parseInt(marchItems[0].net_amount)).toBe(15000);
    });
  });

  describe('Pricing Schedule Edge Cases', () => {
    it('should handle null custom_rate in pricing schedule gracefully', async () => {
      // Arrange
      const serviceId = await createTestService(context, {
        service_name: 'Service with null rate',
        billing_method: 'fixed',
        default_rate: 10000,
        tax_region: 'US-NY'
      });

      const { contractLineId, clientContractLineId } = await createFixedPlanAssignment(context, serviceId, {
        planName: 'Null Rate Plan',
        billingFrequency: 'monthly',
        baseRateCents: 10000,
        detailBaseRateCents: 10000,
        quantity: 1,
        startDate: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        billingTiming: 'advance'
      });

      // Create contract with null rate pricing schedule
      const contractId = await context.createEntity('contracts', {
        contract_name: 'Null Rate Contract',
        billing_frequency: 'monthly',
        is_active: true
      }, 'contract_id');

      const clientContractId = await context.createEntity('client_contracts', {
        client_id: context.clientId,
        contract_id: contractId,
        start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        end_date: null,
        is_active: true
      }, 'client_contract_id');

      await attachPlanToContract({
        contractId,
        clientContractId,
        clientContractLineId,
        contractLineId
      });

      // Add pricing schedule with null rate
      await context.db('contract_pricing_schedules').insert({
        schedule_id: uuidv4(),
        contract_id: contractId,
        tenant: context.tenantId,
        effective_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        end_date: null,
        custom_rate: null, // Null rate should be skipped
        notes: 'Placeholder schedule'
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

      // Assert - Should fall back to contract rate
      expect(result).not.toBeNull();
      expect(result!.subtotal).toBe(10000); // Falls back to base rate

      const invoiceItems = await context.db('invoice_charges')
        .where('invoice_id', result!.invoice_id)
        ;

      expect(invoiceItems).toHaveLength(1);
      expect(parseInt(invoiceItems[0].net_amount)).toBe(10000);
    });

    it('should handle expired pricing schedules correctly', async () => {
      // Arrange
      const serviceId = await createTestService(context, {
        service_name: 'Service with expired schedule',
        billing_method: 'fixed',
        default_rate: 10000,
        tax_region: 'US-NY'
      });

      const { contractLineId, clientContractLineId } = await createFixedPlanAssignment(context, serviceId, {
        planName: 'Expired Schedule Plan',
        billingFrequency: 'monthly',
        baseRateCents: 10000,
        detailBaseRateCents: 10000,
        quantity: 1,
        startDate: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        billingTiming: 'advance'
      });

      // Create contract with expired pricing schedule
      const contractId = await context.createEntity('contracts', {
        contract_name: 'Expired Schedule Contract',
        billing_frequency: 'monthly',
        is_active: true
      }, 'contract_id');

      const clientContractId = await context.createEntity('client_contracts', {
        client_id: context.clientId,
        contract_id: contractId,
        start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        end_date: null,
        is_active: true
      }, 'client_contract_id');

      await attachPlanToContract({
        contractId,
        clientContractId,
        clientContractLineId,
        contractLineId
      });

      // Add pricing schedule that expired before billing period
      await context.db('contract_pricing_schedules').insert({
        schedule_id: uuidv4(),
        contract_id: contractId,
        tenant: context.tenantId,
        effective_date: createTestDateISO({ year: 2022, month: 12, day: 1 }),
        end_date: createTestDateISO({ year: 2022, month: 12, day: 31 }), // Ended in Dec
        custom_rate: 20000 // Higher rate
      });

      // Create billing cycle for January (after schedule expires)
      const billingCycleId = await context.createEntity('client_billing_cycles', {
        client_id: context.clientId,
        billing_cycle: 'monthly',
        effective_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        period_start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        period_end_date: createTestDateISO({ year: 2023, month: 2, day: 1 })
      }, 'billing_cycle_id');

      // Act
      const result = await generateInvoice(billingCycleId);

      // Assert - Should use base rate since schedule expired
      expect(result).not.toBeNull();
      expect(result!.subtotal).toBe(10000); // Uses base rate, not schedule rate

      const invoiceItems = await context.db('invoice_charges')
        .where('invoice_id', result!.invoice_id)
        ;

      expect(invoiceItems).toHaveLength(1);
      expect(parseInt(invoiceItems[0].net_amount)).toBe(10000);
    });
  });
});
