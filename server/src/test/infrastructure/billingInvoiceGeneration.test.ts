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
        tax_region: 'US-NY'
      }, 'service_id');

      const serviceCA = await context.createEntity('service_catalog', {
        service_name: 'CA Service',
        service_type: 'Fixed',
        default_rate: 500,
        unit_of_measure: 'unit',
        tax_region: 'US-CA'
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
