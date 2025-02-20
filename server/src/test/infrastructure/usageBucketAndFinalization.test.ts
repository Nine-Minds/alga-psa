import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import '../../../test-utils/nextApiMock';
import { finalizeInvoice, generateInvoice } from '@/lib/actions/invoiceActions';
import { createDefaultTaxSettings } from '@/lib/actions/taxSettingsActions';
import { v4 as uuidv4 } from 'uuid';
import { TextEncoder } from 'util';
import { TestContext } from '../../../test-utils/testContext';
import { dateHelpers, createTestDate, createTestDateISO } from '../../../test-utils/dateUtils';
import { expectError, expectNotFound } from '../../../test-utils/errorUtils';

// Required for tests
global.TextEncoder = TextEncoder;

describe('Billing Invoice Generation – Usage, Bucket Plans, and Finalization', () => {
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

  describe('Usage-Based Plans', () => {
    it('should generate an invoice based on usage records', async () => {
      // Arrange
      const planId = await context.createEntity('billing_plans', {
        plan_name: 'Usage Plan',
        billing_frequency: 'monthly',
        is_custom: false,
        plan_type: 'Usage'
      }, 'plan_id');

      const serviceId = await context.createEntity('service_catalog', {
        service_name: 'Data Transfer',
        description: 'Test service: Data Transfer',
        service_type: 'Usage',
        default_rate: '10',
        unit_of_measure: 'GB'
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

      // Create usage records
      await context.db('usage_tracking').insert([
        {
          tenant: context.tenantId,
          usage_id: uuidv4(),
          company_id: context.companyId,
          service_id: serviceId,
          usage_date: '2023-01-15',
          quantity: '50'
        },
        {
          tenant: context.tenantId,
          usage_id: uuidv4(),
          company_id: context.companyId,
          service_id: serviceId,
          usage_date: '2023-01-20',
          quantity: '30'
        }
      ]);

      // Act
      const result = await generateInvoice(billingCycleId);

      // Assert
      expect(result).toMatchObject({
        subtotal: 800,
        status: 'draft'
      });

      const invoiceItems = await context.db('invoice_items')
        .where('invoice_id', result.invoice_id)
        .select('*');

      expect(invoiceItems).toHaveLength(2);
      expect(invoiceItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            description: 'Data Transfer',
            quantity: '50',
            unit_price: '10',
            net_amount: '500'
          }),
          expect.objectContaining({
            description: 'Data Transfer',
            quantity: '30',
            unit_price: '10',
            net_amount: '300'
          })
        ])
      );
    });
  });

  describe('Bucket Plans', () => {
    it('should handle overage charges correctly', async () => {
      // Arrange
      const planId = await context.createEntity('billing_plans', {
        plan_name: 'Bucket Plan',
        billing_frequency: 'monthly',
        is_custom: false,
        plan_type: 'Bucket'
      }, 'plan_id');

      const serviceId = await context.createEntity('service_catalog', {
        service_name: 'Consulting Hours',
        description: 'Test service: Consulting Hours',
        service_type: 'Time',
        default_rate: 0,
        unit_of_measure: 'hour'
      }, 'service_id');

      const bucketPlanId = await context.createEntity('bucket_plans', {
        plan_id: planId,
        total_hours: 40,
        billing_period: 'Monthly',
        overage_rate: 7500,
        tenant: context.tenantId
      }, 'bucket_plan_id');

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

      // Create bucket usage
      await context.db('bucket_usage').insert({
        usage_id: uuidv4(),
        bucket_plan_id: bucketPlanId,
        company_id: context.companyId,
        period_start: '2023-01-01',
        period_end: '2023-01-31',
        hours_used: 45,
        overage_hours: 5,
        service_catalog_id: serviceId,
        tenant: context.tenantId
      });

      // Act
      const result = await generateInvoice(billingCycleId);

      // Assert
      expect(result).toMatchObject({
        subtotal: 37500,
        status: 'draft'
      });

      const invoiceItems = await context.db('invoice_items')
        .where('invoice_id', result.invoice_id)
        .select('*');

      expect(invoiceItems).toHaveLength(1);
      expect(invoiceItems[0]).toMatchObject({
        description: expect.stringContaining('Consulting Hours (Overage)'),
        quantity: '5',
        unit_price: '7500',
        net_amount: '37500'
      });
    });
  });

  describe('Invoice Finalization', () => {
    it('should finalize an invoice correctly', async () => {
      // Arrange
      const planId = await context.createEntity('billing_plans', {
        plan_name: 'Simple Plan',
        billing_frequency: 'monthly',
        is_custom: false,
        plan_type: 'Fixed'
      }, 'plan_id');

      const serviceId = await context.createEntity('service_catalog', {
        service_name: 'Basic Service',
        description: 'Test service: Basic Service',
        service_type: 'Fixed',
        default_rate: 20000,
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

      // Generate draft invoice
      let invoice = await generateInvoice(billingCycleId);

      // Act
      await finalizeInvoice(invoice.invoice_id);

      // reload invoice
      invoice = await context.db('invoices')
        .where({ invoice_id: invoice.invoice_id })
        .first();

      // Assert
      expect(invoice).toMatchObject({
        invoice_id: invoice.invoice_id,
        status: 'sent',
        finalized_at: expect.any(Date)
      });
    });
  });
});