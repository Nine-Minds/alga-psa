import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import '../../../test-utils/nextApiMock';
import { TestContext } from '../../../test-utils/testContext';
import { generateInvoice } from '@/lib/actions/invoiceActions';
import { createDefaultTaxSettings } from '@/lib/actions/taxSettingsActions';
import { v4 as uuidv4 } from 'uuid';
import type { ICompany } from '../../interfaces/company.interfaces';
import { Temporal } from '@js-temporal/polyfill';
import { generateManualInvoice } from '@/lib/actions/manualInvoiceActions';

describe('Billing Invoice Subtotal Calculations', () => {
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
        'company_tax_settings'
      ],
      companyName: 'Test Company',
      userType: 'internal'
    });

    // Create default tax settings and billing settings
    await createDefaultTaxSettings(context.company.company_id);
  });

  afterAll(async () => {
    await testHelpers.afterAll();
  });

  it('should correctly handle rounding behavior for subtotal calculations with fractional amounts', async () => {
    // Create a manual invoice with fractional quantities to test rounding behavior
    const serviceA = await context.createEntity('service_catalog', {
      service_name: 'Fractional Service A',
      service_type: 'Fixed',
      default_rate: 9999, // $99.99 (stored in cents)
      unit_of_measure: 'hour',
      is_taxable: false
    }, 'service_id');
    
    const serviceB = await context.createEntity('service_catalog', {
      service_name: 'Fractional Service B',
      service_type: 'Fixed',
      default_rate: 14995, // $149.95 (stored in cents)
      unit_of_measure: 'hour',
      is_taxable: false
    }, 'service_id');

    // Generate invoice with fractional quantities (using whole numbers for rates since they're in cents)
    const invoice = await generateManualInvoice({
      companyId: context.companyId,
      items: [
        {
          service_id: serviceA,
          description: 'Fractional Service A',
          quantity: 3.33, // Fractional quantity
          rate: 9999 // $99.99 in cents
        },
        {
          service_id: serviceB,
          description: 'Fractional Service B',
          quantity: 2.5, // Fractional quantity
          rate: 14995 // $149.95 in cents
        }
      ]
    });

    // Get invoice items to verify individual calculations
    const invoiceItems = await context.db('invoice_items')
      .where({ invoice_id: invoice.invoice_id })
      .orderBy('created_at', 'asc');

    expect(invoiceItems).toHaveLength(2);
    
    // Calculate expected values - rates are already in cents
    const expectedItem1Amount = Math.round(3.33 * 9999); // Should be 33297 cents ($332.97)
    const expectedItem2Amount = Math.round(2.5 * 14995);  // Should be 37488 cents ($374.88)
    const expectedSubtotal = expectedItem1Amount + expectedItem2Amount; // Should be 70785 cents ($707.85)
    
    // Verify individual line item amounts are rounded correctly
    expect(parseInt(invoiceItems[0].net_amount)).toBe(expectedItem1Amount);
    expect(parseInt(invoiceItems[1].net_amount)).toBe(expectedItem2Amount);
    
    // Verify the invoice subtotal matches the sum of the rounded line item amounts
    expect(invoice.subtotal).toBe(expectedSubtotal);
    
    // Verify that manually calculating subtotal matches the system's calculation
    const calculatedSubtotal = invoiceItems.reduce((sum, item) => sum + parseInt(item.net_amount), 0);
    expect(calculatedSubtotal).toBe(expectedSubtotal);
    expect(calculatedSubtotal).toBe(invoice.subtotal);
  });

  it('should correctly calculate subtotal with multiple line items having different rates and quantities', async () => {
    // Create test company
    const company_id = await context.createEntity<ICompany>('companies', {
      company_name: 'Test Company 2',
      billing_cycle: 'monthly',
      company_id: uuidv4(),
      phone_no: '',
      credit_balance: 0,
      email: '',
      url: '',
      address: '',
      created_at: Temporal.Now.plainDateISO().toString(),
      updated_at: Temporal.Now.plainDateISO().toString(),
      is_inactive: false,
      is_tax_exempt: false
    }, 'company_id');

    // Create a billing plan
    const planId = await context.createEntity('billing_plans', {
      plan_name: 'Test Plan',
      billing_frequency: 'monthly',
      is_custom: false,
      plan_type: 'Fixed'
    }, 'plan_id');

    // Create services
    const serviceA = await context.createEntity('service_catalog', {
      service_name: 'Service A',
      description: 'Test service A',
      service_type: 'Fixed',
      default_rate: 5000, // $50.00
      unit_of_measure: 'unit'
    }, 'service_id');

    const serviceB = await context.createEntity('service_catalog', {
      service_name: 'Service B',
      description: 'Test service B',
      service_type: 'Fixed',
      default_rate: 7500, // $75.00
      unit_of_measure: 'unit'
    }, 'service_id');

    const serviceC = await context.createEntity('service_catalog', {
      service_name: 'Service C',
      description: 'Test service C',
      service_type: 'Fixed',
      default_rate: 10000, // $100.00
      unit_of_measure: 'unit'
    }, 'service_id');

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
      },
      {
        plan_id: planId,
        service_id: serviceC,
        quantity: 1,
        tenant: context.tenantId
      }
    ]);

    // Create billing cycle without proration
    const billingCycle = await context.createEntity('company_billing_cycles', {
      company_id: company_id,
      billing_cycle: 'monthly',
      effective_date: '2023-01-01',
      period_start_date: '2023-01-01',
      period_end_date: '2023-02-01'
    }, 'billing_cycle_id');

    // Assign plan to company
    await context.db('company_billing_plans').insert({
      company_billing_plan_id: uuidv4(),
      company_id: company_id,
      plan_id: planId,
      start_date: '2023-01-01',
      is_active: true,
      tenant: context.tenantId
    });

    // Generate invoice with multiple line items
    const invoice = await generateInvoice(billingCycle);

    // Verify subtotal calculation
    expect(invoice!.subtotal).toBe(22500); // $225.00 in cents
  });

  it('should correctly calculate subtotal with line items having zero quantity', async () => {
    // Create test company
    const company_id = await context.createEntity<ICompany>('companies', {
      company_name: 'Test Company 3',
      billing_cycle: 'monthly',
      company_id: uuidv4(),
      phone_no: '',
      credit_balance: 0,
      email: '',
      url: '',
      address: '',
      created_at: Temporal.Now.plainDateISO().toString(),
      updated_at: Temporal.Now.plainDateISO().toString(),
      is_inactive: false,
      is_tax_exempt: false
    }, 'company_id');

    // Create a billing plan
    const planId = await context.createEntity('billing_plans', {
      plan_name: 'Test Plan',
      billing_frequency: 'monthly',
      is_custom: false,
      plan_type: 'Fixed'
    }, 'plan_id');

    // Assign plan to company
    await context.db('company_billing_plans').insert({
      company_billing_plan_id: uuidv4(),
      company_id: company_id,
      plan_id: planId,
      start_date: '2023-01-01',
      is_active: true,
      tenant: context.tenantId
    });

    // Create billing cycle without proration
    const billingCycle = await context.createEntity('company_billing_cycles', {
      company_id: company_id,
      billing_cycle: 'monthly',
      effective_date: '2023-01-01',
      period_start_date: '2023-01-01',
      period_end_date: '2023-02-01',
      tenant: context.tenantId
    }, 'billing_cycle_id');

    // Create test services
    const serviceA = await context.createEntity('service_catalog', {
      service_name: 'Consulting',
      description: 'Professional consulting services',
      service_type: 'Fixed',
      default_rate: 5000, // $50.00
      unit_of_measure: 'hour'
    }, 'service_id');

    const serviceB = await context.createEntity('service_catalog', {
      service_name: 'Development',
      description: 'Software development services',
      service_type: 'Fixed',
      default_rate: 7500, // $75.00
      unit_of_measure: 'hour'
    }, 'service_id');

    const serviceC = await context.createEntity('service_catalog', {
      service_name: 'Training',
      description: 'Employee training services',
      service_type: 'Fixed',
      default_rate: 10000, // $100.00
      unit_of_measure: 'session'
    }, 'service_id');

    // First create the invoice
    const invoice = await context.createEntity('invoices', {
      company_id: company_id,
      invoice_number: 'INV-000001',
      invoice_date: new Date(),
      due_date: new Date(),
      total_amount: 0,
      status: 'DRAFT'
    }, 'invoice_id');

    // Create invoice items with zero quantity
    await context.createEntity('invoice_items', {
      invoice_id: invoice,
      service_id: serviceA,
      description: 'Consulting services',
      unit_price: 5000, // $50.00
      total_price: 0,
      quantity: 0
    }, 'item_id');

    await context.createEntity('invoice_items', {
      invoice_id: invoice,
      service_id: serviceB,
      description: 'Development services',
      unit_price: 7500, // $75.00
      total_price: 0,
      quantity: 0,
    }, 'item_id');

    await context.createEntity('invoice_items', {
      invoice_id: invoice,
      service_id: serviceC,
      description: 'Training services',
      unit_price: 10000, // $100.00
      total_price: 0,
      quantity: 0,
    }, 'item_id');

    // Generate invoice totals
    const updatedInvoice = await generateInvoice(billingCycle);

    // Verify subtotal is zero
    expect(updatedInvoice!.subtotal).toBe(0);
  });

  it('should correctly calculate subtotal with negative rates (credits)', async () => {
    // Create test company
    const company_id = await context.createEntity<ICompany>('companies', {
      company_name: 'Test Company 4',
      billing_cycle: 'monthly',
      company_id: uuidv4(),
      phone_no: '',
      credit_balance: 0,
      email: '',
      url: '',
      address: '',
      created_at: Temporal.Now.plainDateISO().toString(),
      updated_at: Temporal.Now.plainDateISO().toString(),
      is_inactive: false,
      is_tax_exempt: false
    }, 'company_id');

    // Create a billing plan
    const planId = await context.createEntity('billing_plans', {
      plan_name: 'Test Plan',
      billing_frequency: 'monthly',
      is_custom: false,
      plan_type: 'Fixed'
    }, 'plan_id');

    // Create services with negative rates
    const serviceA = await context.createEntity('service_catalog', {
      service_name: 'Credit A',
      description: 'Test credit A',
      service_type: 'Fixed',
      default_rate: -5000, // -$50.00
      unit_of_measure: 'unit'
    }, 'service_id');

    const serviceB = await context.createEntity('service_catalog', {
      service_name: 'Credit B',
      description: 'Test credit B',
      service_type: 'Fixed',
      default_rate: -7500, // -$75.00
      unit_of_measure: 'unit'
    }, 'service_id');

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
    const billingCycle = await context.createEntity('company_billing_cycles', {
      company_id: company_id,
      billing_cycle: 'monthly',
      effective_date: '2023-01-01',
      period_start_date: '2023-01-01',
      period_end_date: '2023-02-01'
    }, 'billing_cycle_id');

    // Assign plan to company
    await context.db('company_billing_plans').insert({
      company_billing_plan_id: uuidv4(),
      company_id: company_id,
      plan_id: planId,
      start_date: '2023-01-01',
      is_active: true,
      tenant: context.tenantId
    });

    // Generate invoice
    const invoice = await generateInvoice(billingCycle);

    // Verify subtotal calculation with negative rates
    expect(invoice!.subtotal).toBe(-12500); // -$125.00 in cents
  });
});