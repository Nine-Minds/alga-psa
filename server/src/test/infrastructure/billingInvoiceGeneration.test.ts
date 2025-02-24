import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import '../../../test-utils/nextApiMock';
import { TestContext } from '../../../test-utils/testContext';
import { generateInvoice } from '@/lib/actions/invoiceActions';
import { generateManualInvoice } from '@/lib/actions/manualInvoiceActions';
import { createDefaultTaxSettings } from '@/lib/actions/taxSettingsActions';
import { v4 as uuidv4 } from 'uuid';
import type { ICompany } from '../../interfaces/company.interfaces';
import type { IInvoice } from '../../interfaces/invoice.interfaces';
import { Temporal } from '@js-temporal/polyfill';

describe('Billing Invoice Generation', () => {
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

  describe('Tax Calculation', () => {
    it('should verify total calculation when subtotal is zero but tax is positive', async () => {
      // Create test company
      const company_id = await context.createEntity<ICompany>('companies', {
        company_name: 'Discount Tax Test Company',
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

      // Create NY tax rate (10% for easy calculation)
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

      // Create a service with a simple price
      const service = await context.createEntity('service_catalog', {
        service_name: 'Discounted Service',
        service_type: 'Fixed',
        default_rate: 10000, // $100.00
        unit_of_measure: 'unit',
        tax_region: 'US-NY',
        is_taxable: true
      }, 'service_id');

      // Create a billing plan
      const planId = await context.createEntity('billing_plans', {
        plan_name: 'Discount Test Plan',
        billing_frequency: 'monthly',
        is_custom: false,
        plan_type: 'Fixed'
      }, 'plan_id');

      // Assign service to plan
      await context.db('plan_services').insert({
        plan_id: planId,
        service_id: service,
        quantity: 1,
        tenant: context.tenantId
      });

      // Create billing cycle
      const billingCycle = await context.createEntity('company_billing_cycles', {
        company_id: company_id,
        billing_cycle: 'monthly',
        effective_date: '2025-02-01',
        period_start_date: '2025-02-01',
        period_end_date: '2025-03-01'
      }, 'billing_cycle_id');

      // Assign plan to company
      await context.db('company_billing_plans').insert({
        company_billing_plan_id: uuidv4(),
        company_id: company_id,
        plan_id: planId,
        start_date: '2025-02-01',
        is_active: true,
        tenant: context.tenantId
      });

      // Create a 100% discount service
      const discountService = await context.createEntity('service_catalog', {
        service_name: 'Full Discount',
        service_type: 'Fixed',
        default_rate: -10000, // -$100.00 to fully offset the original service
        unit_of_measure: 'unit',
        tax_region: 'US-NY',
        is_taxable: false // Discounts are not taxable
      }, 'service_id');

      // Add discount service to plan
      await context.db('plan_services').insert({
        plan_id: planId,
        service_id: discountService,
        quantity: 1,
        tenant: context.tenantId
      });

      // Generate invoice with both the original service and the discount
      const invoice = await generateInvoice(billingCycle);

      // Verify calculations:
      // - Original service: $100.00
      // - Discount: -$100.00
      // - Subtotal: $0.00
      // - Tax: $10.00 (calculated on pre-discount amount)
      // - Total: $10.00 (just the tax)
      expect(invoice!.subtotal).toBe(0);       // $0.00 after discount
      expect(invoice!.tax).toBe(1000);         // $10.00 (10% of original $100)
      expect(invoice!.total_amount).toBe(1000); // $10.00 (tax only)

      // Get invoice items to verify individual calculations
      const invoiceItems = await context.db('invoice_items')
        .where({ invoice_id: invoice!.invoice_id })
        .orderBy('net_amount', 'desc');

      // Verify we have both the original item and discount
      expect(invoiceItems).toHaveLength(2);

      // Original service should have tax
      const originalItem = invoiceItems.find(item => item.service_id === service);
      expect(parseInt(originalItem!.net_amount)).toBe(10000);
      expect(parseInt(originalItem!.tax_amount)).toBe(1000);

      // Discount item should have no tax
      const discountItem = invoiceItems.find(item => item.service_id === discountService);
      expect(parseInt(discountItem!.net_amount)).toBe(-10000);
      expect(parseInt(discountItem!.tax_amount)).toBe(0);
    });

    it('should calculate tax correctly for services with different tax regions', async () => {
      // Create test company
      const company_id = await context.createEntity<ICompany>('companies', {
        company_name: 'Tax Test Company',
        billing_cycle: 'monthly',
        company_id: uuidv4(),
        tax_region: 'US-NY', // Default tax region
        is_tax_exempt: false,
        phone_no: '',
        credit_balance: 0,
        email: '',
        url: '',
        address: '',
        is_inactive: false,
        created_at: Temporal.Now.plainDateISO().toString(),
        updated_at: Temporal.Now.plainDateISO().toString()
      }, 'company_id');

      // Create tax rates for different regions
      const nyTaxRateId = await context.createEntity('tax_rates', {
        region: 'US-NY',
        tax_percentage: 8.875,
        description: 'NY State + City Tax',
        start_date: '2025-01-01'
      }, 'tax_rate_id');

      const caTaxRateId = await context.createEntity('tax_rates', {
        region: 'US-CA',
        tax_percentage: 8.0,
        description: 'CA State Tax',
        start_date: '2025-01-01'
      }, 'tax_rate_id');

      // Set up company tax settings
      await context.db('company_tax_settings').insert({
        company_id: company_id,
        tenant: context.tenantId,
        tax_rate_id: nyTaxRateId,
        is_reverse_charge_applicable: false
      });

      // Create services with different tax regions
      const serviceNY = await context.createEntity('service_catalog', {
        service_name: 'NY Service',
        service_type: 'Fixed',
        default_rate: 1000,
        unit_of_measure: 'unit',
        tax_region: 'US-NY',
        is_taxable: true
      }, 'service_id');

      const serviceCA = await context.createEntity('service_catalog', {
        service_name: 'CA Service',
        service_type: 'Fixed',
        default_rate: 500,
        unit_of_measure: 'unit',
        tax_region: 'US-CA',
        is_taxable: true
      }, 'service_id');

      // Create a billing plan
      const planId = await context.createEntity('billing_plans', {
        plan_name: 'Multi-Region Plan',
        billing_frequency: 'monthly',
        is_custom: false,
        plan_type: 'Fixed'
      }, 'plan_id');

      // Assign services to plan
      await context.db('plan_services').insert([
        {
          plan_id: planId,
          service_id: serviceNY,
          quantity: 1,
          tenant: context.tenantId
        },
        {
          plan_id: planId,
          service_id: serviceCA,
          quantity: 1,
          tenant: context.tenantId
        }
      ]);

      // Create billing cycle
      const billingCycle = await context.createEntity('company_billing_cycles', {
        company_id: company_id,
        billing_cycle: 'monthly',
        effective_date: '2025-02-01',
        period_start_date: '2025-02-01',
        period_end_date: '2025-03-01'
      }, 'billing_cycle_id');

      // Assign plan to company
      await context.db('company_billing_plans').insert({
        company_billing_plan_id: uuidv4(),
        company_id: company_id,
        plan_id: planId,
        start_date: '2025-02-01',
        is_active: true,
        tenant: context.tenantId
      });

      // Generate invoice
      const invoice = await generateInvoice(billingCycle);

      // Verify tax calculations:
      // NY Service: $10.00 * 8.875% = $0.89 (rounded up)
      // CA Service: $5.00 * 8.0% = $0.40
      // Total tax should be $1.29
      expect(invoice!.subtotal).toBe(1500); // $15.00
      expect(invoice!.tax).toBe(129); // $1.29
      expect(invoice!.total_amount).toBe(1629); // $16.29
    });

    it('should handle tax calculation correctly with mixed positive and negative amounts', async () => {
      // Create test company
      const company_id = await context.createEntity<ICompany>('companies', {
        company_name: 'Mixed Tax Test Company',
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
        tax_percentage: 8.875,
        description: 'NY State + City Tax',
        start_date: '2025-01-01'
      }, 'tax_rate_id');

      // Set up company tax settings
      await context.db('company_tax_settings').insert({
        company_id: company_id,
        tenant: context.tenantId,
        tax_rate_id: nyTaxRateId,
        is_reverse_charge_applicable: false
      });

      // Create services (one positive, one negative)
      const serviceA = await context.createEntity('service_catalog', {
        service_name: 'Regular Service',
        service_type: 'Fixed',
        default_rate: 1000, // $10.00
        unit_of_measure: 'unit',
        tax_region: 'US-NY'
      }, 'service_id');



      const serviceB = await context.createEntity('service_catalog', {
        service_name: 'Credit Service',
        service_type: 'Fixed',
        default_rate: -200, // -$2.00
        unit_of_measure: 'unit',
        tax_region: 'US-NY'
      }, 'service_id');

      // Create a billing plan
      const planId = await context.createEntity('billing_plans', {
        plan_name: 'Mixed Amount Plan',
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
      const billingCycle = await context.createEntity('company_billing_cycles', {
        company_id: company_id,
        billing_cycle: 'monthly',
        effective_date: '2025-02-01',
        period_start_date: '2025-02-01',
        period_end_date: '2025-03-01'
      }, 'billing_cycle_id');

      // Assign plan to company
      await context.db('company_billing_plans').insert({
        company_billing_plan_id: uuidv4(),
        company_id: company_id,
        plan_id: planId,
        start_date: '2025-02-01',
        is_active: true,
        tenant: context.tenantId
      });

      // Generate invoice
      const invoice = await generateInvoice(billingCycle);

      // Calculation details:
      // - Regular Service: 1 unit at $10.00 (1000 cents)
      // - Credit Service: 1 unit at -$2.00 (-200 cents)
      // Subtotal: 1000 - 200 = 800 cents ($8.00)
      // Tax: Calculated at 8.875% on the positive amount, resulting in 72 cents
      // Total Amount: 800 + 72 = 872 cents ($8.72)
      expect(invoice!.subtotal).toBe(800); // $8.00
      expect(invoice!.tax).toBe(72);
      expect(invoice!.total_amount).toBe(872);
    });
  });

  it('should validate total calculation for negative subtotal (credit note)', async () => {
    // Create test company
    const company_id = await context.createEntity<ICompany>('companies', {
      company_name: 'Credit Note Company',
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

    // Create NY tax rate (10% but won't apply to negative amounts)
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
    const billingCycle = await context.createEntity('company_billing_cycles', {
      company_id: company_id,
      billing_cycle: 'monthly',
      effective_date: '2025-02-01',
      period_start_date: '2025-02-01',
      period_end_date: '2025-03-01'
    }, 'billing_cycle_id');

    // Assign plan to company
    await context.db('company_billing_plans').insert({
      company_billing_plan_id: uuidv4(),
      company_id: company_id,
      plan_id: planId,
      start_date: '2025-02-01',
      is_active: true,
      tenant: context.tenantId
    });

    // Generate invoice
    const invoice = await generateInvoice(billingCycle);

    // Verify calculations:
    // Service A: -$50.00 (-5000 cents)
    // Service B: -$75.00 (-7500 cents)
    // Subtotal: -$125.00 (-12500 cents)
    // Tax: $0.00 (no tax on credits)
    // Total: -$125.00 (-12500 cents)
    expect(invoice!.subtotal).toBe(-12500); // -$125.00
    expect(invoice!.tax).toBe(0);           // $0.00 (no tax on negative amounts)
    expect(invoice!.total_amount).toBe(-12500); // -$125.00

    // Additional verification
    expect(invoice!.subtotal).toBeLessThan(0);  // Verify subtotal is negative
    expect(invoice!.tax).toBe(0);              // Verify no tax is charged on credits
    expect(invoice!.total_amount).toBe(invoice!.subtotal); // Verify total equals negative subtotal

    // Get invoice items to verify individual calculations
    const invoiceItems = await context.db('invoice_items')
      .where({ invoice_id: invoice!.invoice_id })
      .orderBy('net_amount', 'desc');

    // Verify each service's tax calculation
    for (const item of invoiceItems) {
      expect(parseInt(item.tax_amount)).toBe(0); // Each item should have zero tax
      expect(parseInt(item.total_price)).toBe(parseInt(item.net_amount)); // Total should equal net amount
    }
  });


  it('should verify total calculation when subtotal is positive but tax is zero', async () => {
    // Create test company with tax exempt status
    const company_id = await context.createEntity<ICompany>('companies', {
      company_name: 'Tax Exempt Company',
      billing_cycle: 'monthly',
      company_id: uuidv4(),
      tax_region: 'US-NY',
      is_tax_exempt: true, // Set company as tax exempt
      created_at: Temporal.Now.plainDateISO().toString(),
      updated_at: Temporal.Now.plainDateISO().toString(),
      phone_no: '',
      credit_balance: 0,
      email: '',
      url: '',
      address: '',
      is_inactive: false
    }, 'company_id');

    // Create NY tax rate (10% but won't be applied due to tax exempt status)
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

    // Create a service
    const service = await context.createEntity('service_catalog', {
      service_name: 'Basic Service',
      service_type: 'Fixed',
      default_rate: 10000, // $100.00
      unit_of_measure: 'unit',
      tax_region: 'US-NY',
      is_taxable: true
    }, 'service_id');

    // Create a billing plan
    const planId = await context.createEntity('billing_plans', {
      plan_name: 'Basic Plan',
      billing_frequency: 'monthly',
      is_custom: false,
      plan_type: 'Fixed'
    }, 'plan_id');

    // Assign service to plan
    await context.db('plan_services').insert({
      plan_id: planId,
      service_id: service,
      quantity: 1,
      tenant: context.tenantId
    });

    // Create billing cycle
    const billingCycle = await context.createEntity('company_billing_cycles', {
      company_id: company_id,
      billing_cycle: 'monthly',
      effective_date: '2025-02-01',
      period_start_date: '2025-02-01',
      period_end_date: '2025-03-01'
    }, 'billing_cycle_id');

    // Assign plan to company
    await context.db('company_billing_plans').insert({
      company_billing_plan_id: uuidv4(),
      company_id: company_id,
      plan_id: planId,
      start_date: '2025-02-01',
      is_active: true,
      tenant: context.tenantId
    });

    // Generate invoice
    const invoice = await generateInvoice(billingCycle);

    // Verify calculations:
    // - Service price: $100.00 (10000 cents)
    // - Tax: $0.00 (0 cents) because company is tax exempt
    // - Total: $100.00 (10000 cents)
    expect(invoice!.subtotal).toBe(10000); // $100.00
    expect(invoice!.tax).toBe(0);          // $0.00
    expect(invoice!.total_amount).toBe(10000); // $100.00

    // Additional verification
    expect(invoice!.subtotal).toBeGreaterThan(0); // Verify subtotal is positive
    expect(invoice!.tax).toBe(0);                 // Verify tax is exactly zero
    expect(invoice!.total_amount).toBe(invoice!.subtotal); // Verify total equals subtotal
  });


  it('should verify total calculation when subtotal and tax are both positive', async () => {
    // Create test company
    const company_id = await context.createEntity<ICompany>('companies', {
      company_name: 'Basic Tax Test Company',
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

    // Create NY tax rate (10% for easy calculation)
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

    // Create a service with a simple price for clear calculations
    const service = await context.createEntity('service_catalog', {
      service_name: 'Basic Service',
      service_type: 'Fixed',
      default_rate: 10000, // $100.00
      unit_of_measure: 'unit',
      tax_region: 'US-NY',
      is_taxable: true
    }, 'service_id');

    // Create a billing plan
    const planId = await context.createEntity('billing_plans', {
      plan_name: 'Basic Plan',
      billing_frequency: 'monthly',
      is_custom: false,
      plan_type: 'Fixed'
    }, 'plan_id');

    // Assign service to plan
    await context.db('plan_services').insert({
      plan_id: planId,
      service_id: service,
      quantity: 1,
      tenant: context.tenantId
    });

    // Create billing cycle
    const billingCycle = await context.createEntity('company_billing_cycles', {
      company_id: company_id,
      billing_cycle: 'monthly',
      effective_date: '2025-02-01',
      period_start_date: '2025-02-01',
      period_end_date: '2025-03-01'
    }, 'billing_cycle_id');

    // Assign plan to company
    await context.db('company_billing_plans').insert({
      company_billing_plan_id: uuidv4(),
      company_id: company_id,
      plan_id: planId,
      start_date: '2025-02-01',
      is_active: true,
      tenant: context.tenantId
    });

    // Generate invoice
    const invoice = await generateInvoice(billingCycle);

    // Verify calculations:
    // - Service price: $100.00 (10000 cents)
    // - Tax rate: 10%
    // - Expected tax: $10.00 (1000 cents)
    // - Expected total: $110.00 (11000 cents)
    expect(invoice!.subtotal).toBe(10000); // $100.00
    expect(invoice!.tax).toBe(1000);       // $10.00
    expect(invoice!.total_amount).toBe(11000); // $110.00

    // Additional verification that both values are positive
    expect(invoice!.subtotal).toBeGreaterThan(0);
    expect(invoice!.tax).toBeGreaterThan(0);
  });


  describe("Tax Calculation with Tax-Exempt Line Items", () => {
    it("should only calculate tax for taxable line items", async () => {
      // Create test company with tax settings
      const company_id = await context.createEntity('companies', {
        company_name: 'Tax Exempt Test Company',
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

      // Create NY tax rate (10%) and set as active
      const nyTaxRateId = await context.createEntity('tax_rates', {
        region: 'US-NY',
        tax_percentage: 10.0,
        description: 'NY Test Tax',
        start_date: '2025-01-01',
        is_active: true
      }, 'tax_rate_id');

      // Set up company tax settings
      await context.db('company_tax_settings').insert({
        company_id: company_id,
        tenant: context.tenantId,
        tax_rate_id: nyTaxRateId,
        is_reverse_charge_applicable: false
      });

      // Ensure tax rate is active
      await context.db('tax_rates')
        .where({ tax_rate_id: nyTaxRateId })
        .update({ is_active: true });

      // Create services with different tax settings
      const taxableService = await context.createEntity('service_catalog', {
        service_name: 'Taxable Service',
        service_type: 'Fixed',
        default_rate: 10000, // $100.00
        unit_of_measure: 'unit',
        tax_region: 'US-NY',
        is_taxable: true  // Explicitly set as taxable
      }, 'service_id');

      const nonTaxableService = await context.createEntity('service_catalog', {
        service_name: 'Non-Taxable Service',
        service_type: 'Fixed',
        default_rate: 5000, // $50.00
        unit_of_measure: 'unit',
        tax_region: 'US-NY',
        is_taxable: false  // Explicitly set as non-taxable
      }, 'service_id');

      // Verify services were created with correct tax settings
      const services = await context.db('service_catalog')
        .whereIn('service_id', [taxableService, nonTaxableService])
        .select('service_id', 'service_name', 'is_taxable', 'tax_region');

      console.log('Created services:', services);

      // Ensure tax settings are correct
      const taxableServiceDetails = services.find(s => s.service_id === taxableService);
      const nonTaxableServiceDetails = services.find(s => s.service_id === nonTaxableService);

      if (!taxableServiceDetails?.is_taxable) {
        throw new Error('Taxable service was not created with is_taxable=true');
      }
      if (nonTaxableServiceDetails?.is_taxable !== false) {
        throw new Error('Non-taxable service was not created with is_taxable=false');
      }

      // Create a billing plan with both services
      const mixedTaxPlanId = await context.createEntity('billing_plans', {
        plan_name: 'Mixed Tax Plan',
        billing_frequency: 'monthly',
        is_custom: false,
        plan_type: 'Fixed'
      }, 'plan_id');

      // Assign services to plan
      await context.db('plan_services').insert([
        {
          plan_id: mixedTaxPlanId,
          service_id: taxableService,
          quantity: 1,
          tenant: context.tenantId
        },
        {
          plan_id: mixedTaxPlanId,
          service_id: nonTaxableService,
          quantity: 1,
          tenant: context.tenantId
        }
      ]);

      // Create billing cycle
      const mixedTaxBillingCycle = await context.createEntity('company_billing_cycles', {
        company_id: company_id,
        billing_cycle: 'monthly',
        effective_date: '2025-02-01',
        period_start_date: '2025-02-01',
        period_end_date: '2025-03-01'
      }, 'billing_cycle_id');

      // Assign plan to company
      await context.db('company_billing_plans').insert({
        company_billing_plan_id: uuidv4(),
        company_id: company_id,
        plan_id: mixedTaxPlanId,
        start_date: '2025-02-01',
        is_active: true,
        tenant: context.tenantId
      });

      // Generate invoice
      const mixedTaxInvoice = await generateInvoice(mixedTaxBillingCycle);

      // Get invoice items to verify tax calculation
      const invoiceItems = await context.db('invoice_items')
        .where({ invoice_id: mixedTaxInvoice!.invoice_id })
        .orderBy('net_amount', 'desc');

      console.log('Invoice items:', invoiceItems);

      // Verify each service's tax calculation
      const taxableItem = invoiceItems.find(item => item.service_id === taxableService);
      const nonTaxableItem = invoiceItems.find(item => item.service_id === nonTaxableService);

      // Verify taxable service calculations
      expect(parseInt(taxableItem?.net_amount)).toBe(10000); // $100.00
      expect(parseInt(taxableItem?.tax_amount)).toBe(1000);  // $10.00 (10% tax)
      expect(parseInt(taxableItem?.total_price)).toBe(11000); // $110.00

      // Verify non-taxable service calculations
      expect(parseInt(nonTaxableItem?.net_amount)).toBe(5000);  // $50.00
      expect(parseInt(nonTaxableItem?.tax_amount)).toBe(0);     // No tax
      expect(parseInt(nonTaxableItem?.total_price)).toBe(5000); // $50.00

      // Verify overall invoice totals
      expect(mixedTaxInvoice!.subtotal).toBe(15000); // $150.00
      expect(mixedTaxInvoice!.tax).toBe(1000);       // $10.00 (only from taxable service)
      expect(mixedTaxInvoice!.total_amount).toBe(16000); // $160.00
    });
  });



  describe('Tax Calculation Consistency', () => {
    it('should calculate tax consistently between manual and automatic invoices', async () => {
      // Set up test data
      const serviceId = await context.createEntity('service_catalog', {
        service_name: 'Test Service',
        service_type: 'Fixed',
        default_rate: 1000,
        unit_of_measure: 'unit',
        tax_region: 'US-NY'
      }, 'service_id');

      // Create tax rate
      const taxRateId = await context.createEntity('tax_rates', {
        region: 'US-NY',
        tax_percentage: 8.875,
        description: 'NY State + City Tax',
        start_date: '2025-01-01'
      }, 'tax_rate_id');

      // Create billing cycle for automatic invoice
      const billingCycle = await context.createEntity('company_billing_cycles', {
        company_id: context.companyId,
        billing_cycle: 'monthly',
        effective_date: '2025-02-01',
        period_start_date: '2025-02-01',
        period_end_date: '2025-03-01'
      }, 'billing_cycle_id');

      // Create and assign billing plan
      const planId = await context.createEntity('billing_plans', {
        plan_name: 'Test Plan',
        billing_frequency: 'monthly',
        is_custom: false,
        plan_type: 'Fixed'
      }, 'plan_id');

      await context.db('plan_services').insert({
        plan_id: planId,
        service_id: serviceId,
        quantity: 1,
        tenant: context.tenantId
      });

      await context.db('company_billing_plans').insert({
        company_billing_plan_id: uuidv4(),
        company_id: context.companyId,
        plan_id: planId,
        start_date: '2025-02-01',
        is_active: true,
        tenant: context.tenantId
      });

      // Generate automatic invoice
      const autoInvoice = await generateInvoice(billingCycle);

      // Generate manual invoice with same parameters
      const manualInvoice = await generateManualInvoice({
        companyId: context.companyId,
        items: [{
          service_id: serviceId,
          quantity: 1,
          description: 'Test Service',
          rate: 1000
        }]
      });

      // Verify tax calculations match
      expect(autoInvoice!.tax).toBe(manualInvoice.tax);
      expect(autoInvoice!.subtotal).toBe(manualInvoice.subtotal);
      expect(autoInvoice!.total_amount).toBe(manualInvoice.total_amount);
    });
  });
});
