import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import '../../../test-utils/nextApiMock';
import { generateInvoice } from 'server/src/lib/actions/invoiceGeneration';
import { v4 as uuidv4 } from 'uuid';
import { TextEncoder as NodeTextEncoder } from 'util';
import { TestContext } from '../../../test-utils/testContext';
import { createTestDateISO } from '../../../test-utils/dateUtils';
import { expectError } from '../../../test-utils/errorUtils';
import {
  createTestService,
  createFixedPlanAssignment,
  setupCompanyTaxConfiguration,
  assignServiceTaxRate
} from '../../../test-utils/billingTestHelpers';
import { setupCommonMocks } from '../../../test-utils/testMocks';

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

describe('Billing Invoice Generation – Invoice Number Generation (Part 1)', () => {
  let context: TestContext;

  async function configureDefaultTax() {
    await setupCompanyTaxConfiguration(context, {
      regionCode: 'US-NY',
      regionName: 'New York',
      description: 'NY State Tax',
      startDate: '2025-01-01T00:00:00.000Z',
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
      companyName: 'Invoice Number Test Company',
      userType: 'internal'
    });

    const mockContext = setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId
    });

    mockedTenantId = context.tenantId;
    mockedUserId = context.userId;

    console.log('Created tenant:', context.tenantId);
  });

  beforeEach(async () => {
    await resetContext();

    // Set up invoice numbering settings
    const nextNumberRecord = {
      tenant: context.tenantId,
      entity_type: 'INVOICE',
      prefix: 'INV-',
      last_number: 0,
      initial_value: 1,
      padding_length: 6
    };
    console.log('Adding next_number record:', nextNumberRecord);
    await context.db('next_number').insert(nextNumberRecord);

    // Configure default tax for the test company
    await configureDefaultTax();
  });

  afterEach(async () => {
    await rollbackContext();
  });

  afterAll(async () => {
    await cleanupContext();
  });

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

    // Create a service and plan for successful generations
    const serviceId = await createTestService(context, {
      service_name: 'Basic Service',
      billing_method: 'fixed',
      default_rate: 10000,
      tax_region: 'US-NY'
    });

    // Create two companies - one for successful generations, one for failed attempt
    const successCompanyId = await context.createEntity('companies', {
      company_name: 'Success Company',
      billing_cycle: 'monthly'
    }, 'company_id');

    const failCompanyId = await context.createEntity('companies', {
      company_name: 'Fail Company',
      billing_cycle: 'monthly'
    }, 'company_id');

    // Configure tax for both companies
    await setupCompanyTaxConfiguration(context, {
      regionCode: 'US-NY',
      companyId: successCompanyId
    });
    await setupCompanyTaxConfiguration(context, {
      regionCode: 'US-NY',
      companyId: failCompanyId
    });

    // Create billing cycles
    const successCycle1 = await context.createEntity('company_billing_cycles', {
      company_id: successCompanyId,
      billing_cycle: 'monthly',
      effective_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      period_start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      period_end_date: createTestDateISO({ year: 2023, month: 2, day: 1 })
    }, 'billing_cycle_id');

    const failCycle = await context.createEntity('company_billing_cycles', {
      company_id: failCompanyId,
      billing_cycle: 'monthly',
      effective_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      period_start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      period_end_date: createTestDateISO({ year: 2023, month: 2, day: 1 })
    }, 'billing_cycle_id');

    const successCycle2 = await context.createEntity('company_billing_cycles', {
      company_id: successCompanyId,
      billing_cycle: 'monthly',
      effective_date: createTestDateISO({ year: 2023, month: 2, day: 1 }),
      period_start_date: createTestDateISO({ year: 2023, month: 2, day: 1 }),
      period_end_date: createTestDateISO({ year: 2023, month: 3, day: 1 })
    }, 'billing_cycle_id');

    // Store current companyId and switch to success company for plan assignment
    const originalCompanyId = context.companyId;
    (context as any).companyId = successCompanyId;

    // Only assign billing plan to success company
    const { planId } = await createFixedPlanAssignment(context, serviceId, {
      planName: 'Basic Plan',
      billingFrequency: 'monthly',
      baseRateCents: 10000,
      startDate: createTestDateISO({ year: 2023, month: 1, day: 1 })
    });

    // Restore original companyId
    (context as any).companyId = originalCompanyId;

    // First successful generation
    const invoice1 = await generateInvoice(successCycle1);
    if (!invoice1) {
      throw new Error('Failed to generate first invoice');
    }
    expect(invoice1.invoice_number).toBe('INV-000001');

    // Verify invoice items were created
    const invoice1Items = await context.db('invoice_items')
      .where({ invoice_id: invoice1.invoice_id });
    expect(invoice1Items.length).toBeGreaterThan(0);

    // Failed generation attempt (no billing plan for this company)
    await expectError(
      () => generateInvoice(failCycle),
      {
        messagePattern: new RegExp(`No active billing plans found for company ${failCompanyId}`)
      }
    );

    // Second successful generation - should be next in sequence
    const invoice2 = await generateInvoice(successCycle2);
    if (!invoice2) {
      throw new Error('Failed to generate second invoice');
    }
    expect(invoice2.invoice_number).toBe('INV-000002');

    // Verify invoice items were created
    const invoice2Items = await context.db('invoice_items')
      .where({ invoice_id: invoice2.invoice_id });
    expect(invoice2Items.length).toBeGreaterThan(0);

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
      { prefix: 'VERY-LONG-PREFIX-', expected: 'VERY-LONG-PREFIX-000001', companyName: 'Long Prefix Co' },
      { prefix: 'INV/2024/', expected: 'INV/2024/000001', companyName: 'Slash Prefix Co' },
      { prefix: '#Special@_', expected: '#Special@_000001', companyName: 'Special Chars Co' },
      { prefix: '測試-', expected: '測試-000001', companyName: 'Unicode Co' },
      { prefix: '$$_##_', expected: '$$_##_000001', companyName: 'Multiple Special Co' }
    ];

    for (const testCase of prefixTests) {
      // Create a new company for each test case
      const companyId = await context.createEntity('companies', {
        company_name: testCase.companyName,
        billing_cycle: 'monthly'
      }, 'company_id');

      // Configure tax for the new company
      await setupCompanyTaxConfiguration(context, {
        regionCode: 'US-NY',
        companyId: companyId
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

      // Create a service and plan for generating invoice
      const serviceId = await createTestService(context, {
        service_name: 'Basic Service',
        billing_method: 'fixed',
        default_rate: 10000,
        tax_region: 'US-NY'
      });

      // Store current companyId and switch to test company for plan assignment
      const originalCompanyId = context.companyId;
      (context as any).companyId = companyId;

      await createFixedPlanAssignment(context, serviceId, {
        planName: 'Basic Plan',
        billingFrequency: 'monthly',
        baseRateCents: 10000,
        startDate: createTestDateISO({ year: 2023, month: 1, day: 1 })
      });

      // Restore original companyId
      (context as any).companyId = originalCompanyId;

      // Create billing cycle for this company
      const billingCycle = await context.createEntity('company_billing_cycles', {
        company_id: companyId,
        billing_cycle: 'monthly',
        effective_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        period_start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        period_end_date: createTestDateISO({ year: 2023, month: 2, day: 1 })
      }, 'billing_cycle_id');

      // Generate invoice and verify prefix handling
      const invoice = await generateInvoice(billingCycle);
      if (!invoice) {
        throw new Error(`Failed to generate invoice for prefix: ${testCase.prefix}`);
      }
      expect(invoice.invoice_number).toBe(testCase.expected);

      // Verify invoice items were created
      const invoiceItems = await context.db('invoice_items')
        .where({ invoice_id: invoice.invoice_id });
      expect(invoiceItems.length).toBeGreaterThan(0);
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

    // Create a service and plan for generating invoices
    const serviceId = await createTestService(context, {
      service_name: 'Basic Service',
      billing_method: 'fixed',
      default_rate: 10000,
      tax_region: 'US-NY'
    });

    await createFixedPlanAssignment(context, serviceId, {
      planName: 'Basic Plan',
      billingFrequency: 'monthly',
      baseRateCents: 10000,
      startDate: createTestDateISO({ year: 2023, month: 1, day: 1 })
    });

    // Create billing cycles for consecutive months
    const billingCycle1 = await context.createEntity('company_billing_cycles', {
      company_id: context.companyId,
      billing_cycle: 'monthly',
      effective_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      period_start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      period_end_date: createTestDateISO({ year: 2023, month: 2, day: 1 })
    }, 'billing_cycle_id');

    const billingCycle2 = await context.createEntity('company_billing_cycles', {
      company_id: context.companyId,
      billing_cycle: 'monthly',
      effective_date: createTestDateISO({ year: 2023, month: 2, day: 1 }),
      period_start_date: createTestDateISO({ year: 2023, month: 2, day: 1 }),
      period_end_date: createTestDateISO({ year: 2023, month: 3, day: 1 })
    }, 'billing_cycle_id');

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

    // Verify invoice items were created for both invoices
    const invoice1Items = await context.db('invoice_items')
      .where({ invoice_id: invoice1.invoice_id });
    expect(invoice1Items.length).toBeGreaterThan(0);

    const invoice2Items = await context.db('invoice_items')
      .where({ invoice_id: invoice2.invoice_id });
    expect(invoice2Items.length).toBeGreaterThan(0);
  });
});