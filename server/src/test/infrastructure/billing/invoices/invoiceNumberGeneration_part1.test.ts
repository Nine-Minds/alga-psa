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

describe('Billing Invoice Generation – Invoice Number Generation (Part 1)', () => {
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
        'client_billing_cycles',
        'client_billing_plans',
        'plan_services',
        'service_catalog',
        'billing_plans',
        'bucket_plans',
        'tax_rates',
        'client_tax_settings',
        'next_number'
      ],
      clientName: 'Test Client',
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

    // Create default tax settings for the test client
    await createDefaultTaxSettings(context.client.client_id);

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

    // Create a billing plan for successful generations
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

    // Create two clients - one for successful generations, one for failed attempt
    const successClientId = await context.createEntity('clients', {
      client_name: 'Success Client',
      billing_cycle: 'monthly'
    }, 'client_id');

    const failClientId = await context.createEntity('clients', {
      client_name: 'Fail Client',
      billing_cycle: 'monthly'
    }, 'client_id');

    // Create default tax settings for both clients
    await createDefaultTaxSettings(successClientId);
    await createDefaultTaxSettings(failClientId);

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

    // Only assign billing plan to success client
    await context.db('client_billing_plans').insert([
      {
        client_billing_plan_id: uuidv4(),
        client_id: successClientId,
        plan_id: planId,
        start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        is_active: true,
        tenant: context.tenantId
      },
      {
        client_billing_plan_id: uuidv4(),
        client_id: successClientId,
        plan_id: planId,
        start_date: createTestDateISO({ year: 2023, month: 2, day: 1 }),
        is_active: true,
        tenant: context.tenantId
      }
    ]);

    // First successful generation
    const invoice1 = await generateInvoice(successCycle1);
    if (!invoice1) {
      throw new Error('Failed to generate first invoice');
    }
    expect(invoice1.invoice_number).toBe('INV-000001');

    // Failed generation attempt (no billing plan for this client)
    await expectError(
      () => generateInvoice(failCycle),
      {
        messagePattern: new RegExp(`No active billing plans found for client ${failClientId}`)
      }
    );

    // Second successful generation - should be next in sequence
    const invoice2 = await generateInvoice(successCycle2);
    if (!invoice2) {
      throw new Error('Failed to generate second invoice');
    }
    expect(invoice2.invoice_number).toBe('INV-000002');

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

      // Create default tax settings for the new client
      await createDefaultTaxSettings(clientId);

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

      // Create billing cycle for this client
      const billingCycle = await context.createEntity('client_billing_cycles', {
        client_id: clientId,
        billing_cycle: 'monthly',
        effective_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        period_start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        period_end_date: createTestDateISO({ year: 2023, month: 2, day: 1 })
      }, 'billing_cycle_id');

      await context.db('client_billing_plans').insert({
        client_billing_plan_id: uuidv4(),
        client_id: clientId,
        plan_id: planId,
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

    // Assign plan to client for both periods
    await context.db('client_billing_plans').insert([
      {
        client_billing_plan_id: uuidv4(),
        client_id: context.clientId,
        plan_id: planId,
        start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        is_active: true,
        tenant: context.tenantId
      },
      {
        client_billing_plan_id: uuidv4(),
        client_id: context.clientId,
        plan_id: planId,
        start_date: createTestDateISO({ year: 2023, month: 2, day: 1 }),
        is_active: true,
        tenant: context.tenantId
      }
    ]);

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
  });
});