import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import '../../../test-utils/nextApiMock';
import { finalizeInvoice } from 'server/src/lib/actions/invoiceModification';
import { generateInvoice } from 'server/src/lib/actions/invoiceGeneration';
import { createDefaultTaxSettings } from 'server/src/lib/actions/taxSettingsActions';
import { v4 as uuidv4 } from 'uuid';
import { TextEncoder } from 'util';
import { TestContext } from '../../../test-utils/testContext';
import { dateHelpers, createTestDate, createTestDateISO } from '../../../test-utils/dateUtils';
import { expectError, expectNotFound } from '../../../test-utils/errorUtils';

// Required for tests
global.TextEncoder = TextEncoder;

describe('Billing Invoice Generation – Invoice Number Generation (Part 2)', () => {
  const testHelpers = TestContext.createHelpers();
  let context: TestContext;

  beforeAll(async () => {
    context = await testHelpers.beforeAll({
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
        'plan_services',
        'service_catalog',
        'billing_plans',
        'bucket_plans',
        'tax_rates',
        'company_tax_settings',
        'next_number'
      ],
      companyName: 'Test Company',
      userType: 'internal'
    });

    console.log('Created tenant:', context.tenantId);
  });

  beforeEach(async () => {
    await testHelpers.beforeEach();
    
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

    // Create default tax rate
    await context.createEntity('tax_rates', {
      tax_type: 'VAT',
      country_code: 'US',
      tax_percentage: 10,
      region: null,
      is_reverse_charge_applicable: false,
      is_composite: false,
      start_date: dateHelpers.createDateISO({ year: 2023, month: 1, day: 1 }),
      is_active: true,
      description: 'Test Tax Rate'
    }, 'tax_rate_id');

    // Create default tax settings for the test company
    await createDefaultTaxSettings(context.company.company_id);

    // Re-create tax rate
    await context.createEntity('tax_rates', {
      tax_type: 'VAT',
      country_code: 'US',
      tax_percentage: 10,
      region: null,
      is_reverse_charge_applicable: false,
      is_composite: false,
      start_date: dateHelpers.createDateISO({ year: 2023, month: 1, day: 1 }),
      is_active: true,
      description: 'Test Tax Rate'
    }, 'tax_rate_id');
  });

  afterAll(async () => {
    await testHelpers.afterAll();
  });

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

    // Create a billing plan for generating invoice
    const planId = await context.createEntity('billing_plans', {
      plan_name: 'Basic Plan',
      billing_frequency: 'monthly',
      is_custom: false,
      plan_type: 'Fixed'
    }, 'plan_id');

    const serviceId = await context.createEntity('service_catalog', {
      service_name: 'Basic Service',
      description: 'Test service',
      service_type: 'Fixed',
      default_rate: 10000,
      unit_of_measure: 'unit'
    }, 'service_id');

    await context.db('plan_services').insert({
      plan_id: planId,
      service_id: serviceId,
      quantity: 1,
      tenant: context.tenantId
    });

    // Create billing cycles for two consecutive months
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

    // Assign plan to company for both periods
    await context.db('company_billing_plans').insert([
      {
        company_billing_plan_id: uuidv4(),
        company_id: context.companyId,
        plan_id: planId,
        start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        is_active: true,
        tenant: context.tenantId
      },
      {
        company_billing_plan_id: uuidv4(),
        company_id: context.companyId,
        plan_id: planId,
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

    // Create a billing plan for generating invoice
    const planId = await context.createEntity('billing_plans', {
      plan_name: 'Basic Plan',
      billing_frequency: 'monthly',
      is_custom: false,
      plan_type: 'Fixed'
    }, 'plan_id');

    const serviceId = await context.createEntity('service_catalog', {
      service_name: 'Basic Service',
      description: 'Test service',
      service_type: 'Fixed',
      default_rate: 10000,
      unit_of_measure: 'unit'
    }, 'service_id');

    await context.db('plan_services').insert({
      plan_id: planId,
      service_id: serviceId,
      quantity: 1,
      tenant: context.tenantId
    });

    // Create billing cycle and assign plan
    const billingCycle = await context.createEntity('company_billing_cycles', {
      company_id: context.companyId,
      billing_cycle: 'monthly',
      effective_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      period_start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      period_end_date: createTestDateISO({ year: 2023, month: 2, day: 1 })
    }, 'billing_cycle_id');

    await context.db('company_billing_plans').insert({
      company_billing_plan_id: uuidv4(),
      company_id: context.companyId,
      plan_id: planId,
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

    // Create a billing plan for generating invoices
    const planId = await context.createEntity('billing_plans', {
      plan_name: 'Basic Plan',
      billing_frequency: 'monthly',
      is_custom: false,
      plan_type: 'Fixed'
    }, 'plan_id');

    const serviceId = await context.createEntity('service_catalog', {
      service_name: 'Basic Service',
      description: 'Test service',
      service_type: 'Fixed',
      default_rate: 10000,
      unit_of_measure: 'unit'
    }, 'service_id');

    await context.db('plan_services').insert({
      plan_id: planId,
      service_id: serviceId,
      quantity: 1,
      tenant: context.tenantId
    });

    // Create billing cycles for three consecutive months
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

    const billingCycle3 = await context.createEntity('company_billing_cycles', {
      company_id: context.companyId,
      billing_cycle: 'monthly',
      effective_date: createTestDateISO({ year: 2023, month: 3, day: 1 }),
      period_start_date: createTestDateISO({ year: 2023, month: 3, day: 1 }),
      period_end_date: createTestDateISO({ year: 2023, month: 4, day: 1 })
    }, 'billing_cycle_id');

    // Assign plan to company for all periods
    await context.db('company_billing_plans').insert([
      {
        company_billing_plan_id: uuidv4(),
        company_id: context.companyId,
        plan_id: planId,
        start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        is_active: true,
        tenant: context.tenantId
      },
      {
        company_billing_plan_id: uuidv4(),
        company_id: context.companyId,
        plan_id: planId,
        start_date: createTestDateISO({ year: 2023, month: 2, day: 1 }),
        is_active: true,
        tenant: context.tenantId
      },
      {
        company_billing_plan_id: uuidv4(),
        company_id: context.companyId,
        plan_id: planId,
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

    // Create a billing plan for generating invoices
    const planId = await context.createEntity('billing_plans', {
      plan_name: 'Basic Plan',
      billing_frequency: 'monthly',
      is_custom: false,
      plan_type: 'Fixed'
    }, 'plan_id');

    const serviceId = await context.createEntity('service_catalog', {
      service_name: 'Basic Service',
      description: 'Test service',
      service_type: 'Fixed',
      default_rate: 10000,
      unit_of_measure: 'unit'
    }, 'service_id');

    await context.db('plan_services').insert({
      plan_id: planId,
      service_id: serviceId,
      quantity: 1,
      tenant: context.tenantId
    });

    // Create multiple billing cycles to generate multiple invoices
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

    const billingCycle3 = await context.createEntity('company_billing_cycles', {
      company_id: context.companyId,
      billing_cycle: 'monthly',
      effective_date: createTestDateISO({ year: 2023, month: 3, day: 1 }),
      period_start_date: createTestDateISO({ year: 2023, month: 3, day: 1 }),
      period_end_date: createTestDateISO({ year: 2023, month: 4, day: 1 })
    }, 'billing_cycle_id');

    // Assign plan to company for all periods
    await context.db('company_billing_plans').insert([
      {
        company_billing_plan_id: uuidv4(),
        company_id: context.companyId,
        plan_id: planId,
        start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        is_active: true,
        tenant: context.tenantId
      },
      {
        company_billing_plan_id: uuidv4(),
        company_id: context.companyId,
        plan_id: planId,
        start_date: createTestDateISO({ year: 2023, month: 2, day: 1 }),
        is_active: true,
        tenant: context.tenantId
      },
      {
        company_billing_plan_id: uuidv4(),
        company_id: context.companyId,
        plan_id: planId,
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

    // Create a billing plan for generating invoice
    const planId = await context.createEntity('billing_plans', {
      plan_name: 'Basic Plan',
      billing_frequency: 'monthly',
      is_custom: false,
      plan_type: 'Fixed'
    }, 'plan_id');

    const serviceId = await context.createEntity('service_catalog', {
      service_name: 'Basic Service',
      description: 'Test service',
      service_type: 'Fixed',
      default_rate: 10000,
      unit_of_measure: 'unit'
    }, 'service_id');

    await context.db('plan_services').insert({
      plan_id: planId,
      service_id: serviceId,
      quantity: 1,
      tenant: context.tenantId
    });

    // Create billing cycle and assign plan
    const billingCycle = await context.createEntity('company_billing_cycles', {
      company_id: context.companyId,
      billing_cycle: 'monthly',
      effective_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      period_start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      period_end_date: createTestDateISO({ year: 2023, month: 2, day: 1 })
    }, 'billing_cycle_id');

    await context.db('company_billing_plans').insert({
      company_billing_plan_id: uuidv4(),
      company_id: context.companyId,
      plan_id: planId,
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

    // Create a billing plan for generating invoice
    const planId = await context.createEntity('billing_plans', {
      plan_name: 'Basic Plan',
      billing_frequency: 'monthly',
      is_custom: false,
      plan_type: 'Fixed'
    }, 'plan_id');

    const serviceId = await context.createEntity('service_catalog', {
      service_name: 'Basic Service',
      description: 'Test service',
      service_type: 'Fixed',
      default_rate: 10000,
      unit_of_measure: 'unit'
    }, 'service_id');

    await context.db('plan_services').insert({
      plan_id: planId,
      service_id: serviceId,
      quantity: 1,
      tenant: context.tenantId
    });

    // Create billing cycle and assign plan
    const billingCycle = await context.createEntity('company_billing_cycles', {
      company_id: context.companyId,
      billing_cycle: 'monthly',
      effective_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      period_start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      period_end_date: createTestDateISO({ year: 2023, month: 2, day: 1 })
    }, 'billing_cycle_id');

    await context.db('company_billing_plans').insert({
      company_billing_plan_id: uuidv4(),
      company_id: context.companyId,
      plan_id: planId,
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

    // Create a billing plan for generating invoice
    const planId = await context.createEntity('billing_plans', {
      plan_name: 'Basic Plan',
      billing_frequency: 'monthly',
      is_custom: false,
      plan_type: 'Fixed'
    }, 'plan_id');

    const serviceId = await context.createEntity('service_catalog', {
      service_name: 'Basic Service',
      description: 'Test service',
      service_type: 'Fixed',
      default_rate: 10000,
      unit_of_measure: 'unit'
    }, 'service_id');

    await context.db('plan_services').insert({
      plan_id: planId,
      service_id: serviceId,
      quantity: 1,
      tenant: context.tenantId
    });

    // Create billing cycle and assign plan
    const billingCycle = await context.createEntity('company_billing_cycles', {
      company_id: context.companyId,
      billing_cycle: 'monthly',
      effective_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      period_start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      period_end_date: createTestDateISO({ year: 2023, month: 2, day: 1 })
    }, 'billing_cycle_id');

    await context.db('company_billing_plans').insert({
      company_billing_plan_id: uuidv4(),
      company_id: context.companyId,
      plan_id: planId,
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

    // Create a billing plan for generating invoice
    const planId = await context.createEntity('billing_plans', {
      plan_name: 'Basic Plan',
      billing_frequency: 'monthly',
      is_custom: false,
      plan_type: 'Fixed'
    }, 'plan_id');

    const serviceId = await context.createEntity('service_catalog', {
      service_name: 'Basic Service',
      description: 'Test service',
      service_type: 'Fixed',
      default_rate: 10000,
      unit_of_measure: 'unit'
    }, 'service_id');

    await context.db('plan_services').insert({
      plan_id: planId,
      service_id: serviceId,
      quantity: 1,
      tenant: context.tenantId
    });

    // Create billing cycle and assign plan
    const billingCycle1 = await context.createEntity('company_billing_cycles', {
      company_id: context.companyId,
      billing_cycle: 'monthly',
      effective_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      period_start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      period_end_date: createTestDateISO({ year: 2023, month: 2, day: 1 })
    }, 'billing_cycle_id');

    await context.db('company_billing_plans').insert({
      company_billing_plan_id: uuidv4(),
      company_id: context.companyId,
      plan_id: planId,
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

    // Create a second billing cycle
    const billingCycle2 = await context.createEntity('company_billing_cycles', {
        company_id: context.companyId,
        billing_cycle: 'monthly',
        effective_date: createTestDateISO({ year: 2023, month: 2, day: 1 }),
        period_start_date: createTestDateISO({ year: 2023, month: 2, day: 1 }),
        period_end_date: createTestDateISO({ year: 2023, month: 3, day: 1 })
      }, 'billing_cycle_id');
  
      await context.db('company_billing_plans').insert({
        company_billing_plan_id: uuidv4(),
        company_id: context.companyId,
        plan_id: planId,
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

    // Create a billing plan for generating invoice
    const planId = await context.createEntity('billing_plans', {
      plan_name: 'Basic Plan',
      billing_frequency: 'monthly',
      is_custom: false,
      plan_type: 'Fixed'
    }, 'plan_id');

    const serviceId = await context.createEntity('service_catalog', {
      service_name: 'Basic Service',
      description: 'Test service',
      service_type: 'Fixed',
      default_rate: 10000,
      unit_of_measure: 'unit'
    }, 'service_id');

    await context.db('plan_services').insert({
      plan_id: planId,
      service_id: serviceId,
      quantity: 1,
      tenant: context.tenantId
    });

    // Create billing cycle and assign plan
    const billingCycle1 = await context.createEntity('company_billing_cycles', {
      company_id: context.companyId,
      billing_cycle: 'monthly',
      effective_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      period_start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      period_end_date: createTestDateISO({ year: 2023, month: 2, day: 1 })
    }, 'billing_cycle_id');

    await context.db('company_billing_plans').insert({
      company_billing_plan_id: uuidv4(),
      company_id: context.companyId,
      plan_id: planId,
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

      // Create a second billing cycle
      const billingCycle2 = await context.createEntity('company_billing_cycles', {
        company_id: context.companyId,
        billing_cycle: 'monthly',
        effective_date: createTestDateISO({ year: 2023, month: 2, day: 1 }),
        period_start_date: createTestDateISO({ year: 2023, month: 2, day: 1 }),
        period_end_date: createTestDateISO({ year: 2023, month: 3, day: 1 })
      }, 'billing_cycle_id');
  
      await context.db('company_billing_plans').insert({
        company_billing_plan_id: uuidv4(),
        company_id: context.companyId,
        plan_id: planId,
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

    // Create a third billing cycle
    const billingCycle3 = await context.createEntity('company_billing_cycles', {
      company_id: context.companyId,
      billing_cycle: 'monthly',
      effective_date: createTestDateISO({ year: 2023, month: 3, day: 1 }),
      period_start_date: createTestDateISO({ year: 2023, month: 3, day: 1 }),
      period_end_date: createTestDateISO({ year: 2023, month: 4, day: 1 })
    }, 'billing_cycle_id');

    await context.db('company_billing_plans').insert({
      company_billing_plan_id: uuidv4(),
      company_id: context.companyId,
      plan_id: planId,
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