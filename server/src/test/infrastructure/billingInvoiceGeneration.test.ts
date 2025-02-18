import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { generateInvoice } from '@/lib/actions/invoiceActions';
import { v4 as uuidv4 } from 'uuid';
import { TextEncoder } from 'util';
import { TestContext } from '../../../test-utils/testContext';
import { setupCommonMocks, createMockUser } from '../../../test-utils/testMocks';
import { createTestDate, createTestDateISO, freezeTime, unfreezeTime } from '../../../test-utils/dateUtils';
import { expectError, expectNotFound } from '../../../test-utils/errorUtils';
import { ICompanyTaxSettings } from '@/interfaces/tax.interfaces';

global.TextEncoder = TextEncoder;

// Create test context helpers
const { beforeAll: setupContext, beforeEach: resetContext, afterAll: cleanupContext } = TestContext.createHelpers();

// Test context
let context: TestContext;

// Set up mocks and context
beforeAll(async () => {
  // Set up common mocks
  setupCommonMocks({
    user: createMockUser('admin')
  });

  // Initialize test context
  context = await setupContext({
    runSeeds: true,
    cleanupTables: [
      'company_billing_cycles',
      'company_billing_plans',
      'plan_services',
      'service_catalog',
      'billing_plans',
      'tax_rates',
      'company_tax_settings'
    ]
  });
});

beforeEach(async () => {
  await resetContext();
  
  // Set up default tax settings for the company
  const taxRateId = await context.createEntity('tax_rates', {
    tax_type: 'VAT',
    country_code: 'US',
    tax_percentage: 10,
    region: null,
    is_reverse_charge_applicable: false,
    is_composite: false,
    start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
    is_active: true,
    description: 'Test Tax Rate'
  });

  const companyTaxSettings: ICompanyTaxSettings = {
    company_id: context.companyId,
    tax_rate_id: taxRateId,
    is_reverse_charge_applicable: false,
    tenant: context.tenantId
  };

  await context.db('company_tax_settings').insert(companyTaxSettings);
});

afterAll(async () => {
  unfreezeTime();
  await cleanupContext();
});

