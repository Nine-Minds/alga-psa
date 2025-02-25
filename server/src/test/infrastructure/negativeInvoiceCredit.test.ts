import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import '../../../test-utils/nextApiMock';
import { TestContext } from '../../../test-utils/testContext';
import { createDefaultTaxSettings } from '@/lib/actions/taxSettingsActions';
import { finalizeInvoice, generateInvoice } from '@/lib/actions/invoiceActions';
import { v4 as uuidv4 } from 'uuid';
import type { ICompany } from '../../interfaces/company.interfaces';
import { Temporal } from '@js-temporal/polyfill';
import CompanyBillingPlan from '@/lib/models/clientBilling';
import { createTestDate } from '../../../test-utils/dateUtils';

// Setup TestContext
const testHelpers = TestContext.createHelpers();
let context: TestContext;

describe('Negative Invoice Credit Tests', () => {
  beforeAll(async () => {
    context = await testHelpers.beforeAll({
      runSeeds: true,
      cleanupTables: [
        'invoice_items',
        'invoices',
        'transactions',
        'company_billing_cycles',
        'company_billing_plans',
        'plan_services',
        'service_catalog',
        'billing_plans',
        'bucket_plans',
        'bucket_usage',
        'tax_rates',
        'company_tax_settings'
      ],
      companyName: 'Negative Credit Test Company',
      userType: 'internal'
    });

    // Create default tax settings
    await createDefaultTaxSettings(context.company.company_id);
  });

  beforeEach(async () => {
    await testHelpers.beforeEach();
  });

  afterAll(async () => {
    await testHelpers.afterAll();
  });

  describe('Basic Negative Invoice Credit Creation', () => {
    it('should create a credit when finalizing an invoice with negative total', async () => {
      // 1. Create a test company with zero initial credit balance
      const company_id = await context.createEntity<ICompany>('companies', {
        company_name: 'Basic Negative Invoice Company',
        billing_cycle: 'monthly',
        company_id: uuidv4(),
        tax_region: 'US-NY',
        is_tax_exempt: false,
        created_at: Temporal.Now.plainDateISO().toString(),
        updated_at: Temporal.Now.plainDateISO().toString(),
        phone_no: '',
        credit_balance: 0,
        email: '',
        url: '',
        address: '',
        is_inactive: false
      }, 'company_id');

      // 2. Create NY tax rate (10%)
      const nyTaxRateId = await context.createEntity('tax_rates', {
        region: 'US-NY',
        tax_percentage: 10.0,
        description: 'NY Test Tax',
        start_date: '2025-01-01'
      }, 'tax_rate_id');

      // 3. Set up company tax settings
      await context.db('company_tax_settings').insert({
        company_id: company_id,
        tenant: context.tenantId,
        tax_rate_id: nyTaxRateId,
        is_reverse_charge_applicable: false
      });

      // 4. Create two services with negative rates
      const serviceA = await context.createEntity('service_catalog', {
        service_name: 'Credit Service A',
        service_type: 'Fixed',
        default_rate: -5000, // -$50.00
        unit_of_measure: 'unit',
        tax_region: 'US-NY',
        is_taxable: true
      }, 'service_id');

      const serviceB = await context.createEntity('service_catalog', {
        service_name: 'Credit Service B',
        service_type: 'Fixed',
        default_rate: -7500, // -$75.00
        unit_of_measure: 'unit',
        tax_region: 'US-NY',
        is_taxable: true
      }, 'service_id');

      // 5. Create a billing plan
      const planId = await context.createEntity('billing_plans', {
        plan_name: 'Credit Plan',
        billing_frequency: 'monthly',
        is_custom: false,
        plan_type: 'Fixed'
      }, 'plan_id');

      // 6. Assign services to plan
      await context.db('plan_services').insert([
        {
          plan_id: planId,
          service_id: serviceA,
          quantity: 1,
          tenant: context.tenantId
        },
        {
          plan_id: planId,
          service_id: serviceB,
          quantity: 1,
          tenant: context.tenantId
        }
      ]);

      // 7. Create a billing cycle
      const now = createTestDate();
      const startDate = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();
      const endDate = Temporal.PlainDate.from(now).toString();

      const billingCycleId = await context.createEntity('company_billing_cycles', {
        company_id: company_id,
        billing_cycle: 'monthly',
        period_start_date: startDate,
        period_end_date: endDate,
        effective_date: startDate
      }, 'billing_cycle_id');

      // 8. Assign plan to company
      await context.db('company_billing_plans').insert({
        company_billing_plan_id: uuidv4(),
        company_id: company_id,
        plan_id: planId,
        tenant: context.tenantId,
        start_date: startDate,
        is_active: true
      });

      // 9. Check initial credit balance is zero
      const initialCredit = await CompanyBillingPlan.getCompanyCredit(company_id);
      expect(initialCredit).toBe(0);

      // 10. Generate invoice
      const invoice = await generateInvoice(billingCycleId);

      if (!invoice) {
        throw new Error('Failed to generate invoice');
      }

      // 11. Verify the invoice has a negative total
      expect(invoice.total_amount).toBeLessThan(0);
      expect(invoice.subtotal).toBe(-12500); // -$125.00
      expect(invoice.tax).toBe(0);           // $0.00 (no tax on negative amounts)
      expect(invoice.total_amount).toBe(-12500); // -$125.00

      // 12. Finalize the invoice
      await finalizeInvoice(invoice.invoice_id);

      // 13. Verify the company credit balance has increased
      const updatedCredit = await CompanyBillingPlan.getCompanyCredit(company_id);
      expect(updatedCredit).toBe(12500); // $125.00 credit

      // 14. Verify credit issuance transaction
      const creditTransaction = await context.db('transactions')
        .where({
          company_id: company_id,
          invoice_id: invoice.invoice_id,
          type: 'credit_issuance_from_negative_invoice'
        })
        .first();

      // 15. Verify transaction details
      expect(creditTransaction).toBeTruthy();
      expect(parseInt(creditTransaction.amount)).toBe(12500); // $125.00
      expect(creditTransaction.description).toContain('Credit issued from negative invoice');

      // 16. Verify invoice status
      const finalizedInvoice = await context.db('invoices')
        .where({ invoice_id: invoice.invoice_id })
        .first();

      expect(finalizedInvoice.status).toBe('sent');
      expect(finalizedInvoice.finalized_at).toBeTruthy();
    });
  });

  describe('Mixed Invoice with Net Negative Amount', () => {
    it('should create a credit when finalizing a mixed invoice with negative total', async () => {
      // 1. Create a test company with zero initial credit balance
      const company_id = await context.createEntity<ICompany>('companies', {
        company_name: 'Mixed Invoice Company',
        billing_cycle: 'monthly',
        company_id: uuidv4(),
        tax_region: 'US-NY',
        is_tax_exempt: false,
        created_at: Temporal.Now.plainDateISO().toString(),
        updated_at: Temporal.Now.plainDateISO().toString(),
        phone_no: '',
        credit_balance: 0,
        email: '',
        url: '',
        address: '',
        is_inactive: false
      }, 'company_id');

      // 2. Create NY tax rate (10%)
      const nyTaxRateId = await context.createEntity('tax_rates', {
        region: 'US-NY',
        tax_percentage: 10.0,
        description: 'NY Test Tax',
        start_date: '2025-01-01'
      }, 'tax_rate_id');

      // 3. Set up company tax settings
      await context.db('company_tax_settings').insert({
        company_id: company_id,
        tenant: context.tenantId,
        tax_rate_id: nyTaxRateId,
        is_reverse_charge_applicable: false
      });

      // 4. Create three services with both positive and negative rates
      const serviceA = await context.createEntity('service_catalog', {
        service_name: 'Regular Service A',
        service_type: 'Fixed',
        default_rate: 10000, // $100.00 (positive)
        unit_of_measure: 'unit',
        tax_region: 'US-NY',
        is_taxable: true
      }, 'service_id');

      const serviceB = await context.createEntity('service_catalog', {
        service_name: 'Credit Service B',
        service_type: 'Fixed',
        default_rate: -15000, // -$150.00 (negative)
        unit_of_measure: 'unit',
        tax_region: 'US-NY',
        is_taxable: true
      }, 'service_id');

      const serviceC = await context.createEntity('service_catalog', {
        service_name: 'Credit Service C',
        service_type: 'Fixed',
        default_rate: -7500, // -$75.00 (negative)
        unit_of_measure: 'unit',
        tax_region: 'US-NY',
        is_taxable: true
      }, 'service_id');

      // 5. Create a billing plan
      const planId = await context.createEntity('billing_plans', {
        plan_name: 'Mixed Credit Plan',
        billing_frequency: 'monthly',
        is_custom: false,
        plan_type: 'Fixed'
      }, 'plan_id');

      // 6. Assign services to plan
      await context.db('plan_services').insert([
        {
          plan_id: planId,
          service_id: serviceA,
          quantity: 1,
          tenant: context.tenantId
        },
        {
          plan_id: planId,
          service_id: serviceB,
          quantity: 1,
          tenant: context.tenantId
        },
        {
          plan_id: planId,
          service_id: serviceC,
          quantity: 1,
          tenant: context.tenantId
        }
      ]);

      // 7. Create a billing cycle
      const now = createTestDate();
      const startDate = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();
      const endDate = Temporal.PlainDate.from(now).toString();

      const billingCycleId = await context.createEntity('company_billing_cycles', {
        company_id: company_id,
        billing_cycle: 'monthly',
        period_start_date: startDate,
        period_end_date: endDate,
        effective_date: startDate
      }, 'billing_cycle_id');

      // 8. Assign plan to company
      await context.db('company_billing_plans').insert({
        company_billing_plan_id: uuidv4(),
        company_id: company_id,
        plan_id: planId,
        tenant: context.tenantId,
        start_date: startDate,
        is_active: true
      });

      // 9. Check initial credit balance is zero
      const initialCredit = await CompanyBillingPlan.getCompanyCredit(company_id);
      expect(initialCredit).toBe(0);

      // 10. Generate invoice
      const invoice = await generateInvoice(billingCycleId);

      if (!invoice) {
        throw new Error('Failed to generate invoice');
      }

      // 11. Verify the invoice calculations
      // Expected:
      // - Positive item: $100.00 with $10.00 tax (10%)
      // - Negative items: -$150.00 and -$75.00 with $0 tax
      // - Subtotal: -$125.00
      // - Tax: $10.00 (only on positive amount)
      // - Total: -$115.00 (-$125 + $10)
      expect(invoice.subtotal).toBe(-12500); // -$125.00
      expect(invoice.tax).toBe(1000);        // $10.00 (10% of $100)
      expect(invoice.total_amount).toBe(-11500); // -$115.00 (-$125 + $10)

      // Get invoice items to verify individual calculations
      const invoiceItems = await context.db('invoice_items')
        .where({ invoice_id: invoice.invoice_id })
        .orderBy('net_amount', 'desc');

      // Verify positive item has tax
      const positiveItem = invoiceItems.find(item => parseInt(item.net_amount) > 0);
      expect(positiveItem).toBeTruthy();
      expect(parseInt(positiveItem.tax_amount)).toBe(1000); // $10.00 tax

      // Verify negative items have no tax
      const negativeItems = invoiceItems.filter(item => parseInt(item.net_amount) < 0);
      expect(negativeItems.length).toBe(2);
      for (const item of negativeItems) {
        expect(parseInt(item.tax_amount)).toBe(0); // No tax on negative items
      }

      // 12. Finalize the invoice
      await finalizeInvoice(invoice.invoice_id);

      // 13. Verify the company credit balance has increased by the absolute value of the total
      const updatedCredit = await CompanyBillingPlan.getCompanyCredit(company_id);
      expect(updatedCredit).toBe(11500); // $115.00 credit (absolute value of -$115.00)

      // 14. Verify credit issuance transaction
      const creditTransaction = await context.db('transactions')
        .where({
          company_id: company_id,
          invoice_id: invoice.invoice_id,
          type: 'credit_issuance_from_negative_invoice'
        })
        .first();

      // 15. Verify transaction details
      expect(creditTransaction).toBeTruthy();
      expect(parseInt(creditTransaction.amount)).toBe(11500); // $115.00
      expect(creditTransaction.description).toContain('Credit issued from negative invoice');
    });
  });

  describe('Applying Credit from Negative Invoice to Future Invoice', () => {
    it('should automatically apply credit from a negative invoice to a future invoice', async () => {
      // 1. Create a test company with zero initial credit balance
      const company_id = await context.createEntity<ICompany>('companies', {
        company_name: 'Credit Application Company',
        billing_cycle: 'monthly',
        company_id: uuidv4(),
        tax_region: 'US-NY',
        is_tax_exempt: false,
        created_at: Temporal.Now.plainDateISO().toString(),
        updated_at: Temporal.Now.plainDateISO().toString(),
        phone_no: '',
        credit_balance: 0,
        email: '',
        url: '',
        address: '',
        is_inactive: false
      }, 'company_id');

      // 2. Create NY tax rate (10%)
      const nyTaxRateId = await context.createEntity('tax_rates', {
        region: 'US-NY',
        tax_percentage: 10.0,
        description: 'NY Test Tax',
        start_date: '2025-01-01'
      }, 'tax_rate_id');

      // 3. Set up company tax settings
      await context.db('company_tax_settings').insert({
        company_id: company_id,
        tenant: context.tenantId,
        tax_rate_id: nyTaxRateId,
        is_reverse_charge_applicable: false
      });

      // 4. Create negative services for first invoice
      const negativeServiceA = await context.createEntity('service_catalog', {
        service_name: 'Credit Service A',
        service_type: 'Fixed',
        default_rate: -5000, // -$50.00
        unit_of_measure: 'unit',
        tax_region: 'US-NY',
        is_taxable: true
      }, 'service_id');

      const negativeServiceB = await context.createEntity('service_catalog', {
        service_name: 'Credit Service B',
        service_type: 'Fixed',
        default_rate: -7500, // -$75.00
        unit_of_measure: 'unit',
        tax_region: 'US-NY',
        is_taxable: true
      }, 'service_id');

      // 5. Create a billing plan for negative services
      const planId1 = await context.createEntity('billing_plans', {
        plan_name: 'Credit Plan',
        billing_frequency: 'monthly',
        is_custom: false,
        plan_type: 'Fixed'
      }, 'plan_id');

      // 6. Assign negative services to plan
      await context.db('plan_services').insert([
        {
          plan_id: planId1,
          service_id: negativeServiceA,
          quantity: 1,
          tenant: context.tenantId
        },
        {
          plan_id: planId1,
          service_id: negativeServiceB,
          quantity: 1,
          tenant: context.tenantId
        }
      ]);

      // 7. Create first billing cycle
      const now = createTestDate();
      const startDate1 = Temporal.PlainDate.from(now).subtract({ months: 2 }).toString();
      const endDate1 = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();

      const billingCycleId1 = await context.createEntity('company_billing_cycles', {
        company_id: company_id,
        billing_cycle: 'monthly',
        period_start_date: startDate1,
        period_end_date: endDate1,
        effective_date: startDate1
      }, 'billing_cycle_id');

      // 8. Assign first plan to company
      const firstPlanId = uuidv4();
      await context.db('company_billing_plans').insert({
        company_billing_plan_id: firstPlanId,
        company_id: company_id,
        plan_id: planId1,
        tenant: context.tenantId,
        start_date: startDate1,
        is_active: true
      });

      // 9. Check initial credit balance is zero
      const initialCredit = await CompanyBillingPlan.getCompanyCredit(company_id);
      expect(initialCredit).toBe(0);

      // 10. Generate negative invoice
      const negativeInvoice = await generateInvoice(billingCycleId1);

      if (!negativeInvoice) {
        throw new Error('Failed to generate negative invoice');
      }

      // 11. Verify the negative invoice calculations
      expect(negativeInvoice.subtotal).toBe(-12500); // -$125.00
      expect(negativeInvoice.tax).toBe(0);           // $0.00 (no tax on negative amounts)
      expect(negativeInvoice.total_amount).toBe(-12500); // -$125.00

      // 12. Finalize the negative invoice
      await finalizeInvoice(negativeInvoice.invoice_id);

      // Add a small delay to ensure all operations complete
      // await new Promise(resolve => setTimeout(resolve, 100));

      // 13. Verify credit was created
      const creditAfterNegativeInvoice = await CompanyBillingPlan.getCompanyCredit(company_id);
      expect(creditAfterNegativeInvoice).toBe(12500); // $125.00 credit

      // Verify transaction record for the negative invoice credit
      const creditTransaction = await context.db('transactions')
        .where({ 
          company_id: company_id,
          type: 'credit_issuance_from_negative_invoice'
        })
        .orderBy('created_at', 'desc')
        .first();
      
      expect(creditTransaction).toBeTruthy();
      expect(parseInt(creditTransaction.amount)).toBe(12500);
      expect(parseInt(creditTransaction.balance_after)).toBe(12500);

      // Now create a positive invoice that will use the credit

      // 14. Create positive service for second invoice
      const positiveService = await context.createEntity('service_catalog', {
        service_name: 'Regular Service',
        service_type: 'Fixed',
        default_rate: 10000, // $100.00
        unit_of_measure: 'unit',
        tax_region: 'US-NY',
        is_taxable: true
      }, 'service_id');

      // 15. Create a billing plan for positive service
      const planId2 = await context.createEntity('billing_plans', {
        plan_name: 'Regular Plan',
        billing_frequency: 'monthly',
        is_custom: false,
        plan_type: 'Fixed'
      }, 'plan_id');

      // 16. Assign positive service to second plan
      await context.db('plan_services').insert({
        plan_id: planId2,
        service_id: positiveService,
        quantity: 1,
        tenant: context.tenantId
      });

      // 17. Create second billing cycle
      const startDate2 = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();
      const endDate2 = Temporal.PlainDate.from(now).toString();

      const billingCycleId2 = await context.createEntity('company_billing_cycles', {
        company_id: company_id,
        billing_cycle: 'monthly',
        period_start_date: startDate2,
        period_end_date: endDate2,
        effective_date: startDate2
      }, 'billing_cycle_id');

      // 18. Deactivate first plan and assign second plan to company
      await context.db('company_billing_plans')
        .where({ company_billing_plan_id: firstPlanId })
        .update({ is_active: false });
        
      await context.db('company_billing_plans').insert({
        company_billing_plan_id: uuidv4(),
        company_id: company_id,
        plan_id: planId2,
        tenant: context.tenantId,
        start_date: startDate2,
        is_active: true
      });

      // 19. Generate positive invoice
      const positiveInvoice = await generateInvoice(billingCycleId2);

      if (!positiveInvoice) {
        throw new Error('Failed to generate positive invoice');
      }

      // 20. Verify the positive invoice calculations
      expect(positiveInvoice.subtotal).toBe(10000); // $100.00
      expect(positiveInvoice.tax).toBe(1000);       // $10.00 (10% of $100)
      expect(positiveInvoice.total_amount).toBe(11000); // $110.00 ($100 + $10)

      // 21. Finalize the positive invoice to apply credit
      await finalizeInvoice(positiveInvoice.invoice_id);

      // 22. Verify the final state of the positive invoice
      const finalPositiveInvoice = await context.db('invoices')
        .where({ invoice_id: positiveInvoice.invoice_id })
        .first();

      // Credit should be fully applied
      expect(finalPositiveInvoice.credit_applied).toBe(11000); // $110.00 credit applied
      expect(parseInt(finalPositiveInvoice.total_amount)).toBe(0); // $0.00 remaining total

      // 23. Verify the credit balance is reduced
      const finalCredit = await CompanyBillingPlan.getCompanyCredit(company_id);
      expect(finalCredit).toBe(1500); // $15.00 = $125.00 - $110.00 

      // 24. Verify credit application transaction
      const creditApplicationTransaction = await context.db('transactions')
        .where({
          company_id: company_id,
          invoice_id: positiveInvoice.invoice_id,
          type: 'credit_application'
        })
        .first();

      expect(creditApplicationTransaction).toBeTruthy();
      expect(parseInt(creditApplicationTransaction.amount)).toBe(-11000); // -$110.00 (negative as credit is used)
    });
  });

  describe('Partial Application of Negative Invoice Credit', () => {
    it('should apply partial credit when the invoice amount exceeds the available credit', async () => {
      // 1. Create a test company with zero initial credit balance
      const company_id = await context.createEntity<ICompany>('companies', {
        company_name: 'Partial Credit Application Company',
        billing_cycle: 'monthly',
        company_id: uuidv4(),
        tax_region: 'US-NY',
        is_tax_exempt: false,
        created_at: Temporal.Now.plainDateISO().toString(),
        updated_at: Temporal.Now.plainDateISO().toString(),
        phone_no: '',
        credit_balance: 0,
        email: '',
        url: '',
        address: '',
        is_inactive: false
      }, 'company_id');

      // 2. Create NY tax rate (10%)
      const nyTaxRateId = await context.createEntity('tax_rates', {
        region: 'US-NY',
        tax_percentage: 10.0,
        description: 'NY Test Tax',
        start_date: '2025-01-01'
      }, 'tax_rate_id');

      // 3. Set up company tax settings
      await context.db('company_tax_settings').insert({
        company_id: company_id,
        tenant: context.tenantId,
        tax_rate_id: nyTaxRateId,
        is_reverse_charge_applicable: false
      });

      // 4. Create single negative service for first invoice (small amount)
      const negativeService = await context.createEntity('service_catalog', {
        service_name: 'Small Credit Service',
        service_type: 'Fixed',
        default_rate: -5000, // -$50.00 (small credit)
        unit_of_measure: 'unit',
        tax_region: 'US-NY',
        is_taxable: true
      }, 'service_id');

      // 5. Create a billing plan for negative services
      const planId1 = await context.createEntity('billing_plans', {
        plan_name: 'Small Credit Plan',
        billing_frequency: 'monthly',
        is_custom: false,
        plan_type: 'Fixed'
      }, 'plan_id');

      // 6. Assign negative service to plan
      await context.db('plan_services').insert({
        plan_id: planId1,
        service_id: negativeService,
        quantity: 1,
        tenant: context.tenantId
      });

      // 7. Create first billing cycle
      const now = createTestDate();
      const startDate1 = Temporal.PlainDate.from(now).subtract({ months: 2 }).toString();
      const endDate1 = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();

      const billingCycleId1 = await context.createEntity('company_billing_cycles', {
        company_id: company_id,
        billing_cycle: 'monthly',
        period_start_date: startDate1,
        period_end_date: endDate1,
        effective_date: startDate1
      }, 'billing_cycle_id');

      // 8. Assign first plan to company
      await context.db('company_billing_plans').insert({
        company_billing_plan_id: uuidv4(),
        company_id: company_id,
        plan_id: planId1,
        tenant: context.tenantId,
        start_date: startDate1,
        is_active: true
      });

      // 9. Generate negative invoice (small amount)
      const negativeInvoice = await generateInvoice(billingCycleId1);

      if (!negativeInvoice) {
        throw new Error('Failed to generate negative invoice');
      }

      // 10. Verify the negative invoice calculations
      expect(negativeInvoice.subtotal).toBe(-5000); // -$50.00
      expect(negativeInvoice.tax).toBe(0);          // $0.00 (no tax on negative amounts)
      expect(negativeInvoice.total_amount).toBe(-5000); // -$50.00

      // 11. Finalize the negative invoice
      await finalizeInvoice(negativeInvoice.invoice_id);

      // 12. Verify credit was created
      const creditAfterNegativeInvoice = await CompanyBillingPlan.getCompanyCredit(company_id);
      expect(creditAfterNegativeInvoice).toBe(5000); // $50.00 credit

      // Now create a positive invoice with a larger amount

      // 13. Create expensive positive service for second invoice
      const expensiveService = await context.createEntity('service_catalog', {
        service_name: 'Expensive Service',
        service_type: 'Fixed',
        default_rate: 17500, // $175.00 (larger than the credit)
        unit_of_measure: 'unit',
        tax_region: 'US-NY',
        is_taxable: true
      }, 'service_id');

      // 14. Create a billing plan for expensive service
      const planId2 = await context.createEntity('billing_plans', {
        plan_name: 'Expensive Plan',
        billing_frequency: 'monthly',
        is_custom: false,
        plan_type: 'Fixed'
      }, 'plan_id');

      // 15. Assign positive service to second plan
      await context.db('plan_services').insert({
        plan_id: planId2,
        service_id: expensiveService,
        quantity: 1,
        tenant: context.tenantId
      });

      // 16. Create second billing cycle
      const startDate2 = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();
      const endDate2 = Temporal.PlainDate.from(now).toString();

      const billingCycleId2 = await context.createEntity('company_billing_cycles', {
        company_id: company_id,
        billing_cycle: 'monthly',
        period_start_date: startDate2,
        period_end_date: endDate2,
        effective_date: startDate2
      }, 'billing_cycle_id');

      // 17. Deactivate the first plan and assign second plan to company
      await context.db('company_billing_plans')
        .where({ 
          company_id: company_id,
          plan_id: planId1,
          tenant: context.tenantId
        })
        .update({ is_active: false });
        
      await context.db('company_billing_plans').insert({
        company_billing_plan_id: uuidv4(),
        company_id: company_id,
        plan_id: planId2,
        tenant: context.tenantId,
        start_date: startDate2,
        is_active: true
      });

      // 18. Generate positive invoice
      const positiveInvoice = await generateInvoice(billingCycleId2);

      if (!positiveInvoice) {
        throw new Error('Failed to generate positive invoice');
      }

      // 19. Verify the positive invoice calculations
      expect(positiveInvoice.subtotal).toBe(17500);  // $175.00
      expect(positiveInvoice.tax).toBe(1750);        // $17.50 (10% of $175)
      expect(positiveInvoice.total_amount).toBe(19250); // $192.50 ($175 + $17.50)

      // 20. Finalize the positive invoice to apply credit
      await finalizeInvoice(positiveInvoice.invoice_id);

      // 21. Verify the final state of the positive invoice
      const finalPositiveInvoice = await context.db('invoices')
        .where({ invoice_id: positiveInvoice.invoice_id })
        .first();

      // Credit should be partially applied
      expect(finalPositiveInvoice.credit_applied).toBe(5000); // $50.00 credit applied (all available)
      expect(parseInt(finalPositiveInvoice.total_amount)).toBe(14250); // $142.50 remaining total ($192.50 - $50.00)

      // 22. Verify the credit balance is now zero
      const finalCredit = await CompanyBillingPlan.getCompanyCredit(company_id);
      expect(finalCredit).toBe(0); // All credit was used

      // 23. Verify credit application transaction
      const creditApplicationTransaction = await context.db('transactions')
        .where({
          company_id: company_id,
          invoice_id: positiveInvoice.invoice_id,
          type: 'credit_application'
        })
        .first();

      expect(creditApplicationTransaction).toBeTruthy();
      expect(parseInt(creditApplicationTransaction.amount)).toBe(-5000); // -$50.00 (negative as credit is used)
    });
  });

  describe('Full Credit Coverage from Negative Invoice', () => {
    it('should fully cover a smaller invoice with excess credit from a negative invoice', async () => {
      // 1. Create a test company with zero initial credit balance
      const company_id = await context.createEntity<ICompany>('companies', {
        company_name: 'Full Credit Coverage Company',
        billing_cycle: 'monthly',
        company_id: uuidv4(),
        tax_region: 'US-NY',
        is_tax_exempt: false,
        created_at: Temporal.Now.plainDateISO().toString(),
        updated_at: Temporal.Now.plainDateISO().toString(),
        phone_no: '',
        credit_balance: 0,
        email: '',
        url: '',
        address: '',
        is_inactive: false
      }, 'company_id');

      // 2. Create NY tax rate (10%)
      const nyTaxRateId = await context.createEntity('tax_rates', {
        region: 'US-NY',
        tax_percentage: 10.0,
        description: 'NY Test Tax',
        start_date: '2025-01-01'
      }, 'tax_rate_id');

      // 3. Set up company tax settings
      await context.db('company_tax_settings').insert({
        company_id: company_id,
        tenant: context.tenantId,
        tax_rate_id: nyTaxRateId,
        is_reverse_charge_applicable: false
      });

      // 4. Create large negative service for first invoice
      const largeNegativeService = await context.createEntity('service_catalog', {
        service_name: 'Large Credit Service',
        service_type: 'Fixed',
        default_rate: -20000, // -$200.00 (large credit)
        unit_of_measure: 'unit',
        tax_region: 'US-NY',
        is_taxable: true
      }, 'service_id');

      // 5. Create a billing plan for negative service
      const planId1 = await context.createEntity('billing_plans', {
        plan_name: 'Large Credit Plan',
        billing_frequency: 'monthly',
        is_custom: false,
        plan_type: 'Fixed'
      }, 'plan_id');

      // 6. Assign negative service to plan
      await context.db('plan_services').insert({
        plan_id: planId1,
        service_id: largeNegativeService,
        quantity: 1,
        tenant: context.tenantId
      });

      // 7. Create first billing cycle
      const now = createTestDate();
      const startDate1 = Temporal.PlainDate.from(now).subtract({ months: 2 }).toString();
      const endDate1 = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();

      const billingCycleId1 = await context.createEntity('company_billing_cycles', {
        company_id: company_id,
        billing_cycle: 'monthly',
        period_start_date: startDate1,
        period_end_date: endDate1,
        effective_date: startDate1
      }, 'billing_cycle_id');

      // 8. Assign first plan to company
      await context.db('company_billing_plans').insert({
        company_billing_plan_id: uuidv4(),
        company_id: company_id,
        plan_id: planId1,
        tenant: context.tenantId,
        start_date: startDate1,
        is_active: true
      });

      // 9. Generate negative invoice (large amount)
      const negativeInvoice = await generateInvoice(billingCycleId1);

      if (!negativeInvoice) {
        throw new Error('Failed to generate negative invoice');
      }

      // 10. Verify the negative invoice calculations
      expect(negativeInvoice.subtotal).toBe(-20000); // -$200.00
      expect(negativeInvoice.tax).toBe(0);           // $0.00 (no tax on negative amounts)
      expect(negativeInvoice.total_amount).toBe(-20000); // -$200.00

      // 11. Finalize the negative invoice
      await finalizeInvoice(negativeInvoice.invoice_id);

      // 12. Verify credit was created
      const creditAfterNegativeInvoice = await CompanyBillingPlan.getCompanyCredit(company_id);
      expect(creditAfterNegativeInvoice).toBe(20000); // $200.00 credit

      // Now create a positive invoice with a smaller amount

      // 13. Create small positive service for second invoice
      const smallService = await context.createEntity('service_catalog', {
        service_name: 'Small Service',
        service_type: 'Fixed',
        default_rate: 5000, // $50.00 (smaller than the credit)
        unit_of_measure: 'unit',
        tax_region: 'US-NY',
        is_taxable: true
      }, 'service_id');

      // 14. Create a billing plan for small service
      const planId2 = await context.createEntity('billing_plans', {
        plan_name: 'Small Service Plan',
        billing_frequency: 'monthly',
        is_custom: false,
        plan_type: 'Fixed'
      }, 'plan_id');

      // 15. Assign positive service to second plan
      await context.db('plan_services').insert({
        plan_id: planId2,
        service_id: smallService,
        quantity: 1,
        tenant: context.tenantId
      });

      // 16. Create second billing cycle
      const startDate2 = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();
      const endDate2 = Temporal.PlainDate.from(now).toString();

      const billingCycleId2 = await context.createEntity('company_billing_cycles', {
        company_id: company_id,
        billing_cycle: 'monthly',
        period_start_date: startDate2,
        period_end_date: endDate2,
        effective_date: startDate2
      }, 'billing_cycle_id');

      // 17. Deactivate the first plan and assign second plan to company
      await context.db('company_billing_plans')
        .where({ 
          company_id: company_id,
          plan_id: planId1,
          tenant: context.tenantId
        })
        .update({ is_active: false });
        
      await context.db('company_billing_plans').insert({
        company_billing_plan_id: uuidv4(),
        company_id: company_id,
        plan_id: planId2,
        tenant: context.tenantId,
        start_date: startDate2,
        is_active: true
      });

      // 18. Generate positive invoice
      const positiveInvoice = await generateInvoice(billingCycleId2);

      if (!positiveInvoice) {
        throw new Error('Failed to generate positive invoice');
      }

      // 19. Verify the positive invoice calculations
      expect(positiveInvoice.subtotal).toBe(5000);  // $50.00
      expect(positiveInvoice.tax).toBe(500);        // $5.00 (10% of $50)
      expect(positiveInvoice.total_amount).toBe(5500); // $55.00 ($50 + $5)

      // 20. Finalize the positive invoice to apply credit
      await finalizeInvoice(positiveInvoice.invoice_id);

      // 21. Verify the final state of the positive invoice
      const finalPositiveInvoice = await context.db('invoices')
        .where({ invoice_id: positiveInvoice.invoice_id })
        .first();

      // Credit should fully cover the invoice
      expect(finalPositiveInvoice.credit_applied).toBe(5500); // $55.00 credit applied
      expect(parseInt(finalPositiveInvoice.total_amount)).toBe(0); // $0.00 remaining total

      // 22. Verify the credit balance is reduced but still has remaining credit
      const finalCredit = await CompanyBillingPlan.getCompanyCredit(company_id);
      expect(finalCredit).toBe(14500); // $145.00 remaining credit ($200.00 - $55.00)

      // 23. Verify credit application transaction
      const creditApplicationTransaction = await context.db('transactions')
        .where({
          company_id: company_id,
          invoice_id: positiveInvoice.invoice_id,
          type: 'credit_application'
        })
        .first();

      expect(creditApplicationTransaction).toBeTruthy();
      expect(parseInt(creditApplicationTransaction.amount)).toBe(-5500); // -$55.00 (negative as credit is used)
    });
  });
});
