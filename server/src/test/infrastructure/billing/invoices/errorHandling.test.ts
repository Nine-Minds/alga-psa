import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { finalizeInvoice } from 'server/src/lib/actions/invoiceModification';
import { generateInvoice } from 'server/src/lib/actions/invoiceGeneration';
import { createDefaultTaxSettings } from 'server/src/lib/actions/taxSettingsActions';
import { v4 as uuidv4 } from 'uuid';
import { TextEncoder } from 'util';
import { TestContext } from '../../../../../test-utils/testContext';
import { dateHelpers, createTestDate, createTestDateISO } from '../../../../../test-utils/dateUtils';
import { expectError, expectNotFound } from '../../../../../test-utils/errorUtils';

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
        'client_billing_cycles',
        'client_contract_lines',
        'contract_line_services',
        'service_catalog',
        'contract_lines',
        'bucket_contract_lines',
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

  it('should handle invalid billing period dates', async () => {
    await expectNotFound(
      () => generateInvoice('123e4567-e89b-12d3-a456-426614174000'),
      'Billing cycle'
    );
  });

  it('should handle missing contract lines', async () => {
    // Create client without contract lines
    const newClientId = await context.createEntity('clients', {
      client_name: 'Client Without Contract Lines',
      billing_cycle: 'monthly'
    }, 'client_id');

    // Create default tax settings
    await createDefaultTaxSettings(newClientId);

    // Create billing cycle
    const billingCycleId = await context.createEntity('client_billing_cycles', {
      client_id: newClientId,
      billing_cycle: 'monthly',
      effective_date: createTestDateISO({ year: 2023, month: 1, day: 1 })
    }, 'billing_cycle_id');

    await expectError(
      () => generateInvoice(billingCycleId),
      {
        messagePattern: new RegExp(`No active contract lines found for client ${newClientId} in the given period`)
      }
    );
  });

  it('should handle undefined service rates', async () => {
    // Arrange
    const contractLineId = await context.createEntity('contract_lines', {
      contract_line_name: 'Invalid Contract Line',
      billing_frequency: 'monthly',
      is_custom: false,
      contract_line_type: 'Fixed'
    }, 'contract_line_id');

    const serviceId = await context.createEntity('service_catalog', {
      service_name: 'Service Without Rate',
      description: 'Test service: Service Without Rate',
      service_type: 'Fixed',
      unit_of_measure: 'unit'
      // default_rate intentionally undefined
    }, 'service_id');

    await context.db('contract_line_services').insert({
      contract_line_id: contractLineId,
      service_id: serviceId,
      tenant: context.tenantId
    });

    // Create billing cycle and assign contract line
    const billingCycleId = await context.createEntity('client_billing_cycles', {
      client_id: context.clientId,
      billing_cycle: 'monthly',
      effective_date: createTestDateISO({ year: 2023, month: 1, day: 1 })
    }, 'billing_cycle_id');

    await context.db('client_contract_lines').insert({
      client_contract_line_id: uuidv4(),
      client_id: context.clientId,
      contract_line_id: contractLineId,
      start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      is_active: true,
      tenant: context.tenantId
    });

    await expectError(() => generateInvoice(billingCycleId));
  });

  it('should throw error when regenerating for same period', async () => {
    // Arrange
    const contractLineId = await context.createEntity('contract_lines', {
      contract_line_name: 'Standard Fixed Contract Line',
      billing_frequency: 'monthly',
      is_custom: false,
      contract_line_type: 'Fixed'
    }, 'contract_line_id');

    const serviceId = await context.createEntity('service_catalog', {
      service_name: 'Monthly Service',
      description: 'Test service: Monthly Service',
      service_type: 'Fixed',
      default_rate: 10000,
      unit_of_measure: 'unit'
    }, 'service_id');

    await context.db('contract_line_services').insert({
      contract_line_id: contractLineId,
      service_id: serviceId,
      quantity: 1,
      tenant: context.tenantId
    });

    // Create billing cycle and assign contract line
    const billingCycleId = await context.createEntity('client_billing_cycles', {
      client_id: context.clientId,
      billing_cycle: 'monthly',
      effective_date: createTestDateISO({ year: 2023, month: 1, day: 1 })
    }, 'billing_cycle_id');

    await context.db('client_contract_lines').insert({
      client_contract_line_id: uuidv4(),
      client_id: context.clientId,
      contract_line_id: contractLineId,
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
        message: 'No active contract lines for this period'
      }
    );
  });
});