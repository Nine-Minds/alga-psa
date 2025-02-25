import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import '../../../test-utils/nextApiMock';
import { TestContext } from '../../../test-utils/testContext';
import { createPrepaymentInvoice, applyCreditToInvoice } from '@/lib/actions/creditActions';
import { finalizeInvoice, generateInvoice } from '@/lib/actions/invoiceActions';
import { createDefaultTaxSettings } from '@/lib/actions/taxSettingsActions';
import { v4 as uuidv4 } from 'uuid';
import type { ICompany } from '../../interfaces/company.interfaces';
import { Temporal } from '@js-temporal/polyfill';
import CompanyBillingPlan from '@/lib/models/clientBilling';
import { createTestDate, createTestDateISO } from '../../../test-utils/dateUtils';
import { toPlainDate } from '@/lib/utils/dateTimeUtils';

describe('Credit Application Tests', () => {
  const testHelpers = TestContext.createHelpers();
  let context: TestContext;

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
      companyName: 'Credit Test Company',
      userType: 'internal'
    });

    // Create default tax settings and billing settings
    await createDefaultTaxSettings(context.company.company_id);
  });

  beforeEach(async () => {
    await testHelpers.beforeEach();
  });

  afterAll(async () => {
    await testHelpers.afterAll();
  });

  describe('Credit Application Scenarios', () => {
    it('should correctly apply credit when available credit is less than the invoice total', async () => {
      // Create test company
      const company_id = await context.createEntity<ICompany>('companies', {
        company_name: 'Partial Credit Test Company',
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

      // Create NY tax rate
      const nyTaxRateId = await context.createEntity('tax_rates', {
        region: 'US-NY',
        tax_percentage: 10.0, // 10% for easy calculation
        description: 'NY Test Tax',
        start_date: '2025-01-01'
      }, 'tax_rate_id');

      // Set up company tax settings
      await context.db('company_tax_settings').insert({
        company_id: company_id,
        tenant: context.tenantId,
        tax_rate_id: nyTaxRateId,
        is_reverse_charge_applicable: false
      });

      // Create a service
      const service = await context.createEntity('service_catalog', {
        service_name: 'Premium Service',
        service_type: 'Fixed',
        default_rate: 10000, // $100.00
        unit_of_measure: 'unit',
        tax_region: 'US-NY',
        is_taxable: true
      }, 'service_id');

      // Create a billing plan
      const planId = await context.createEntity('billing_plans', {
        plan_name: 'Test Plan',
        billing_frequency: 'monthly',
        is_custom: false,
        plan_type: 'Fixed'
      }, 'plan_id');

      // Link service to plan
      await context.db('plan_services').insert({
        plan_id: planId,
        service_id: service,
        tenant: context.tenantId,
        quantity: 1
      });

      // Create a billing cycle
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

      // Link plan to company
      await context.db('company_billing_plans').insert({
        company_billing_plan_id: uuidv4(),
        company_id: company_id,
        plan_id: planId,
        tenant: context.tenantId,
        start_date: startDate,
        is_active: true
      });

      // Step 1: Create prepayment invoice with credit amount less than what will be needed
      const prepaymentAmount = 5000; // $50.00 credit
      const prepaymentInvoice = await createPrepaymentInvoice(company_id, prepaymentAmount);
      
      // Step 2: Finalize the prepayment invoice - prepayment invoices don't need a billing cycle
      await finalizeInvoice(prepaymentInvoice.invoice_id);
      
      // Step 3: Verify initial credit balance
      const initialCredit = await CompanyBillingPlan.getCompanyCredit(company_id);
      expect(initialCredit).toBe(prepaymentAmount);

      // Log credit balance before generating invoice
      console.log('Credit balance before generating invoice:', initialCredit);
      
      // Step 5: Generate an automatic invoice using the billing cycle
      const invoice = await generateInvoice(billingCycleId);
      
      if (!invoice) {
        throw new Error('Failed to generate invoice');
      }
      
      // Log invoice details
      console.log('Generated invoice:', {
        invoice_id: invoice.invoice_id,
        subtotal: invoice.subtotal,
        tax: invoice.tax,
        total_amount: invoice.total_amount,
        credit_applied: invoice.credit_applied
      });
      
      // Log credit balance after generating invoice
      const creditAfterGeneration = await CompanyBillingPlan.getCompanyCredit(company_id);
      console.log('Credit balance after generating invoice:', creditAfterGeneration);

      // Step 6: Finalize the manual invoice to apply credit
      await finalizeInvoice(invoice.invoice_id);

      // Step 7: Get the updated invoice to verify credit application
      const updatedInvoice = await context.db('invoices')
        .where({ invoice_id: invoice.invoice_id })
        .first();

      // Step 8: Verify credit application
      expect(updatedInvoice.credit_applied).toBe(prepaymentAmount); // All $50 credit was applied
      
      // Calculate expected values
      const subtotal = 10000; // $100.00
      const tax = 1000;      // $10.00 (10% of $100)
      const totalBeforeCredit = subtotal + tax; // $110.00
      const expectedRemainingTotal = totalBeforeCredit - prepaymentAmount; // $110 - $50 = $60

      // Verify invoice totals
      expect(updatedInvoice.subtotal).toBe(subtotal);
      expect(updatedInvoice.tax).toBe(tax);
      expect(parseInt(updatedInvoice.total_amount)).toBe(expectedRemainingTotal);

      // Verify credit balance is now zero
      const finalCredit = await CompanyBillingPlan.getCompanyCredit(company_id);
      expect(finalCredit).toBe(0);

      // Verify credit application transaction
      const creditTransaction = await context.db('transactions')
        .where({
          company_id: company_id,
          invoice_id: invoice.invoice_id,
          type: 'credit_application'
        })
        .first();

      expect(creditTransaction).toBeTruthy();
      expect(parseFloat(creditTransaction.amount)).toBe(-prepaymentAmount);
      expect(creditTransaction.description).toContain('Applied credit to invoice');
    });
  });

  it('should correctly apply credit when available credit exceeds the invoice total', async () => {
    // Create test company
    const company_id = await context.createEntity<ICompany>('companies', {
      company_name: 'Excess Credit Test Company',
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

    // Create NY tax rate
    const nyTaxRateId = await context.createEntity('tax_rates', {
      region: 'US-NY',
      tax_percentage: 10.0, // 10% for easy calculation
      description: 'NY Test Tax',
      start_date: '2025-01-01'
    }, 'tax_rate_id');

    // Set up company tax settings
    await context.db('company_tax_settings').insert({
      company_id: company_id,
      tenant: context.tenantId,
      tax_rate_id: nyTaxRateId,
      is_reverse_charge_applicable: false
    });

    // Create a service
    const service = await context.createEntity('service_catalog', {
      service_name: 'Premium Service',
      service_type: 'Fixed',
      default_rate: 10000, // $100.00
      unit_of_measure: 'unit',
      tax_region: 'US-NY',
      is_taxable: true
    }, 'service_id');

    // Create a billing plan
    const planId = await context.createEntity('billing_plans', {
      plan_name: 'Test Plan',
      billing_frequency: 'monthly',
      is_custom: false,
      plan_type: 'Fixed'
    }, 'plan_id');

    // Link service to plan
    await context.db('plan_services').insert({
      plan_id: planId,
      service_id: service,
      tenant: context.tenantId,
      quantity: 1
    });

    // Create a billing cycle
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

    // Link plan to company
    await context.db('company_billing_plans').insert({
      company_billing_plan_id: uuidv4(),
      company_id: company_id,
      plan_id: planId,
      tenant: context.tenantId,
      start_date: startDate,
      is_active: true
    });

    // Step 1: Create prepayment invoice with credit amount GREATER than what will be needed
    const prepaymentAmount = 15000; // $150.00 credit (more than the $110 invoice total)
    const prepaymentInvoice = await createPrepaymentInvoice(company_id, prepaymentAmount);
    
    // Step 2: Finalize the prepayment invoice - prepayment invoices don't need a billing cycle
    await finalizeInvoice(prepaymentInvoice.invoice_id);
    
    // Step 3: Verify initial credit balance
    const initialCredit = await CompanyBillingPlan.getCompanyCredit(company_id);
    expect(initialCredit).toBe(prepaymentAmount);

    // Log credit balance before generating invoice
    console.log('Credit balance before generating invoice:', initialCredit);
    
    // Step 4: Generate an automatic invoice using the billing cycle
    const invoice = await generateInvoice(billingCycleId);
    
    if (!invoice) {
      throw new Error('Failed to generate invoice');
    }
    
    // Log invoice details
    console.log('Generated invoice:', {
      invoice_id: invoice.invoice_id,
      subtotal: invoice.subtotal,
      tax: invoice.tax,
      total_amount: invoice.total_amount,
      credit_applied: invoice.credit_applied
    });
    
    // Log credit balance after generating invoice
    const creditAfterGeneration = await CompanyBillingPlan.getCompanyCredit(company_id);
    console.log('Credit balance after generating invoice:', creditAfterGeneration);

    // Step 5: Finalize the invoice to apply credit
    await finalizeInvoice(invoice.invoice_id);

    // Step 6: Get the updated invoice to verify credit application
    const updatedInvoice = await context.db('invoices')
      .where({ invoice_id: invoice.invoice_id })
      .first();

    // Step 7: Verify credit application
    // Calculate expected values
    const subtotal = 10000; // $100.00
    const tax = 1000;      // $10.00 (10% of $100)
    const totalBeforeCredit = subtotal + tax; // $110.00
    const expectedAppliedCredit = totalBeforeCredit; // All $110.00 needed for the invoice
    const expectedRemainingBalance = prepaymentAmount - expectedAppliedCredit; // $150 - $110 = $40
    
    // Verify invoice values
    expect(updatedInvoice.subtotal).toBe(subtotal);
    expect(updatedInvoice.tax).toBe(tax);
    expect(updatedInvoice.credit_applied).toBe(expectedAppliedCredit);
    expect(parseInt(updatedInvoice.total_amount)).toBe(0); // Invoice should be fully paid
    
    // Verify remaining credit balance
    const finalCredit = await CompanyBillingPlan.getCompanyCredit(company_id);
    expect(finalCredit).toBe(expectedRemainingBalance);

    // Verify credit application transaction
    const creditTransaction = await context.db('transactions')
      .where({
        company_id: company_id,
        invoice_id: invoice.invoice_id,
        type: 'credit_application'
      })
      .first();

    expect(creditTransaction).toBeTruthy();
    expect(parseFloat(creditTransaction.amount)).toBe(-expectedAppliedCredit);
    expect(creditTransaction.description).toContain('Applied credit to invoice');
  });

  it('should validate partial credit application when credit is less than invoice total', async () => {
    // Create test company
    const company_id = await context.createEntity<ICompany>('companies', {
      company_name: 'Partial Credit Test Company',
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

    // Create NY tax rate
    const nyTaxRateId = await context.createEntity('tax_rates', {
      region: 'US-NY',
      tax_percentage: 10.0, // 10% for easy calculation
      description: 'NY Test Tax',
      start_date: '2025-01-01'
    }, 'tax_rate_id');

    // Set up company tax settings
    await context.db('company_tax_settings').insert({
      company_id: company_id,
      tenant: context.tenantId,
      tax_rate_id: nyTaxRateId,
      is_reverse_charge_applicable: false
    });

    // Create two services with different prices
    const service1 = await context.createEntity('service_catalog', {
      service_name: 'Premium Service',
      service_type: 'Fixed',
      default_rate: 10000, // $100.00
      unit_of_measure: 'unit',
      tax_region: 'US-NY',
      is_taxable: true
    }, 'service_id');

    const service2 = await context.createEntity('service_catalog', {
      service_name: 'Additional Service',
      service_type: 'Fixed',
      default_rate: 15000, // $150.00
      unit_of_measure: 'unit',
      tax_region: 'US-NY',
      is_taxable: true
    }, 'service_id');

    // Create a billing plan
    const planId = await context.createEntity('billing_plans', {
      plan_name: 'Test Plan',
      billing_frequency: 'monthly',
      is_custom: false,
      plan_type: 'Fixed'
    }, 'plan_id');

    // Link both services to plan
    await context.db('plan_services').insert([
      {
        plan_id: planId,
        service_id: service1,
        tenant: context.tenantId,
        quantity: 1
      },
      {
        plan_id: planId,
        service_id: service2,
        tenant: context.tenantId,
        quantity: 1
      }
    ]);

    // Create a billing cycle
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

    // Link plan to company
    await context.db('company_billing_plans').insert({
      company_billing_plan_id: uuidv4(),
      company_id: company_id,
      plan_id: planId,
      tenant: context.tenantId,
      start_date: startDate,
      is_active: true
    });

    // Step 1: Create prepayment invoice with credit amount LESS than what will be needed for full payment
    const prepaymentAmount = 10000; // $100.00 credit
    const prepaymentInvoice = await createPrepaymentInvoice(company_id, prepaymentAmount);
    
    // Step 2: Finalize the prepayment invoice
    await finalizeInvoice(prepaymentInvoice.invoice_id);
    
    // Step 3: Verify initial credit balance
    const initialCredit = await CompanyBillingPlan.getCompanyCredit(company_id);
    expect(initialCredit).toBe(prepaymentAmount);

    // Log credit balance before generating invoice
    console.log('Credit balance before generating invoice:', initialCredit);
    
    // Step 4: Generate an automatic invoice using the billing cycle
    // This will include both services ($100 + $150 = $250 + 10% tax = $275)
    const invoice = await generateInvoice(billingCycleId);
    
    if (!invoice) {
      throw new Error('Failed to generate invoice');
    }
    
    // Log invoice details
    console.log('Generated invoice:', {
      invoice_id: invoice.invoice_id,
      subtotal: invoice.subtotal,
      tax: invoice.tax,
      total_amount: invoice.total_amount,
      credit_applied: invoice.credit_applied
    });
    
    // Step 5: Finalize the invoice to apply credit
    await finalizeInvoice(invoice.invoice_id);

    // Step 6: Get the updated invoice to verify credit application
    const updatedInvoice = await context.db('invoices')
      .where({ invoice_id: invoice.invoice_id })
      .first();

    // Step 7: Verify credit application
    // Calculate expected values
    const expectedSubtotal = 25000; // $250.00 ($100 + $150)
    const expectedTax = 2500;      // $25.00 (10% of $250)
    const expectedTotalBeforeCredit = expectedSubtotal + expectedTax; // $275.00
    const expectedCreditApplied = prepaymentAmount; // $100.00 - full available credit is applied
    const expectedRemainingTotal = expectedTotalBeforeCredit - expectedCreditApplied; // $275 - $100 = $175
    
    // Verify invoice values
    expect(updatedInvoice.subtotal).toBe(expectedSubtotal);
    expect(updatedInvoice.tax).toBe(expectedTax);
    expect(updatedInvoice.credit_applied).toBe(expectedCreditApplied);
    expect(parseInt(updatedInvoice.total_amount)).toBe(expectedRemainingTotal); // Invoice should have remaining balance
    
    // Verify remaining credit balance (should be 0 since all credit was applied)
    const finalCredit = await CompanyBillingPlan.getCompanyCredit(company_id);
    expect(finalCredit).toBe(0);

    // Verify credit application transaction
    const creditTransaction = await context.db('transactions')
      .where({
        company_id: company_id,
        invoice_id: invoice.invoice_id,
        type: 'credit_application'
      })
      .first();

    expect(creditTransaction).toBeTruthy();
    expect(parseFloat(creditTransaction.amount)).toBe(-expectedCreditApplied);
    expect(creditTransaction.description).toContain('Applied credit to invoice');
  });

  it('should verify credit application after discounts are applied', async () => {
    // Create test company
    const company_id = await context.createEntity<ICompany>('companies', {
      company_name: 'Discount Credit Test Company',
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

    // Create NY tax rate
    const nyTaxRateId = await context.createEntity('tax_rates', {
      region: 'US-NY',
      tax_percentage: 10.0, // 10% for easy calculation
      description: 'NY Test Tax',
      start_date: '2025-01-01'
    }, 'tax_rate_id');

    // Set up company tax settings
    await context.db('company_tax_settings').insert({
      company_id: company_id,
      tenant: context.tenantId,
      tax_rate_id: nyTaxRateId,
      is_reverse_charge_applicable: false
    });

    // Create a service
    const service = await context.createEntity('service_catalog', {
      service_name: 'Premium Service',
      service_type: 'Fixed',
      default_rate: 10000, // $100.00
      unit_of_measure: 'unit',
      tax_region: 'US-NY',
      is_taxable: true
    }, 'service_id');

    // Create a billing plan
    const planId = await context.createEntity('billing_plans', {
      plan_name: 'Test Plan',
      billing_frequency: 'monthly',
      is_custom: false,
      plan_type: 'Fixed'
    }, 'plan_id');

    // Link service to plan
    await context.db('plan_services').insert({
      plan_id: planId,
      service_id: service,
      tenant: context.tenantId,
      quantity: 1
    });

    // Create a billing cycle
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

    // Link plan to company
    await context.db('company_billing_plans').insert({
      company_billing_plan_id: uuidv4(),
      company_id: company_id,
      plan_id: planId,
      tenant: context.tenantId,
      start_date: startDate,
      is_active: true
    });

    // Step 1: Create prepayment invoice for credit
    const prepaymentAmount = 5000; // $50.00 credit
    const prepaymentInvoice = await createPrepaymentInvoice(company_id, prepaymentAmount);
    
    // Step 2: Finalize the prepayment invoice
    await finalizeInvoice(prepaymentInvoice.invoice_id);
    
    // Step 3: Verify initial credit balance
    const initialCredit = await CompanyBillingPlan.getCompanyCredit(company_id);
    expect(initialCredit).toBe(prepaymentAmount);

    // Step 4: Generate an automatic invoice using the billing cycle
    const invoice = await generateInvoice(billingCycleId);
    
    if (!invoice) {
      throw new Error('Failed to generate invoice');
    }
    
    console.log('Generated invoice before discount:', {
      invoice_id: invoice.invoice_id,
      subtotal: invoice.subtotal,
      tax: invoice.tax,
      total_amount: invoice.total_amount
    });

    // Step 5: Add a discount to the invoice
    const discountAmount = 2000; // $20.00 discount
    await context.db('invoice_items').insert({
      item_id: uuidv4(),
      invoice_id: invoice.invoice_id,
      description: 'Loyalty Discount',
      quantity: 1,
      unit_price: -discountAmount,
      net_amount: -discountAmount,
      tax_amount: 0, // Discounts are not taxable
      tax_rate: 0,
      total_price: -discountAmount,
      is_discount: true, // Mark as discount
      is_taxable: false, // Discounts are not taxable
      is_manual: true,
      tenant: context.tenantId
    });

    // Recalculate invoice totals
    const originalSubtotal = 10000; // $100.00
    const tax = 1000;              // $10.00 (10% of $100)
    const discountedSubtotal = originalSubtotal - discountAmount; // $100 - $20 = $80
    const totalWithDiscount = discountedSubtotal + tax; // $80 + $10 = $90

    // Update the invoice totals after adding the discount
    await context.db('invoices')
      .where({ invoice_id: invoice.invoice_id })
      .update({
        subtotal: discountedSubtotal,
        total_amount: totalWithDiscount
      });

    // Get the updated invoice with discount
    const invoiceWithDiscount = await context.db('invoices')
      .where({ invoice_id: invoice.invoice_id })
      .first();

    console.log('Invoice after discount, before credit:', {
      invoice_id: invoiceWithDiscount.invoice_id,
      subtotal: invoiceWithDiscount.subtotal,
      tax: invoiceWithDiscount.tax,
      total_amount: invoiceWithDiscount.total_amount
    });
    
    // Step 6: Finalize the invoice to apply credit
    await finalizeInvoice(invoice.invoice_id);

    // Step 7: Get the updated invoice to verify credit application
    const updatedInvoice = await context.db('invoices')
      .where({ invoice_id: invoice.invoice_id })
      .first();

    // Step 8: Verify credit application
    // Credit should be applied to the post-discount amount
    const expectedCreditApplied = Math.min(prepaymentAmount, totalWithDiscount); // $50 > $90, so $50 applied
    const expectedRemainingTotal = Math.max(0, totalWithDiscount - prepaymentAmount); // $90 - $50 = $40

    // Verify invoice values
    expect(updatedInvoice.subtotal).toBe(discountedSubtotal); // $80
    expect(updatedInvoice.tax).toBe(tax); // $10 (tax is still calculated on original $100)
    expect(updatedInvoice.credit_applied).toBe(expectedCreditApplied); // $50
    expect(parseInt(updatedInvoice.total_amount)).toBe(expectedRemainingTotal); // $40
    
    // Verify remaining credit balance (should be 0 since all credit was applied)
    const finalCredit = await CompanyBillingPlan.getCompanyCredit(company_id);
    expect(finalCredit).toBe(0);

    // Verify credit application transaction
    const creditTransaction = await context.db('transactions')
      .where({
        company_id: company_id,
        invoice_id: invoice.invoice_id,
        type: 'credit_application'
      })
      .first();

    expect(creditTransaction).toBeTruthy();
    expect(parseFloat(creditTransaction.amount)).toBe(-expectedCreditApplied);
    expect(creditTransaction.description).toContain('Applied credit to invoice');
  });
  
  it('should create credits from regular invoices with negative totals when they are finalized', async () => {
    // Create test company
    const company_id = await context.createEntity<ICompany>('companies', {
      company_name: 'Negative Invoice Credit Company',
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

    // Create NY tax rate
    const nyTaxRateId = await context.createEntity('tax_rates', {
      region: 'US-NY',
      tax_percentage: 10.0,
      description: 'NY Test Tax',
      start_date: '2025-01-01'
    }, 'tax_rate_id');

    // Set up company tax settings
    await context.db('company_tax_settings').insert({
      company_id: company_id,
      tenant: context.tenantId,
      tax_rate_id: nyTaxRateId,
      is_reverse_charge_applicable: false
    });

    // Create services with negative rates (credits)
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

    // Create a billing plan
    const planId = await context.createEntity('billing_plans', {
      plan_name: 'Credit Plan',
      billing_frequency: 'monthly',
      is_custom: false,
      plan_type: 'Fixed'
    }, 'plan_id');

    // Assign services to plan
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

    // Create billing cycle
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

    // Assign plan to company
    await context.db('company_billing_plans').insert({
      company_billing_plan_id: uuidv4(),
      company_id: company_id,
      plan_id: planId,
      tenant: context.tenantId,
      start_date: startDate,
      is_active: true
    });

    // Step 1: Check initial credit balance (should be 0)
    const initialCredit = await CompanyBillingPlan.getCompanyCredit(company_id);
    expect(initialCredit).toBe(0);

    // Step 2: Generate invoice with negative total
    const invoice = await generateInvoice(billingCycleId);
    
    if (!invoice) {
      throw new Error('Failed to generate invoice');
    }
    
    // Verify the invoice has a negative total
    expect(invoice.total_amount).toBeLessThan(0);
    const negativeAmount = invoice.total_amount;
    const creditAmount = Math.abs(negativeAmount);
    
    console.log('Generated negative invoice:', {
      invoice_id: invoice.invoice_id,
      subtotal: invoice.subtotal,
      tax: invoice.tax,
      total_amount: invoice.total_amount
    });
    
    // Verify that no tax is applied to negative amounts
    // According to taxService.ts: "For negative or zero net amounts, no tax should be applied"
    expect(invoice.tax).toBe(0);
    
    // Expected values:
    // Service A: -$50.00 (-5000)
    // Service B: -$75.00 (-7500)
    // Subtotal: -$125.00 (-12500)
    // Tax: $0 (no tax on negative amounts)
    // Total: -$125.00 (-12500)
    expect(invoice.subtotal).toBe(-12500);
    expect(invoice.total_amount).toBe(-12500);
    
    // Step 3: Finalize the invoice to trigger credit creation
    await finalizeInvoice(invoice.invoice_id);
    
    // Step 4: Verify credit balance has been increased by the absolute value of the negative total
    const updatedCredit = await CompanyBillingPlan.getCompanyCredit(company_id);
    expect(updatedCredit).toBe(12500); // $125.00
    
    // Step 5: Verify transaction record
    const creditTransaction = await context.db('transactions')
      .where({
        company_id: company_id,
        invoice_id: invoice.invoice_id,
        type: 'credit_issuance_from_negative_invoice'
      })
      .first();
    
    // Verify transaction details
    expect(creditTransaction).toBeTruthy();
    expect(parseFloat(creditTransaction.amount)).toBe(creditAmount);
    expect(creditTransaction.description).toContain('Credit issued from negative invoice');
    
    // Verify invoice status
    const finalizedInvoice = await context.db('invoices')
      .where({ invoice_id: invoice.invoice_id })
      .first();
    
    expect(finalizedInvoice.status).toBe('sent');
    expect(finalizedInvoice.finalized_at).toBeTruthy();
  });

  it('should create credits with expiration dates from negative invoices', async () => {
    // Create test company
    const company_id = await context.createEntity<ICompany>('companies', {
      company_name: 'Negative Invoice With Expiration',
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

    // Create NY tax rate
    const nyTaxRateId = await context.createEntity('tax_rates', {
      region: 'US-NY',
      tax_percentage: 10.0,
      description: 'NY Test Tax',
      start_date: '2025-01-01'
    }, 'tax_rate_id');

    // Set up company tax settings
    await context.db('company_tax_settings').insert({
      company_id: company_id,
      tenant: context.tenantId,
      tax_rate_id: nyTaxRateId,
      is_reverse_charge_applicable: false
    });

    // Set up company billing settings with expiration days
    await context.db('company_billing_settings').insert({
      company_id: company_id,
      tenant: context.tenantId,
      zero_dollar_invoice_handling: 'normal',
      suppress_zero_dollar_invoices: false,
      credit_expiration_days: 30,
      credit_expiration_notification_days: [7, 1],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    // Create services with negative rates (credits)
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

    // Create a billing plan
    const planId = await context.createEntity('billing_plans', {
      plan_name: 'Credit Plan',
      billing_frequency: 'monthly',
      is_custom: false,
      plan_type: 'Fixed'
    }, 'plan_id');

    // Assign services to plan
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

    // Create billing cycle
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

    // Assign plan to company
    await context.db('company_billing_plans').insert({
      company_billing_plan_id: uuidv4(),
      company_id: company_id,
      plan_id: planId,
      tenant: context.tenantId,
      start_date: startDate,
      is_active: true
    });

    // Step 1: Generate invoice with negative total
    const invoice = await generateInvoice(billingCycleId);
    
    if (!invoice) {
      throw new Error('Failed to generate invoice');
    }
    
    // Verify the invoice has a negative total
    expect(invoice.total_amount).toBeLessThan(0);
    const negativeAmount = invoice.total_amount;
    const creditAmount = Math.abs(negativeAmount);
    
    // Step 2: Finalize the invoice to trigger credit creation
    await finalizeInvoice(invoice.invoice_id);
    
    // Step 3: Verify credit transaction has expiration date
    const creditTransaction = await context.db('transactions')
      .where({
        company_id: company_id,
        invoice_id: invoice.invoice_id,
        type: 'credit_issuance_from_negative_invoice'
      })
      .first();
    
    // Verify transaction details
    expect(creditTransaction).toBeTruthy();
    expect(parseFloat(creditTransaction.amount)).toBe(creditAmount);
    expect(creditTransaction.expiration_date).toBeTruthy();
    
    // Verify the expiration date is approximately 30 days from now
    const expirationDate = new Date(creditTransaction.expiration_date);
    const today = new Date();
    const daysDiff = Math.round((expirationDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    expect(daysDiff).toBeCloseTo(30, 1); // Allow for small time differences during test execution
    
    // Step 4: Verify credit tracking entry was created
    const creditTracking = await context.db('credit_tracking')
      .where({
        transaction_id: creditTransaction.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    expect(creditTracking).toBeTruthy();
    expect(parseInt(creditTracking.amount.toString())).toEqual(creditAmount);
    expect(parseInt(creditTracking.remaining_amount.toString())).toEqual(creditAmount);
    expect(toPlainDate(creditTracking.expiration_date)).toEqual(toPlainDate(creditTransaction.expiration_date));
    expect(creditTracking.is_expired).toBe(false);
  });

  it('should use default billing settings for credit expiration when company settings are not available', async () => {
    // Create test company
    const company_id = await context.createEntity<ICompany>('companies', {
      company_name: 'Default Settings Company',
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

    // Create NY tax rate
    const nyTaxRateId = await context.createEntity('tax_rates', {
      region: 'US-NY',
      tax_percentage: 10.0,
      description: 'NY Test Tax',
      start_date: '2025-01-01'
    }, 'tax_rate_id');

    // Set up company tax settings
    await context.db('company_tax_settings').insert({
      company_id: company_id,
      tenant: context.tenantId,
      tax_rate_id: nyTaxRateId,
      is_reverse_charge_applicable: false
    });

    // Set up default billing settings with expiration days using upsert pattern
    await context.db('default_billing_settings')
      .insert({
        tenant: context.tenantId,
        zero_dollar_invoice_handling: 'normal',
        suppress_zero_dollar_invoices: false,
        credit_expiration_days: 60, // Different from company settings to verify it's used
        credit_expiration_notification_days: [14, 7, 1],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .onConflict('tenant')
      .merge(); // This will update existing records if there's a conflict

    // Create services with negative rates (credits)
    const serviceA = await context.createEntity('service_catalog', {
      service_name: 'Credit Service A',
      service_type: 'Fixed',
      default_rate: -5000, // -$50.00
      unit_of_measure: 'unit',
      tax_region: 'US-NY',
      is_taxable: true
    }, 'service_id');

    // Create a billing plan
    const planId = await context.createEntity('billing_plans', {
      plan_name: 'Credit Plan',
      billing_frequency: 'monthly',
      is_custom: false,
      plan_type: 'Fixed'
    }, 'plan_id');

    // Assign services to plan
    await context.db('plan_services').insert({
      plan_id: planId,
      service_id: serviceA,
      quantity: 1,
      tenant: context.tenantId
    });

    // Create billing cycle
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

    // Assign plan to company
    await context.db('company_billing_plans').insert({
      company_billing_plan_id: uuidv4(),
      company_id: company_id,
      plan_id: planId,
      tenant: context.tenantId,
      start_date: startDate,
      is_active: true
    });

    // Step 1: Generate invoice with negative total
    const invoice = await generateInvoice(billingCycleId);
    
    if (!invoice) {
      throw new Error('Failed to generate invoice');
    }
    
    // Step 2: Finalize the invoice to trigger credit creation
    await finalizeInvoice(invoice.invoice_id);
    
    // Step 3: Verify credit transaction has expiration date from default settings
    const creditTransaction = await context.db('transactions')
      .where({
        company_id: company_id,
        invoice_id: invoice.invoice_id,
        type: 'credit_issuance_from_negative_invoice'
      })
      .first();
    
    // Verify transaction details
    expect(creditTransaction).toBeTruthy();
    expect(creditTransaction.expiration_date).toBeTruthy();
    
    // Verify the expiration date is approximately 60 days from now (from default settings)
    const expirationDate = new Date(creditTransaction.expiration_date);
    const today = new Date();
    const daysDiff = Math.round((expirationDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    expect(daysDiff).toBeCloseTo(60, 1); // Allow for small time differences during test execution
    
    // Step 4: Verify credit tracking entry was created with same expiration date
    const creditTracking = await context.db('credit_tracking')
      .where({
        transaction_id: creditTransaction.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    expect(creditTracking).toBeTruthy();
    expect(toPlainDate(creditTracking.expiration_date)).toEqual(toPlainDate(creditTransaction.expiration_date));
  });

  it('should prioritize credits by expiration date when applying to invoices', async () => {
    // Create test company
    const company_id = await context.createEntity<ICompany>('companies', {
      company_name: 'Credit Prioritization Company',
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

    // Create NY tax rate
    const nyTaxRateId = await context.createEntity('tax_rates', {
      region: 'US-NY',
      tax_percentage: 10.0,
      description: 'NY Test Tax',
      start_date: '2025-01-01'
    }, 'tax_rate_id');

    // Set up company tax settings
    await context.db('company_tax_settings').insert({
      company_id: company_id,
      tenant: context.tenantId,
      tax_rate_id: nyTaxRateId,
      is_reverse_charge_applicable: false
    });

    // Create a service for the invoice
    const service = await context.createEntity('service_catalog', {
      service_name: 'Standard Service',
      service_type: 'Fixed',
      default_rate: 20000, // $200.00
      unit_of_measure: 'unit',
      tax_region: 'US-NY',
      is_taxable: true
    }, 'service_id');

    // Create a billing plan
    const planId = await context.createEntity('billing_plans', {
      plan_name: 'Standard Plan',
      billing_frequency: 'monthly',
      is_custom: false,
      plan_type: 'Fixed'
    }, 'plan_id');

    // Link service to plan
    await context.db('plan_services').insert({
      plan_id: planId,
      service_id: service,
      tenant: context.tenantId,
      quantity: 1
    });

    // Create billing cycle
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

    // Link plan to company
    await context.db('company_billing_plans').insert({
      company_billing_plan_id: uuidv4(),
      company_id: company_id,
      plan_id: planId,
      tenant: context.tenantId,
      start_date: startDate,
      is_active: true
    });

    // Step 1: Create three credit transactions with different expiration dates
    const today = new Date();
    
    // Credit 1: Expires in 30 days (should be used first)
    const expDate1 = new Date(today);
    expDate1.setDate(today.getDate() + 30);
    const expirationDate1 = expDate1.toISOString();
    
    // Credit 2: Expires in 60 days (should be used second)
    const expDate2 = new Date(today);
    expDate2.setDate(today.getDate() + 60);
    const expirationDate2 = expDate2.toISOString();
    
    // Credit 3: No expiration date (should be used last)
    const expirationDate3 = null;
    
    // Create credit transactions and tracking entries
    const transactionId1 = uuidv4();
    const transactionId2 = uuidv4();
    const transactionId3 = uuidv4();
    
    // Create transactions
    await context.db('transactions').insert([
      {
        transaction_id: transactionId1,
        company_id: company_id,
        amount: 5000, // $50.00
        type: 'credit_issuance',
        status: 'completed',
        description: 'Credit 1 - Expires in 30 days',
        created_at: new Date().toISOString(),
        balance_after: 5000,
        tenant: context.tenantId,
        expiration_date: expirationDate1
      },
      {
        transaction_id: transactionId2,
        company_id: company_id,
        amount: 7000, // $70.00
        type: 'credit_issuance',
        status: 'completed',
        description: 'Credit 2 - Expires in 60 days',
        created_at: new Date().toISOString(),
        balance_after: 12000,
        tenant: context.tenantId,
        expiration_date: expirationDate2
      },
      {
        transaction_id: transactionId3,
        company_id: company_id,
        amount: 8000, // $80.00
        type: 'credit_issuance',
        status: 'completed',
        description: 'Credit 3 - No expiration',
        created_at: new Date().toISOString(),
        balance_after: 20000,
        tenant: context.tenantId,
        expiration_date: expirationDate3
      }
    ]);
    
    // Create credit tracking entries
    await context.db('credit_tracking').insert([
      {
        credit_id: uuidv4(),
        tenant: context.tenantId,
        company_id: company_id,
        transaction_id: transactionId1,
        amount: 5000,
        remaining_amount: 5000,
        created_at: new Date().toISOString(),
        expiration_date: expirationDate1,
        is_expired: false,
        updated_at: new Date().toISOString()
      },
      {
        credit_id: uuidv4(),
        tenant: context.tenantId,
        company_id: company_id,
        transaction_id: transactionId2,
        amount: 7000,
        remaining_amount: 7000,
        created_at: new Date().toISOString(),
        expiration_date: expirationDate2,
        is_expired: false,
        updated_at: new Date().toISOString()
      },
      {
        credit_id: uuidv4(),
        tenant: context.tenantId,
        company_id: company_id,
        transaction_id: transactionId3,
        amount: 8000,
        remaining_amount: 8000,
        created_at: new Date().toISOString(),
        expiration_date: expirationDate3,
        is_expired: false,
        updated_at: new Date().toISOString()
      }
    ]);
    
    // Update company credit balance
    await context.db('companies')
      .where({ company_id: company_id, tenant: context.tenantId })
      .update({ credit_balance: 20000 });
    
    // Step 2: Generate an invoice
    const invoice = await generateInvoice(billingCycleId);
    
    if (!invoice) {
      throw new Error('Failed to generate invoice');
    }
    
    // Step 3: Apply credit to the invoice (should use credits in order of expiration date)
    await applyCreditToInvoice(company_id, invoice.invoice_id, 15000); // Apply $150 of credit
    
    // Step 4: Verify credit application
    // Get updated credit tracking entries
    const updatedCreditEntries = await context.db('credit_tracking')
      .where({ company_id: company_id, tenant: context.tenantId })
      .orderBy('expiration_date', 'asc');
    
    // Credit 1 (expires in 30 days) should be fully used
    expect(Number(updatedCreditEntries[0].remaining_amount)).toBe(0);
    
    // Credit 2 (expires in 60 days) should be partially used (7000 - (15000 - 5000) = 0)
    expect(Number(updatedCreditEntries[1].remaining_amount)).toBe(0);
    
    // Credit 3 (no expiration) should be partially used (8000 - (15000 - 5000 - 7000) = 5000)
    expect(Number(updatedCreditEntries[2].remaining_amount)).toBe(5000);
    
    // Verify the credit application transaction
    const creditApplicationTx = await context.db('transactions')
      .where({
        company_id: company_id,
        invoice_id: invoice.invoice_id,
        type: 'credit_application'
      })
      .first();
    
    expect(creditApplicationTx).toBeTruthy();
    expect(parseFloat(creditApplicationTx.amount)).toBe(-15000);
    
    // Verify the metadata contains the applied credits
    expect(creditApplicationTx.metadata).toBeTruthy();
    const metadata = typeof creditApplicationTx.metadata === 'string'
      ? JSON.parse(creditApplicationTx.metadata)
      : creditApplicationTx.metadata;
    
    expect(metadata.applied_credits).toBeTruthy();
    expect(metadata.applied_credits.length).toBe(3);
    
    // Verify the applied credits are in the correct order
    expect(metadata.applied_credits[0].transactionId).toBe(transactionId1);
    expect(metadata.applied_credits[1].transactionId).toBe(transactionId2);
    expect(metadata.applied_credits[2].transactionId).toBe(transactionId3);
    
    // Verify the amounts applied from each credit
    expect(metadata.applied_credits[0].amount).toBe(5000);
    expect(metadata.applied_credits[1].amount).toBe(7000);
    expect(metadata.applied_credits[2].amount).toBe(3000);
    
    // Verify the invoice was updated correctly
    const updatedInvoice = await context.db('invoices')
      .where({ invoice_id: invoice.invoice_id, tenant: context.tenantId })
      .first();
    
    expect(updatedInvoice.credit_applied).toBe(15000);
    
    // Verify the company credit balance was updated
    const updatedCompany = await context.db('companies')
      .where({ company_id: company_id, tenant: context.tenantId })
      .first();
    
    expect(updatedCompany.credit_balance).toBe(5000);
  });

  it('should correctly apply partial credit across multiple invoices', async () => {
    // Create test company
    const company_id = await context.createEntity<ICompany>('companies', {
      company_name: 'Multiple Invoice Credit Company',
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

    // Create NY tax rate - make sure it's active and has appropriate date range
    const nyTaxRateId = await context.createEntity('tax_rates', {
      region: 'US-NY',
      tax_percentage: 10.0, // 10% for easy calculation
      description: 'NY Test Tax',
      start_date: '2020-01-01', // Use an earlier date to ensure it's valid for our test dates
      is_active: true, // Explicitly set as active
      tax_type: 'Sales Tax',
      tenant: context.tenantId
    }, 'tax_rate_id');

    // Set up company tax settings
    await context.db('company_tax_settings').insert({
      company_id: company_id,
      tenant: context.tenantId,
      tax_rate_id: nyTaxRateId,
      is_reverse_charge_applicable: false
    });

    // Create a single service for all invoices
    const service = await context.createEntity('service_catalog', {
      service_name: 'Standard Service',
      service_type: 'Fixed',
      default_rate: 10000, // $100.00
      unit_of_measure: 'unit',
      tax_region: 'US-NY',
      is_taxable: true
    }, 'service_id');

    // Create a single billing plan
    const planId = await context.createEntity('billing_plans', {
      plan_name: 'Standard Plan',
      billing_frequency: 'monthly',
      is_custom: false,
      plan_type: 'Fixed'
    }, 'plan_id');

    // Link service to plan
    await context.db('plan_services').insert({
      plan_id: planId,
      service_id: service,
      tenant: context.tenantId,
      quantity: 1
    });

    // Create billing cycles for three consecutive months
    const now = createTestDate();
    
    // First billing cycle (3 months ago)
    const startDate1 = Temporal.PlainDate.from(now).subtract({ months: 3 }).toString();
    const endDate1 = Temporal.PlainDate.from(now).subtract({ months: 2 }).toString();
    
    const billingCycleId1 = await context.createEntity('company_billing_cycles', {
      company_id: company_id,
      billing_cycle: 'monthly',
      period_start_date: startDate1,
      period_end_date: endDate1,
      effective_date: startDate1
    }, 'billing_cycle_id');

    // Second billing cycle (2 months ago)
    const startDate2 = Temporal.PlainDate.from(now).subtract({ months: 2 }).toString();
    const endDate2 = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();
    
    const billingCycleId2 = await context.createEntity('company_billing_cycles', {
      company_id: company_id,
      billing_cycle: 'monthly',
      period_start_date: startDate2,
      period_end_date: endDate2,
      effective_date: startDate2
    }, 'billing_cycle_id');

    // Third billing cycle (1 month ago)
    const startDate3 = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();
    const endDate3 = Temporal.PlainDate.from(now).toString();
    
    const billingCycleId3 = await context.createEntity('company_billing_cycles', {
      company_id: company_id,
      billing_cycle: 'monthly',
      period_start_date: startDate3,
      period_end_date: endDate3,
      effective_date: startDate3
    }, 'billing_cycle_id');

    // Link the same plan to company for all billing cycles
    await context.db('company_billing_plans').insert([
      {
        company_billing_plan_id: uuidv4(),
        company_id: company_id,
        plan_id: planId,
        tenant: context.tenantId,
        start_date: startDate1,
        is_active: true
      }
    ]);

    // Step 1: Create prepayment invoice with credit amount that will cover multiple invoices
    const prepaymentAmount = 20000; // $200.00 credit
    const prepaymentInvoice = await createPrepaymentInvoice(company_id, prepaymentAmount);
    
    // Step 2: Finalize the prepayment invoice to add credit to the company
    await finalizeInvoice(prepaymentInvoice.invoice_id);
    
    // Step 3: Verify initial credit balance
    const initialCredit = await CompanyBillingPlan.getCompanyCredit(company_id);
    expect(initialCredit).toBe(prepaymentAmount);
    console.log('Initial credit balance:', initialCredit);
    
    // Step 4: Generate invoices for each billing cycle
    const invoice1 = await generateInvoice(billingCycleId1); // Basic service ($50 + $5 tax = $55)
    const invoice2 = await generateInvoice(billingCycleId2); // Standard service ($100 + $10 tax = $110)
    const invoice3 = await generateInvoice(billingCycleId3); // Premium service ($150 + $15 tax = $165)
    
    if (!invoice1 || !invoice2 || !invoice3) {
      throw new Error('Failed to generate one or more invoices');
    }
    
    console.log('Generated invoices:', {
      invoice1: { id: invoice1.invoice_id, total: invoice1.total_amount },
      invoice2: { id: invoice2.invoice_id, total: invoice2.total_amount },
      invoice3: { id: invoice3.invoice_id, total: invoice3.total_amount }
    });
    
    // Step 5: Finalize the first invoice and verify credit application
    await finalizeInvoice(invoice1.invoice_id);
    
    // Get the updated invoice
    const updatedInvoice1 = await context.db('invoices')
      .where({ invoice_id: invoice1.invoice_id })
      .first();
    
    // Calculate expected values for first invoice
    const subtotal1 = 10000; // $100.00
    const tax1 = 1000;      // $10.00 (10% of $100)
    const totalBeforeCredit1 = subtotal1 + tax1; // $110.00
    const expectedAppliedCredit1 = totalBeforeCredit1; // $110.00 (full invoice amount)
    const expectedRemainingCredit1 = prepaymentAmount - expectedAppliedCredit1; // $200 - $110 = $90
    
    // Verify first invoice values
    expect(updatedInvoice1.subtotal).toBe(subtotal1);
    expect(updatedInvoice1.tax).toBe(tax1);
    expect(updatedInvoice1.credit_applied).toBe(expectedAppliedCredit1);
    expect(parseInt(updatedInvoice1.total_amount)).toBe(0); // Invoice should be fully paid
    
    // Verify credit balance after first invoice
    const creditAfterInvoice1 = await CompanyBillingPlan.getCompanyCredit(company_id);
    expect(creditAfterInvoice1).toBe(expectedRemainingCredit1);
    console.log('Credit balance after first invoice:', creditAfterInvoice1);
    
    // Verify credit application transaction for first invoice
    const creditTransaction1 = await context.db('transactions')
      .where({
        company_id: company_id,
        invoice_id: invoice1.invoice_id,
        type: 'credit_application'
      })
      .first();
    
    expect(creditTransaction1).toBeTruthy();
    expect(parseFloat(creditTransaction1.amount)).toBe(-expectedAppliedCredit1);
    expect(creditTransaction1.description).toContain('Applied credit to invoice');
    
    // Step 6: Finalize the second invoice and verify credit application
    await finalizeInvoice(invoice2.invoice_id);
    
    // Get the updated invoice
    const updatedInvoice2 = await context.db('invoices')
      .where({ invoice_id: invoice2.invoice_id })
      .first();
    
    // Calculate expected values for second invoice
    const subtotal2 = 10000; // $100.00
    const tax2 = 1000;      // $10.00 (10% of $100)
    const totalBeforeCredit2 = subtotal2 + tax2; // $110.00
    const expectedAppliedCredit2 = expectedRemainingCredit1; // $90.00 (all remaining credit)
    const expectedRemainingCredit2 = 0; // All credit has been applied
    const expectedRemainingTotal2 = totalBeforeCredit2 - expectedAppliedCredit2; // $110 - $90 = $20
    
    // Verify second invoice values
    expect(updatedInvoice2.subtotal).toBe(subtotal2);
    expect(updatedInvoice2.tax).toBe(tax2);
    expect(updatedInvoice2.credit_applied).toBe(expectedAppliedCredit2);
    expect(parseInt(updatedInvoice2.total_amount)).toBe(expectedRemainingTotal2); // Invoice should be partially paid
    
    // Verify credit balance after second invoice
    const creditAfterInvoice2 = await CompanyBillingPlan.getCompanyCredit(company_id);
    expect(creditAfterInvoice2).toBe(expectedRemainingCredit2);
    console.log('Credit balance after second invoice:', creditAfterInvoice2);
    
    // Verify credit application transaction for second invoice
    const creditTransaction2 = await context.db('transactions')
      .where({
        company_id: company_id,
        invoice_id: invoice2.invoice_id,
        type: 'credit_application'
      })
      .first();
    
    expect(creditTransaction2).toBeTruthy();
    expect(parseFloat(creditTransaction2.amount)).toBe(-expectedAppliedCredit2);
    expect(creditTransaction2.description).toContain('Applied credit to invoice');
    
    // Calculate expected values for third invoice
    const subtotal3 = 10000; // $100.00
    const tax3 = 1000;      // $10.00 (10% of $100)
    const totalBeforeCredit3 = subtotal3 + tax3; // $110.00
    const expectedAppliedCredit3 = expectedRemainingCredit2; // $0 (no remaining credit)
    const expectedRemainingTotal3 = totalBeforeCredit3 - expectedAppliedCredit3; // $110 - $0 = $110
    
    // Step 7: Finalize the third invoice - credit should be automatically applied
    await finalizeInvoice(invoice3.invoice_id);
    
    // Get the updated invoice
    const updatedInvoice3 = await context.db('invoices')
      .where({ invoice_id: invoice3.invoice_id })
      .first();
    
    // Verify third invoice values after manual credit application
    expect(updatedInvoice3.subtotal).toBe(subtotal3);
    expect(updatedInvoice3.tax).toBe(tax3);
    expect(updatedInvoice3.credit_applied).toBe(expectedAppliedCredit3);
    expect(parseInt(updatedInvoice3.total_amount)).toBe(expectedRemainingTotal3); // Invoice should be partially paid
    
    // Verify credit balance is now zero
    const finalCredit = await CompanyBillingPlan.getCompanyCredit(company_id);
    expect(finalCredit).toBe(0);
    console.log('Final credit balance:', finalCredit);
    
    // Since there's no credit left to apply to the third invoice,
    // there should be no credit application transaction
    const creditTransaction3 = await context.db('transactions')
      .where({
        company_id: company_id,
        invoice_id: invoice3.invoice_id,
        type: 'credit_application'
      })
      .first();
    
    // No credit transaction should exist for the third invoice
    expect(creditTransaction3).toBeUndefined();
    
    // Summary verification
    console.log('Credit application summary:', {
      initialCredit: prepaymentAmount,
      invoice1Applied: expectedAppliedCredit1,
      invoice2Applied: expectedAppliedCredit2,
      invoice3Applied: expectedAppliedCredit3,
      totalApplied: expectedAppliedCredit1 + expectedAppliedCredit2 + expectedAppliedCredit3,
      finalCreditBalance: finalCredit
    });
    
    // Verify total credit applied equals initial credit amount
    expect(expectedAppliedCredit1 + expectedAppliedCredit2 + expectedAppliedCredit3).toBe(prepaymentAmount);
  });

  it('should correctly apply partial credit across three invoices with partial credit on the third', async () => {
    // Create test company
    const company_id = await context.createEntity<ICompany>('companies', {
      company_name: 'Three Invoice Credit Company',
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

    // Create NY tax rate - make sure it's active and has appropriate date range
    const nyTaxRateId = await context.createEntity('tax_rates', {
      region: 'US-NY',
      tax_percentage: 10.0, // 10% for easy calculation
      description: 'NY Test Tax',
      start_date: '2020-01-01', // Use an earlier date to ensure it's valid for our test dates
      is_active: true, // Explicitly set as active
      tax_type: 'Sales Tax',
      tenant: context.tenantId
    }, 'tax_rate_id');

    // Set up company tax settings
    await context.db('company_tax_settings').insert({
      company_id: company_id,
      tenant: context.tenantId,
      tax_rate_id: nyTaxRateId,
      is_reverse_charge_applicable: false
    });

    // Create a single service for all invoices
    const service = await context.createEntity('service_catalog', {
      service_name: 'Standard Service',
      service_type: 'Fixed',
      default_rate: 10000, // $100.00
      unit_of_measure: 'unit',
      tax_region: 'US-NY',
      is_taxable: true
    }, 'service_id');

    // Create a single billing plan
    const planId = await context.createEntity('billing_plans', {
      plan_name: 'Standard Plan',
      billing_frequency: 'monthly',
      is_custom: false,
      plan_type: 'Fixed'
    }, 'plan_id');

    // Link service to plan
    await context.db('plan_services').insert({
      plan_id: planId,
      service_id: service,
      tenant: context.tenantId,
      quantity: 1
    });

    // Create billing cycles for three consecutive months
    const now = createTestDate();
    
    // First billing cycle (3 months ago)
    const startDate1 = Temporal.PlainDate.from(now).subtract({ months: 3 }).toString();
    const endDate1 = Temporal.PlainDate.from(now).subtract({ months: 2 }).toString();
    
    const billingCycleId1 = await context.createEntity('company_billing_cycles', {
      company_id: company_id,
      billing_cycle: 'monthly',
      period_start_date: startDate1,
      period_end_date: endDate1,
      effective_date: startDate1
    }, 'billing_cycle_id');

    // Second billing cycle (2 months ago)
    const startDate2 = Temporal.PlainDate.from(now).subtract({ months: 2 }).toString();
    const endDate2 = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();
    
    const billingCycleId2 = await context.createEntity('company_billing_cycles', {
      company_id: company_id,
      billing_cycle: 'monthly',
      period_start_date: startDate2,
      period_end_date: endDate2,
      effective_date: startDate2
    }, 'billing_cycle_id');

    // Third billing cycle (1 month ago)
    const startDate3 = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();
    const endDate3 = Temporal.PlainDate.from(now).toString();
    
    const billingCycleId3 = await context.createEntity('company_billing_cycles', {
      company_id: company_id,
      billing_cycle: 'monthly',
      period_start_date: startDate3,
      period_end_date: endDate3,
      effective_date: startDate3
    }, 'billing_cycle_id');

    // Link the same plan to company for all billing cycles
    await context.db('company_billing_plans').insert([
      {
        company_billing_plan_id: uuidv4(),
        company_id: company_id,
        plan_id: planId,
        tenant: context.tenantId,
        start_date: startDate1,
        is_active: true
      }
    ]);

    // Step 1: Create prepayment invoice with credit amount that will cover multiple invoices
    // and partially cover the third invoice
    const prepaymentAmount = 25000; // $250.00 credit (enough for 2 full invoices + partial third)
    const prepaymentInvoice = await createPrepaymentInvoice(company_id, prepaymentAmount);
    
    // Step 2: Finalize the prepayment invoice to add credit to the company
    await finalizeInvoice(prepaymentInvoice.invoice_id);
    
    // Step 3: Verify initial credit balance
    const initialCredit = await CompanyBillingPlan.getCompanyCredit(company_id);
    expect(initialCredit).toBe(prepaymentAmount);
    console.log('Initial credit balance:', initialCredit);
    
    // Step 4: Generate invoices for each billing cycle
    const invoice1 = await generateInvoice(billingCycleId1);
    const invoice2 = await generateInvoice(billingCycleId2);
    const invoice3 = await generateInvoice(billingCycleId3);
    
    if (!invoice1 || !invoice2 || !invoice3) {
      throw new Error('Failed to generate one or more invoices');
    }
    
    console.log('Generated invoices:', {
      invoice1: { id: invoice1.invoice_id, total: invoice1.total_amount },
      invoice2: { id: invoice2.invoice_id, total: invoice2.total_amount },
      invoice3: { id: invoice3.invoice_id, total: invoice3.total_amount }
    });
    
    // Step 5: Finalize the first invoice and verify credit application
    await finalizeInvoice(invoice1.invoice_id);
    
    // Get the updated invoice
    const updatedInvoice1 = await context.db('invoices')
      .where({ invoice_id: invoice1.invoice_id })
      .first();
    
    // Calculate expected values for first invoice
    const subtotal1 = 10000; // $100.00
    const tax1 = 1000;      // $10.00 (10% of $100)
    const totalBeforeCredit1 = subtotal1 + tax1; // $110.00
    const expectedAppliedCredit1 = totalBeforeCredit1; // $110.00 (full invoice amount)
    const expectedRemainingCredit1 = prepaymentAmount - expectedAppliedCredit1; // $250 - $110 = $140
    
    // Verify first invoice values
    expect(updatedInvoice1.subtotal).toBe(subtotal1);
    expect(updatedInvoice1.tax).toBe(tax1);
    expect(updatedInvoice1.credit_applied).toBe(expectedAppliedCredit1);
    expect(parseInt(updatedInvoice1.total_amount)).toBe(0); // Invoice should be fully paid
    
    // Verify credit balance after first invoice
    const creditAfterInvoice1 = await CompanyBillingPlan.getCompanyCredit(company_id);
    expect(creditAfterInvoice1).toBe(expectedRemainingCredit1);
    console.log('Credit balance after first invoice:', creditAfterInvoice1);
    
    // Verify credit application transaction for first invoice
    const creditTransaction1 = await context.db('transactions')
      .where({
        company_id: company_id,
        invoice_id: invoice1.invoice_id,
        type: 'credit_application'
      })
      .first();
    
    expect(creditTransaction1).toBeTruthy();
    expect(parseFloat(creditTransaction1.amount)).toBe(-expectedAppliedCredit1);
    expect(creditTransaction1.description).toContain('Applied credit to invoice');
    
    // Step 6: Finalize the second invoice and verify credit application
    await finalizeInvoice(invoice2.invoice_id);
    
    // Get the updated invoice
    const updatedInvoice2 = await context.db('invoices')
      .where({ invoice_id: invoice2.invoice_id })
      .first();
    
    // Calculate expected values for second invoice
    const subtotal2 = 10000; // $100.00
    const tax2 = 1000;      // $10.00 (10% of $100)
    const totalBeforeCredit2 = subtotal2 + tax2; // $110.00
    const expectedAppliedCredit2 = totalBeforeCredit2; // $110.00 (full invoice amount)
    const expectedRemainingCredit2 = expectedRemainingCredit1 - expectedAppliedCredit2; // $140 - $110 = $30
    
    // Verify second invoice values
    expect(updatedInvoice2.subtotal).toBe(subtotal2);
    expect(updatedInvoice2.tax).toBe(tax2);
    expect(updatedInvoice2.credit_applied).toBe(expectedAppliedCredit2);
    expect(parseInt(updatedInvoice2.total_amount)).toBe(0); // Invoice should be fully paid
    
    // Verify credit balance after second invoice
    const creditAfterInvoice2 = await CompanyBillingPlan.getCompanyCredit(company_id);
    expect(creditAfterInvoice2).toBe(expectedRemainingCredit2);
    console.log('Credit balance after second invoice:', creditAfterInvoice2);
    
    // Verify credit application transaction for second invoice
    const creditTransaction2 = await context.db('transactions')
      .where({
        company_id: company_id,
        invoice_id: invoice2.invoice_id,
        type: 'credit_application'
      })
      .first();
    
    expect(creditTransaction2).toBeTruthy();
    expect(parseFloat(creditTransaction2.amount)).toBe(-expectedAppliedCredit2);
    expect(creditTransaction2.description).toContain('Applied credit to invoice');
    
    // Calculate expected values for third invoice
    const subtotal3 = 10000; // $100.00
    const tax3 = 1000;      // $10.00 (10% of $100)
    const totalBeforeCredit3 = subtotal3 + tax3; // $110.00
    const expectedAppliedCredit3 = expectedRemainingCredit2; // $30.00 (partial credit)
    const expectedRemainingTotal3 = totalBeforeCredit3 - expectedAppliedCredit3; // $110 - $30 = $80
    
    // Step 7: Finalize the third invoice - credit should be automatically applied
    await finalizeInvoice(invoice3.invoice_id);
    
    // Get the updated invoice
    const updatedInvoice3 = await context.db('invoices')
      .where({ invoice_id: invoice3.invoice_id })
      .first();
    
    // Verify third invoice values after credit application
    expect(updatedInvoice3.subtotal).toBe(subtotal3);
    expect(updatedInvoice3.tax).toBe(tax3);
    expect(updatedInvoice3.credit_applied).toBe(expectedAppliedCredit3);
    expect(parseInt(updatedInvoice3.total_amount)).toBe(expectedRemainingTotal3); // Invoice should be partially paid
    
    // Verify credit balance is now zero
    const finalCredit = await CompanyBillingPlan.getCompanyCredit(company_id);
    expect(finalCredit).toBe(0);
    console.log('Final credit balance:', finalCredit);
    
    // Verify credit application transaction for third invoice
    const creditTransaction3 = await context.db('transactions')
      .where({
        company_id: company_id,
        invoice_id: invoice3.invoice_id,
        type: 'credit_application'
      })
      .first();
    
    // There should be a credit transaction for the third invoice
    expect(creditTransaction3).toBeTruthy();
    expect(parseFloat(creditTransaction3.amount)).toBe(-expectedAppliedCredit3);
    expect(creditTransaction3.description).toContain('Applied credit to invoice');
    
    // Summary verification
    console.log('Credit application summary:', {
      initialCredit: prepaymentAmount,
      invoice1Applied: expectedAppliedCredit1,
      invoice2Applied: expectedAppliedCredit2,
      invoice3Applied: expectedAppliedCredit3,
      totalApplied: expectedAppliedCredit1 + expectedAppliedCredit2 + expectedAppliedCredit3,
      finalCreditBalance: finalCredit
    });
    
    // Verify total credit applied equals initial credit amount
    expect(expectedAppliedCredit1 + expectedAppliedCredit2 + expectedAppliedCredit3).toBe(prepaymentAmount);
  });
});
