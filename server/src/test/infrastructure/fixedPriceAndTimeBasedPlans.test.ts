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

describe('Billing Invoice Generation – Fixed Price and Time-Based Plans', () => {
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

  describe('Fixed Price Plans', () => {
    it('should generate an invoice with line items for each service', async () => {
      // Arrange
      const planId = await context.createEntity('billing_plans', {
        plan_name: 'Standard Fixed Plan',
        billing_frequency: 'monthly',
        is_custom: false,
        plan_type: 'Fixed'
      }, 'plan_id');

      const service1Id = await context.createEntity('service_catalog', {
        service_name: 'Service 1',
        description: 'Test service: Service 1',
        service_type: 'Fixed',
        default_rate: 10000,
        unit_of_measure: 'unit'
      }, 'service_id');

      const service2Id = await context.createEntity('service_catalog', {
        service_name: 'Service 2',
        description: 'Test service: Service 2',
        service_type: 'Fixed',
        default_rate: 15000,
        unit_of_measure: 'unit'
      }, 'service_id');

      await context.db('plan_services').insert([
        { plan_id: planId, service_id: service1Id, quantity: 1, tenant: context.tenantId },
        { plan_id: planId, service_id: service2Id, quantity: 1, tenant: context.tenantId }
      ]);

      // Create billing cycle and assign plan
      const billingCycleId = await context.createEntity('company_billing_cycles', {
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

      // Act
      const result = await generateInvoice(billingCycleId);

      // Assert
      expect(result).toMatchObject({
        company: { name: 'Test Company' },
        subtotal: 25000,
        status: 'draft'
      });

      const invoiceItems = await context.db('invoice_items')
        .where('invoice_id', result.invoice_id)
        .select('*');

      expect(invoiceItems).toHaveLength(2);
      expect(invoiceItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            description: 'Service 1',
            quantity: '1',
            unit_price: '10000',
            net_amount: '10000'
          }),
          expect.objectContaining({
            description: 'Service 2',
            quantity: '1',
            unit_price: '15000',
            net_amount: '15000'
          })
        ])
      );
    });

    it('should calculate taxes correctly', async () => {
      // Arrange
      const planId = await context.createEntity('billing_plans', {
        plan_name: 'Taxable Plan',
        billing_frequency: 'monthly',
        is_custom: false,
        plan_type: 'Fixed'
      }, 'plan_id');

      const serviceId = await context.createEntity('service_catalog', {
        service_name: 'Taxable Service',
        description: 'Test service: Taxable Service',
        service_type: 'Fixed',
        default_rate: 50000,
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

      // Act
      const result = await generateInvoice(billingCycleId);

      // Assert
      expect(result).toMatchObject({
        subtotal: 50000,
        tax: 5000,
        total: 55000,
        status: 'draft'
      });
    });
  });

  describe('Time-Based Plans', () => {
    it('should generate an invoice based on time entries', async () => {
      // Arrange
      const planId = await context.createEntity('billing_plans', {
        plan_name: 'Hourly Plan',
        billing_frequency: 'monthly',
        is_custom: false,
        plan_type: 'Hourly'
      }, 'plan_id');

      const serviceId = await context.createEntity('service_catalog', {
        service_name: 'Hourly Consultation',
        description: 'Test service: Hourly Consultation',
        service_type: 'Time',
        default_rate: 10000,
        unit_of_measure: 'hour'
      }, 'service_id');

      await context.db('plan_services').insert({
        plan_id: planId,
        service_id: serviceId,
        custom_rate: 5000,
        quantity: 1,
        tenant: context.tenantId
      });

      // Create billing cycle and assign plan
      const billingCycleId = await context.createEntity('company_billing_cycles', {
        company_id: context.companyId,
        billing_cycle: 'monthly',
        effective_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        period_start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        period_end_date: createTestDateISO({ year: 2023, month: 1, day: 31 })
      }, 'billing_cycle_id');

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

      // Assert
      expect(result).toMatchObject({
        subtotal: 10000,
        status: 'draft'
      });

      const invoiceItems = await context.db('invoice_items')
        .where('invoice_id', result.invoice_id)
        .select('*');

      expect(invoiceItems).toHaveLength(1);
      expect(invoiceItems[0]).toMatchObject({
        description: 'Hourly Consultation',
        quantity: '2',
        unit_price: '5000',
        net_amount: '10000'
      });
    });
  });
});