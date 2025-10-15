import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { generateInvoice } from 'server/src/lib/actions/invoiceGeneration';
import { TextEncoder as NodeTextEncoder } from 'util';
import { v4 as uuidv4 } from 'uuid';
import { TestContext } from '../../../../../test-utils/testContext';
import { createTestDateISO } from '../../../../../test-utils/dateUtils';
import {
  createTestService,
  createFixedPlanAssignment,
  setupClientTaxConfiguration,
  assignServiceTaxRate,
  ensureDefaultBillingSettings,
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

describe('Billing Invoice Generation – Invoice Number Generation (Part 2)', () => {
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
    await ensureDefaultBillingSettings(context);
  }, 30000);

  afterEach(async () => {
    await rollbackContext();
  }, 30000);

  afterAll(async () => {
    await cleanupContext();
  }, 30000);

  it('should handle numbers approaching maximum value for padding length', async () => {
    // Set up invoice numbering settings with a number close to maximum
    await context.db('next_number').where({
      tenant: context.tenantId,
      entity_type: 'INVOICE'
    }).delete();

    await context.db('next_number').insert({
      tenant: context.tenantId,
      entity_type: 'INVOICE',
      prefix: 'INV-',
      last_number: 999998, // One less than max for padding_length 6
      initial_value: 999999,
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

    // Create billing cycles for two consecutive months
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

    // Assign plan to client for both periods
    await context.db('client_contract_lines').insert([
      {
        client_contract_line_id: uuidv4(),
        client_id: context.clientId,
        contract_line_id: planId,
        start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        is_active: true,
        tenant: context.tenantId
      },
      {
        client_contract_line_id: uuidv4(),
        client_id: context.clientId,
        contract_line_id: planId,
        start_date: createTestDateISO({ year: 2023, month: 2, day: 1 }),
        is_active: true,
        tenant: context.tenantId
      }
    ]);

    // Generate invoices that will exceed padding length
    const invoice1 = await generateInvoice(billingCycle1);
    const invoice2 = await generateInvoice(billingCycle2);
    expect(invoice1).not.toBeNull();
    expect(invoice2).not.toBeNull();

    // Verify the first invoice uses full padding
    expect(invoice1!.invoice_number).toBe('INV-999999');

    // Verify the second invoice continues past padding length
    expect(invoice2!.invoice_number).toBe('INV-1000000');
  });

  it('should handle maximum padding length (10) correctly', async () => {
    // Set up invoice numbering settings with maximum padding length
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
      padding_length: 10
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

    await createFixedPlanAssignment(context, serviceId, {
      planName: 'Basic Plan',
      billingFrequency: 'monthly',
      baseRateCents: 10000,
      startDate: createTestDateISO({ year: 2023, month: 1, day: 1 })
    });

    // Create billing cycle
    const billingCycle = await context.createEntity('client_billing_cycles', {
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

    // Generate invoice
    const invoice = await generateInvoice(billingCycle);
    expect(invoice).not.toBeNull();

    // Verify the invoice number format
    expect(invoice!.invoice_number).toMatch(/^INV-\d{10}$/);
    expect(invoice!.invoice_number).toBe('INV-0000000001');
  });

  it('should handle overlapping last_number with existing invoice numbers', async () => {
    // Helper function to get highest invoice number
    const getHighestInvoiceNumber = async () => {
      const result = await context.db.raw(`
        WITH extracted_numbers AS (
          SELECT
            CASE
              WHEN invoice_number LIKE 'INV-%'
              THEN NULLIF(regexp_replace(substring(invoice_number FROM 5), '^0+', ''), '')::BIGINT
              ELSE NULL
            END AS num
          FROM invoices
          WHERE tenant = ?
        )
        SELECT COALESCE(MAX(num), 0) as max_num
        FROM extracted_numbers
        WHERE num IS NOT NULL
      `, [context.tenantId]);

      return result.rows[0].max_num || 0;
    };

    // Helper function to get the minimum invoice number
    const getMinimumInvoiceNumber = async () => {
      const result = await context.db.raw(`
        WITH extracted_numbers AS (
          SELECT
            CASE
              WHEN invoice_number LIKE 'INV-%'
              THEN NULLIF(regexp_replace(substring(invoice_number FROM 5), '^0+', ''), '')::BIGINT
              ELSE NULL
            END AS num
          FROM invoices
          WHERE tenant = ?
        )
        SELECT COALESCE(MIN(num), 0) as min_num
        FROM extracted_numbers
        WHERE num IS NOT NULL
      `, [context.tenantId]);

      return result.rows[0].min_num || 0;
    };

    // Set up invoice numbering settings
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
      padding_length: 3
    });

    // Create a contract line for generating invoices
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
      tax_region: 'US-NY'
    });

    await context.db('contract_line_services').insert({
      contract_line_id: planId,
      service_id: serviceId,
      quantity: 1,
      tenant: context.tenantId
    });

    // Create billing cycles for three consecutive months
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

    const billingCycle3 = await context.createEntity('client_billing_cycles', {
      client_id: context.clientId,
      billing_cycle: 'monthly',
      effective_date: createTestDateISO({ year: 2023, month: 3, day: 1 }),
      period_start_date: createTestDateISO({ year: 2023, month: 3, day: 1 }),
      period_end_date: createTestDateISO({ year: 2023, month: 4, day: 1 })
    }, 'billing_cycle_id');

    // Assign plan to client for all periods
    await context.db('client_contract_lines').insert([
      {
        client_contract_line_id: uuidv4(),
        client_id: context.clientId,
        contract_line_id: planId,
        start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        is_active: true,
        tenant: context.tenantId
      },
      {
        client_contract_line_id: uuidv4(),
        client_id: context.clientId,
        contract_line_id: planId,
        start_date: createTestDateISO({ year: 2023, month: 2, day: 1 }),
        is_active: true,
        tenant: context.tenantId
      },
      {
        client_contract_line_id: uuidv4(),
        client_id: context.clientId,
        contract_line_id: planId,
        start_date: createTestDateISO({ year: 2023, month: 3, day: 1 }),
        is_active: true,
        tenant: context.tenantId
      }
    ]);

    // 1. Query for the minimum invoice number.
    const minInvoiceNumber = await getMinimumInvoiceNumber();

    // 2. Build the test so that we create 3 invoices by manipulating the next invoice such that
    //   - we are two numbers under the next minimum
    //   - when we create the third invoice, it would conflict with the prior lowest invoice number
    // and then the third invoice should be max invoice number + 1

    const initialNumber = minInvoiceNumber - 2;

    // Set the next_number to be two less than the minimum
    await context.db('next_number')
      .where({
        tenant: context.tenantId,
        entity_type: 'INVOICE'
      })
      .update({
        last_number: initialNumber - 1,
        initial_value: initialNumber
      });

    // Generate the first two invoices
    const invoice1 = await generateInvoice(billingCycle1);
    const invoice2 = await generateInvoice(billingCycle2);
    expect(invoice1).not.toBeNull();
    expect(invoice2).not.toBeNull();

    // Assert that the first two invoices are generated correctly
    expect(invoice1!.invoice_number).toBe(`INV-${String(initialNumber).padStart(3, '0')}`);
    expect(invoice2!.invoice_number).toBe(`INV-${String(initialNumber + 1).padStart(3, '0')}`);

    const maxInvoiceNumber = await getHighestInvoiceNumber();

    // Generate an invoice that would conflict with the prior lowest invoice number
    const invoice3 = await generateInvoice(billingCycle3);
    expect(invoice3).not.toBeNull();


      // Output the invoice numbers of every existing invoice to the console
      const allInvoices = await context.db('invoices').where({ tenant: context.tenantId }).select('invoice_number');
      console.log('All Invoice Numbers:', allInvoices.map(invoice => invoice.invoice_number));

    // Assert that the third invoice is the max invoice number + 1
    expect(invoice3!.invoice_number).toBe(`INV-${String(parseInt(maxInvoiceNumber) + 1).padStart(3, '0')}`);

    // Verify the next_number table is updated correctly
    const nextNumberRecord = await context.db('next_number')
      .where({
        tenant: context.tenantId,
        entity_type: 'INVOICE'
      })
      .first();

    expect(parseInt(nextNumberRecord.last_number, 10)).toBe(parseInt(maxInvoiceNumber) + 1);
  });

  it('should generate sequential invoice numbers with proper formatting', async () => {
    // Set up invoice numbering settings with a higher initial value
    await context.db('next_number').where({
      tenant: context.tenantId,
      entity_type: 'INVOICE'
    }).delete();

    await context.db('next_number').insert({
      tenant: context.tenantId,
      entity_type: 'INVOICE',
      prefix: 'INV-',
      last_number: 9999,
      initial_value: 10000,
      padding_length: 6
    });

    // Create a contract line for generating invoices
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
      tax_region: 'US-NY'
    });

    await context.db('contract_line_services').insert({
      contract_line_id: planId,
      service_id: serviceId,
      quantity: 1,
      tenant: context.tenantId
    });

    // Create multiple billing cycles to generate multiple invoices
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

    const billingCycle3 = await context.createEntity('client_billing_cycles', {
      client_id: context.clientId,
      billing_cycle: 'monthly',
      effective_date: createTestDateISO({ year: 2023, month: 3, day: 1 }),
      period_start_date: createTestDateISO({ year: 2023, month: 3, day: 1 }),
      period_end_date: createTestDateISO({ year: 2023, month: 4, day: 1 })
    }, 'billing_cycle_id');

    // Assign plan to client for all periods
    await context.db('client_contract_lines').insert([
      {
        client_contract_line_id: uuidv4(),
        client_id: context.clientId,
        contract_line_id: planId,
        start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        is_active: true,
        tenant: context.tenantId
      },
      {
        client_contract_line_id: uuidv4(),
        client_id: context.clientId,
        contract_line_id: planId,
        start_date: createTestDateISO({ year: 2023, month: 2, day: 1 }),
        is_active: true,
        tenant: context.tenantId
      },
      {
        client_contract_line_id: uuidv4(),
        client_id: context.clientId,
        contract_line_id: planId,
        start_date: createTestDateISO({ year: 2023, month: 3, day: 1 }),
        is_active: true,
        tenant: context.tenantId
      }
    ]);

    // Generate invoices in sequence
    const invoice1 = await generateInvoice(billingCycle1);
    const invoice2 = await generateInvoice(billingCycle2);
    const invoice3 = await generateInvoice(billingCycle3);
    expect(invoice1).not.toBeNull();
    expect(invoice2).not.toBeNull();
    expect(invoice3).not.toBeNull();

    // Verify invoice numbers match the configured pattern and sequence
    expect(invoice1!.invoice_number).toMatch(/^INV-\d{6}$/);
    expect(invoice2!.invoice_number).toMatch(/^INV-\d{6}$/);
    expect(invoice3!.invoice_number).toMatch(/^INV-\d{6}$/);

    expect(invoice1!.invoice_number).toBe('INV-010000');
    expect(invoice2!.invoice_number).toBe('INV-010001');
    expect(invoice3!.invoice_number).toBe('INV-010002');

    // Verify the next_number table is updated correctly
    const nextNumberRecord = await context.db('next_number')
      .where({
        tenant: context.tenantId,
        entity_type: 'INVOICE'
      })
      .first();

    expect(parseInt(nextNumberRecord.last_number, 10)).toBe(10002);
  });
  
  it('should test unicode characters in prefix', async () => {
    // Set up invoice numbering settings with a unicode prefix
    await context.db('next_number').where({
      tenant: context.tenantId,
      entity_type: 'INVOICE'
    }).delete();

    await context.db('next_number').insert({
      tenant: context.tenantId,
      entity_type: 'INVOICE',
      prefix: '你好-',
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

    await createFixedPlanAssignment(context, serviceId, {
      planName: 'Basic Plan',
      billingFrequency: 'monthly',
      baseRateCents: 10000,
      startDate: createTestDateISO({ year: 2023, month: 1, day: 1 })
    });

    // Create billing cycle
    const billingCycle = await context.createEntity('client_billing_cycles', {
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

    // Generate invoice
    const invoice = await generateInvoice(billingCycle);
    expect(invoice).not.toBeNull();

    // Verify the invoice number format
    expect(invoice!.invoice_number).toBe('你好-000001');
  });

  it('should validate empty or whitespace-only prefix handling', async () => {
    // Set up invoice numbering settings with an empty prefix
    await context.db('next_number').where({
      tenant: context.tenantId,
      entity_type: 'INVOICE'
    }).delete();

    await context.db('next_number').insert({
      tenant: context.tenantId,
      entity_type: 'INVOICE',
      prefix: '',
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

    await createFixedPlanAssignment(context, serviceId, {
      planName: 'Basic Plan',
      billingFrequency: 'monthly',
      baseRateCents: 10000,
      startDate: createTestDateISO({ year: 2023, month: 1, day: 1 })
    });

    // Create billing cycle
    const billingCycle = await context.createEntity('client_billing_cycles', {
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

    // Generate invoice
    const invoice = await generateInvoice(billingCycle);
    expect(invoice).not.toBeNull();

    // Verify the invoice number format
    expect(invoice!.invoice_number).toBe('000001');
  });

  it('should test extremely long prefix values', async () => {
    // Set up invoice numbering settings with a long prefix
    await context.db('next_number').where({
      tenant: context.tenantId,
      entity_type: 'INVOICE'
    }).delete();

    const longPrefix = 'ThisIsAVeryLongPrefix-';

    await context.db('next_number').insert({
      tenant: context.tenantId,
      entity_type: 'INVOICE',
      prefix: longPrefix,
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

    await createFixedPlanAssignment(context, serviceId, {
      planName: 'Basic Plan',
      billingFrequency: 'monthly',
      baseRateCents: 10000,
      startDate: createTestDateISO({ year: 2023, month: 1, day: 1 })
    });

    // Create billing cycle
    const billingCycle = await context.createEntity('client_billing_cycles', {
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

    // Generate invoice
    const invoice = await generateInvoice(billingCycle);
    expect(invoice).not.toBeNull();

    // Verify the invoice number format
    expect(invoice!.invoice_number).toBe(`${longPrefix}000001`);
  });

  it('should test changing from one prefix to another', async () => {
    // Set up initial invoice numbering settings with prefix 'INV-'
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

    await createFixedPlanAssignment(context, serviceId, {
      planName: 'Basic Plan',
      billingFrequency: 'monthly',
      baseRateCents: 10000,
      startDate: createTestDateISO({ year: 2023, month: 1, day: 1 })
    });

    // Create billing cycle
    const billingCycle1 = await context.createEntity('client_billing_cycles', {
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

    // Generate invoice with initial prefix
    const invoice1 = await generateInvoice(billingCycle1);
    expect(invoice1).not.toBeNull();

    // Verify the invoice number format with initial prefix
    expect(invoice1!.invoice_number).toBe('INV-000001');

    // Change the prefix to 'BILL-'
    await context.db('next_number')
      .where({ tenant: context.tenantId, entity_type: 'INVOICE' })
      .update({ prefix: 'BILL-' });

    // Create a second billing cycle (plan already assigned from earlier)
    const billingCycle2 = await context.createEntity('client_billing_cycles', {
        client_id: context.clientId,
        billing_cycle: 'monthly',
        effective_date: createTestDateISO({ year: 2023, month: 2, day: 1 }),
        period_start_date: createTestDateISO({ year: 2023, month: 2, day: 1 }),
        period_end_date: createTestDateISO({ year: 2023, month: 3, day: 1 })
      }, 'billing_cycle_id');
  
      await context.db('client_contract_lines').insert({
        client_contract_line_id: uuidv4(),
        client_id: context.clientId,
        contract_line_id: planId,
        start_date: createTestDateISO({ year: 2023, month: 2, day: 1 }),
        is_active: true,
        tenant: context.tenantId
      });

    // Generate invoice with new prefix
    const invoice2 = await generateInvoice(billingCycle2);
    expect(invoice2).not.toBeNull();

    // Verify the invoice number format with the new prefix
    expect(invoice2!.invoice_number).toBe('BILL-000002');
  });

  it('should test changing prefix length', async () => {
    // Set up initial invoice numbering settings with prefix 'INV-'
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

    await createFixedPlanAssignment(context, serviceId, {
      planName: 'Basic Plan',
      billingFrequency: 'monthly',
      baseRateCents: 10000,
      startDate: createTestDateISO({ year: 2023, month: 1, day: 1 })
    });

    // Create billing cycle
    const billingCycle1 = await context.createEntity('client_billing_cycles', {
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

    // Generate invoice with initial prefix
    const invoice1 = await generateInvoice(billingCycle1);
    expect(invoice1).not.toBeNull();

    // Verify the invoice number format with initial prefix
    expect(invoice1!.invoice_number).toBe('INV-000001');

    // Change the prefix to a shorter one: 'IN-'
    await context.db('next_number')
      .where({ tenant: context.tenantId, entity_type: 'INVOICE' })
      .update({ prefix: 'IN-' });

      // Create a second billing cycle (plan already assigned from earlier)
      const billingCycle2 = await context.createEntity('client_billing_cycles', {
        client_id: context.clientId,
        billing_cycle: 'monthly',
        effective_date: createTestDateISO({ year: 2023, month: 2, day: 1 }),
        period_start_date: createTestDateISO({ year: 2023, month: 2, day: 1 }),
        period_end_date: createTestDateISO({ year: 2023, month: 3, day: 1 })
      }, 'billing_cycle_id');
  
      await context.db('client_contract_lines').insert({
        client_contract_line_id: uuidv4(),
        client_id: context.clientId,
        contract_line_id: planId,
        start_date: createTestDateISO({ year: 2023, month: 2, day: 1 }),
        is_active: true,
        tenant: context.tenantId
      });      

    // Generate invoice with shorter prefix
    const invoice2 = await generateInvoice(billingCycle2);
    expect(invoice2).not.toBeNull();

    // Verify the invoice number format with the new prefix
    expect(invoice2!.invoice_number).toBe('IN-000002');

    // Change the prefix to a longer one: 'INVOICE-'
    await context.db('next_number')
    .where({ tenant: context.tenantId, entity_type: 'INVOICE' })
    .update({ prefix: 'INVOICE-' });

    // Create a third billing cycle (plan already assigned from earlier)
    const billingCycle3 = await context.createEntity('client_billing_cycles', {
      client_id: context.clientId,
      billing_cycle: 'monthly',
      effective_date: createTestDateISO({ year: 2023, month: 3, day: 1 }),
      period_start_date: createTestDateISO({ year: 2023, month: 3, day: 1 }),
      period_end_date: createTestDateISO({ year: 2023, month: 4, day: 1 })
    }, 'billing_cycle_id');

    await context.db('client_contract_lines').insert({
      client_contract_line_id: uuidv4(),
      client_id: context.clientId,
      contract_line_id: planId,
      start_date: createTestDateISO({ year: 2023, month: 3, day: 1 }),
      is_active: true,
      tenant: context.tenantId
    });

    // Generate invoice with longer prefix
    const invoice3 = await generateInvoice(billingCycle3);
    expect(invoice3).not.toBeNull();

    // Verify the invoice number format with the new prefix
    expect(invoice3!.invoice_number).toBe('INVOICE-000003');
  });
});