describe('Billing Invoice Generation', () => {
  describe('Fixed Price Plans', () => {
    it('should generate an invoice with line items for each service', async () => {
      // Arrange
      const planId = await context.createEntity('billing_plans', {
        plan_name: 'Standard Fixed Plan',
        billing_frequency: 'monthly',
        is_custom: false,
        plan_type: 'Fixed'
      });

      const service1Id = await context.createEntity('service_catalog', {
        service_name: 'Service 1',
        description: 'Test service: Service 1',
        service_type: 'Fixed',
        default_rate: 10000,
        unit_of_measure: 'unit'
      });

      const service2Id = await context.createEntity('service_catalog', {
        service_name: 'Service 2',
        description: 'Test service: Service 2',
        service_type: 'Fixed',
        default_rate: 15000,
        unit_of_measure: 'unit'
      });

      await context.db('plan_services').insert([
        { plan_id: planId, service_id: service1Id, quantity: 1, tenant: context.tenantId },
        { plan_id: planId, service_id: service2Id, quantity: 1, tenant: context.tenantId }
      ]);

      // Create billing cycle and assign plan
      const billingCycleId = await context.createEntity('company_billing_cycles', {
        company_id: context.companyId,
        billing_cycle: 'monthly',
        effective_date: createTestDateISO({ year: 2023, month: 1, day: 1 })
      });

      await context.db('company_billing_plans').insert({
        company_billing_plan_id: uuidv4(),
        company_id: context.companyId,
        plan_id: planId,
        start_date: createTestDate({ year: 2023, month: 1, day: 1 }),
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
            quantity: 1,
            unit_price: 10000,
            net_amount: 10000
          }),
          expect.objectContaining({
            description: 'Service 2',
            quantity: 1,
            unit_price: 15000,
            net_amount: 15000
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
      });

      const serviceId = await context.createEntity('service_catalog', {
        service_name: 'Taxable Service',
        description: 'Test service: Taxable Service',
        service_type: 'Fixed',
        default_rate: 50000,
        unit_of_measure: 'unit'
      });

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
      });

      await context.db('company_billing_plans').insert({
        company_billing_plan_id: uuidv4(),
        company_id: context.companyId,
        plan_id: planId,
        start_date: createTestDate({ year: 2023, month: 1, day: 1 }),
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
      });

      const serviceId = await context.createEntity('service_catalog', {
        service_name: 'Hourly Consultation',
        description: 'Test service: Hourly Consultation',
        service_type: 'Hourly',
        default_rate: 10000,
        unit_of_measure: 'hour'
      });

      await context.db('plan_services').insert({
        plan_id: planId,
        service_id: serviceId,
        custom_rate: 5000,
        tenant: context.tenantId
      });

      // Create billing cycle and assign plan
      const billingCycleId = await context.createEntity('company_billing_cycles', {
        company_id: context.companyId,
        billing_cycle: 'monthly',
        effective_date: createTestDateISO({ year: 2023, month: 1, day: 1 })
      });

      await context.db('company_billing_plans').insert({
        company_billing_plan_id: uuidv4(),
        company_id: context.companyId,
        plan_id: planId,
        start_date: createTestDate({ year: 2023, month: 1, day: 1 }),
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
        updated_at: createTestDateISO()
      });

      // Create time entry
      await context.db('time_entries').insert({
        tenant: context.tenantId,
        entry_id: uuidv4(),
        user_id: context.userId,
        start_time: createTestDate({ year: 2023, month: 1, day: 15, hour: 10 }),
        end_time: createTestDate({ year: 2023, month: 1, day: 15, hour: 12 }),
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
        quantity: 2,
        unit_price: 5000,
        net_amount: 10000
      });
    });
  });

  describe('Usage-Based Plans', () => {
    it('should generate an invoice based on usage records', async () => {
      // Arrange
      const planId = await context.createEntity('billing_plans', {
        plan_name: 'Usage Plan',
        billing_frequency: 'monthly',
        is_custom: false,
        plan_type: 'Usage'
      });

      const serviceId = await context.createEntity('service_catalog', {
        service_name: 'Data Transfer',
        description: 'Test service: Data Transfer',
        service_type: 'Usage',
        default_rate: 10,
        unit_of_measure: 'GB'
      });

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
      });

      await context.db('company_billing_plans').insert({
        company_billing_plan_id: uuidv4(),
        company_id: context.companyId,
        plan_id: planId,
        start_date: createTestDate({ year: 2023, month: 1, day: 1 }),
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
          quantity: 50
        },
        {
          tenant: context.tenantId,
          usage_id: uuidv4(),
          company_id: context.companyId,
          service_id: serviceId,
          usage_date: '2023-01-20',
          quantity: 30
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
            quantity: 50,
            unit_price: 10,
            net_amount: 500
          }),
          expect.objectContaining({
            description: 'Data Transfer',
            quantity: 30,
            unit_price: 10,
            net_amount: 300
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
      });

      const serviceId = await context.createEntity('service_catalog', {
        service_name: 'Consulting Hours',
        description: 'Test service: Consulting Hours',
        service_type: 'Bucket',
        default_rate: 0,
        unit_of_measure: 'hour'
      });

      const bucketPlanId = await context.createEntity('bucket_plans', {
        plan_id: planId,
        total_hours: 40,
        billing_period: 'Monthly',
        overage_rate: 7500
      });

      // Create billing cycle and assign plan
      const billingCycleId = await context.createEntity('company_billing_cycles', {
        company_id: context.companyId,
        billing_cycle: 'monthly',
        effective_date: createTestDateISO({ year: 2023, month: 1, day: 1 })
      });

      await context.db('company_billing_plans').insert({
        company_billing_plan_id: uuidv4(),
        company_id: context.companyId,
        plan_id: planId,
        start_date: createTestDate({ year: 2023, month: 1, day: 1 }),
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
        quantity: 5,
        unit_price: 7500,
        net_amount: 37500
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
      });

      const serviceId = await context.createEntity('service_catalog', {
        service_name: 'Basic Service',
        description: 'Test service: Basic Service',
        service_type: 'Fixed',
        default_rate: 20000,
        unit_of_measure: 'unit'
      });

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
      });

      await context.db('company_billing_plans').insert({
        company_billing_plan_id: uuidv4(),
        company_id: context.companyId,
        plan_id: planId,
        start_date: createTestDate({ year: 2023, month: 1, day: 1 }),
        is_active: true,
        tenant: context.tenantId
      });

      // Generate draft invoice
      const invoice = await generateInvoice(billingCycleId);

      // Act
      const finalizedInvoice = await generateInvoice(invoice.invoice_id);

      // Assert
      expect(finalizedInvoice).toMatchObject({
        invoice_id: invoice.invoice_id,
        status: 'sent',
        finalized_at: expect.any(Date)
      });
    });
  });

  describe('Error Handling', () => {
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
      });

      // Create billing cycle
      const billingCycleId = await context.createEntity('company_billing_cycles', {
        company_id: newCompanyId,
        billing_cycle: 'monthly',
        effective_date: createTestDateISO({ year: 2023, month: 1, day: 1 })
      });

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
      });

      const serviceId = await context.createEntity('service_catalog', {
        service_name: 'Service Without Rate',
        description: 'Test service: Service Without Rate',
        service_type: 'Fixed',
        unit_of_measure: 'unit'
        // default_rate intentionally undefined
      });

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
      });

      await context.db('company_billing_plans').insert({
        company_billing_plan_id: uuidv4(),
        company_id: context.companyId,
        plan_id: planId,
        start_date: createTestDate({ year: 2023, month: 1, day: 1 }),
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
      });

      const serviceId = await context.createEntity('service_catalog', {
        service_name: 'Monthly Service',
        description: 'Test service: Monthly Service',
        service_type: 'Fixed',
        default_rate: 10000,
        unit_of_measure: 'unit'
      });

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
      });

      await context.db('company_billing_plans').insert({
        company_billing_plan_id: uuidv4(),
        company_id: context.companyId,
        plan_id: planId,
        start_date: createTestDate({ year: 2023, month: 1, day: 1 }),
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
});
