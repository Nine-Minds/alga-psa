import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import '../../../test-utils/nextApiMock';
import { finalizeInvoice, generateInvoice } from 'server/src/lib/actions/invoiceActions';
import { createDefaultTaxSettings } from 'server/src/lib/actions/taxSettingsActions';
import { v4 as uuidv4 } from 'uuid';
import { TextEncoder } from 'util';
import { TestContext } from '../../../test-utils/testContext';
import { dateHelpers, createTestDate, createTestDateISO } from '../../../test-utils/dateUtils';
import { expectError, expectNotFound } from '../../../test-utils/errorUtils';

// Required for tests
global.TextEncoder = TextEncoder;

describe('Billing Invoice Generation – Error Handling', () => {
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

  it('should handle invalid billing period dates', async () => {
    await expectNotFound(
      () => generateInvoice('123e4567-e89b-12d3-a456-426614174000'),
      'Billing cycle'
    );
  });

  it('should handle missing billing plans', async () => {
    // Create company without plans
    const newCompanyId = await context.createEntity('companies', {
      company_name: 'Company Without Plans',
      billing_cycle: 'monthly'
    }, 'company_id');

    // Create default tax settings
    await createDefaultTaxSettings(newCompanyId);

    // Create billing cycle
    const billingCycleId = await context.createEntity('company_billing_cycles', {
      company_id: newCompanyId,
      billing_cycle: 'monthly',
      effective_date: createTestDateISO({ year: 2023, month: 1, day: 1 })
    }, 'billing_cycle_id');

    await expectError(
      () => generateInvoice(billingCycleId),
      {
        messagePattern: new RegExp(`No active billing plans found for company ${newCompanyId} in the given period`)
      }
    );
  });

  it('should handle undefined service rates', async () => {
    // Arrange
    const planId = await context.createEntity('billing_plans', {
      plan_name: 'Invalid Plan',
      billing_frequency: 'monthly',
      is_custom: false,
      plan_type: 'Fixed'
    }, 'plan_id');

    const serviceId = await context.createEntity('service_catalog', {
      service_name: 'Service Without Rate',
      description: 'Test service: Service Without Rate',
      service_type: 'Fixed',
      unit_of_measure: 'unit'
      // default_rate intentionally undefined
    }, 'service_id');

    await context.db('plan_services').insert({
      plan_id: planId,
      service_id: serviceId,
      tenant: context.tenantId
    });

    // Create billing cycle and assign plan
    const billingCycleId = await context.createEntity('company_billing_cycles', {
      company_id: context.companyId,
      billing_cycle: 'monthly',
      effective_date: createTestDateISO({ year: 2023, month: 1, day: 1 })
    }, 'billing_cycle_id');

    await context.db('company_billing_plans').insert({
      company_billing_plan_id: uuidv4(),
      company_id: context.companyId,
      plan_id: planId,
      start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      is_active: true,
      tenant: context.tenantId
    });

    await expectError(() => generateInvoice(billingCycleId));
  });

  it('should throw error when regenerating for same period', async () => {
    // Arrange
    const planId = await context.createEntity('billing_plans', {
      plan_name: 'Standard Fixed Plan',
      billing_frequency: 'monthly',
      is_custom: false,
      plan_type: 'Fixed'
    }, 'plan_id');

    const serviceId = await context.createEntity('service_catalog', {
      service_name: 'Monthly Service',
      description: 'Test service: Monthly Service',
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
    const billingCycleId = await context.createEntity('company_billing_cycles', {
      company_id: context.companyId,
      billing_cycle: 'monthly',
      effective_date: createTestDateISO({ year: 2023, month: 1, day: 1 })
    }, 'billing_cycle_id');

    await context.db('company_billing_plans').insert({
      company_billing_plan_id: uuidv4(),
      company_id: context.companyId,
      plan_id: planId,
      start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      is_active: true,
      tenant: context.tenantId
    });

    // Generate first invoice
    const firstInvoice = await generateInvoice(billingCycleId);

    // Assert first invoice is correct
    expect(firstInvoice).toMatchObject({
      subtotal: 10000,
      status: 'draft'
    });

    // Attempt to generate second invoice for same period
    await expectError(
      () => generateInvoice(billingCycleId),
      {
        message: 'No active billing plans for this period'
      }
    );
  });
});