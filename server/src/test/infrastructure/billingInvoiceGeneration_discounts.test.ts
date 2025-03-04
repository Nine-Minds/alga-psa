import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import '../../../test-utils/nextApiMock';
import { TestContext } from '../../../test-utils/testContext';
import { generateManualInvoice } from 'server/src/lib/actions/manualInvoiceActions';
import { createDefaultTaxSettings } from 'server/src/lib/actions/taxSettingsActions';
import { v4 as uuidv4 } from 'uuid';
import type { ICompany } from '../../interfaces/company.interfaces';
import { Temporal } from '@js-temporal/polyfill';

describe('Billing Invoice Discount Applications', () => {
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

  describe('Service-Based Discount Application', () => {
    it('should correctly apply discounts using service references', async () => {
      // Create test company
      const company_id = await context.createEntity<ICompany>('companies', {
        company_name: 'Service Discount Test Company',
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

      // Create two services
      const serviceA = await context.createEntity('service_catalog', {
        service_name: 'Service A',
        service_type: 'Fixed',
        default_rate: 10000, // $100.00
        unit_of_measure: 'unit',
        tax_region: 'US-NY',
        is_taxable: true
      }, 'service_id');

      const serviceB = await context.createEntity('service_catalog', {
        service_name: 'Service B',
        service_type: 'Fixed',
        default_rate: 5000, // $50.00
        unit_of_measure: 'unit',
        tax_region: 'US-NY',
        is_taxable: true
      }, 'service_id');

      // Generate invoice with service-based discount
      const invoice = await generateManualInvoice({
        companyId: company_id,
        items: [
          {
            // Service A
            service_id: serviceA,
            description: 'Service A',
            quantity: 1,
            rate: 10000
          },
          {
            // Service B
            service_id: serviceB,
            description: 'Service B',
            quantity: 1,
            rate: 5000
          },
          {
            // Discount applied to Service A by service ID
            description: '10% Discount on Service A',
            quantity: 1,
            rate: 10, // 10% discount
            is_discount: true,
            discount_type: 'percentage',
            service_id: '',
            applies_to_service_id: serviceA // Reference by service ID
          }
        ]
      });

      // Get invoice items to verify calculations
      const invoiceItems = await context.db('invoice_items')
        .where({ invoice_id: invoice.invoice_id })
        .orderBy('net_amount', 'desc');

      // Verify we have all three items
      expect(invoiceItems).toHaveLength(3);

      // Find each item
      const serviceAItem = invoiceItems.find(item => item.service_id === serviceA);
      const serviceBItem = invoiceItems.find(item => item.service_id === serviceB);
      const discountItem = invoiceItems.find(item => item.is_discount === true);

      // Verify Service A item
      expect(serviceAItem).toBeDefined();
      expect(parseInt(serviceAItem!.net_amount)).toBe(10000); // $100.00
      expect(parseInt(serviceAItem!.tax_amount)).toBe(1000);  // $10.00 (10% tax)

      // Verify Service B item
      expect(serviceBItem).toBeDefined();
      expect(parseInt(serviceBItem!.net_amount)).toBe(5000);  // $50.00
      expect(parseInt(serviceBItem!.tax_amount)).toBe(500);   // $5.00 (10% tax)

      // Verify discount item
      expect(discountItem).toBeDefined();
      expect(parseInt(discountItem!.net_amount)).toBe(-1000); // -$10.00 (10% of $100)
      expect(parseInt(discountItem!.tax_amount)).toBe(0);     // No tax on discounts
      expect(discountItem!.applies_to_item_id).toBe(serviceAItem!.item_id); // Should reference Service A item ID

      // Verify invoice totals
      expect(invoice.subtotal).toBe(14000);  // $140.00 ($100 + $50 - $10)
      expect(invoice.tax).toBe(1500);        // $15.00 (10% of $150 taxable amount)
      expect(invoice.total_amount).toBe(15500); // $155.00 (subtotal + tax)
    });

    it('should correctly apply fixed amount discount to the entire invoice', async () => {
      // Create test company
      const company_id = await context.createEntity<ICompany>('companies', {
        company_name: 'Invoice Discount Test Company',
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

      // Create multiple services
      const serviceA = await context.createEntity('service_catalog', {
        service_name: 'Service A',
        service_type: 'Fixed',
        default_rate: 10000, // $100.00
        unit_of_measure: 'unit',
        tax_region: 'US-NY',
        is_taxable: true
      }, 'service_id');

      const serviceB = await context.createEntity('service_catalog', {
        service_name: 'Service B',
        service_type: 'Fixed',
        default_rate: 5000, // $50.00
        unit_of_measure: 'unit',
        tax_region: 'US-NY',
        is_taxable: true
      }, 'service_id');

      const serviceC = await context.createEntity('service_catalog', {
        service_name: 'Service C',
        service_type: 'Fixed',
        default_rate: 2000, // $20.00
        unit_of_measure: 'unit',
        tax_region: 'US-NY',
        is_taxable: true
      }, 'service_id');

      // Generate invoice with multiple services and a fixed discount applied to the entire invoice
      const invoice = await generateManualInvoice({
        companyId: company_id,
        items: [
          {
            // Service A
            service_id: serviceA,
            description: 'Service A',
            quantity: 1,
            rate: 10000
          },
          {
            // Service B
            service_id: serviceB,
            description: 'Service B',
            quantity: 1,
            rate: 5000
          },
          {
            // Service C
            service_id: serviceC,
            description: 'Service C',
            quantity: 1,
            rate: 2000
          },
          {
            // Fixed discount applied to the entire invoice (no applies_to_service_id)
            description: 'Fixed Discount on Entire Invoice',
            quantity: 1,
            rate: 3000, // $30.00 fixed discount
            is_discount: true,
            discount_type: 'fixed',
            service_id: ''
            // No applies_to_service_id means it applies to the entire invoice
          }
        ]
      });

      // Get invoice items to verify calculations
      const invoiceItems = await context.db('invoice_items')
        .where({ invoice_id: invoice.invoice_id })
        .orderBy('net_amount', 'desc');

      // Verify we have all four items
      expect(invoiceItems).toHaveLength(4);

      // Find each item
      const serviceAItem = invoiceItems.find(item => item.service_id === serviceA);
      const serviceBItem = invoiceItems.find(item => item.service_id === serviceB);
      const serviceCItem = invoiceItems.find(item => item.service_id === serviceC);
      const discountItem = invoiceItems.find(item => item.is_discount === true);

      // Verify Service A item
      expect(serviceAItem).toBeDefined();
      expect(parseInt(serviceAItem!.net_amount)).toBe(10000); // $100.00
      expect(parseInt(serviceAItem!.tax_amount)).toBe(1000);  // $10.00 (10% tax)

      // Verify Service B item
      expect(serviceBItem).toBeDefined();
      expect(parseInt(serviceBItem!.net_amount)).toBe(5000);  // $50.00
      expect(parseInt(serviceBItem!.tax_amount)).toBe(500);   // $5.00 (10% tax)

      // Verify Service C item
      expect(serviceCItem).toBeDefined();
      expect(parseInt(serviceCItem!.net_amount)).toBe(2000);  // $20.00
      expect(parseInt(serviceCItem!.tax_amount)).toBe(200);   // $2.00 (10% tax)

      // Verify discount item
      expect(discountItem).toBeDefined();
      expect(parseInt(discountItem!.net_amount)).toBe(-3000); // -$30.00 fixed discount
      expect(parseInt(discountItem!.tax_amount)).toBe(0);     // No tax on discounts
      expect(discountItem!.applies_to_item_id).toBeNull();    // No specific item reference for invoice-wide discount
      expect(discountItem!.applies_to_service_id).toBeNull(); // No specific service reference for invoice-wide discount

      // Verify invoice totals
      // Original subtotal: $100 + $50 + $20 = $170
      // Discount: -$30
      // Final subtotal: $140
      // Tax: 10% of $170 = $17 (tax is calculated on pre-discount amount)
      // Total: $140 + $17 = $157
      expect(invoice.subtotal).toBe(14000);  // $140.00 ($170 - $30)
      expect(invoice.tax).toBe(1700);        // $17.00 (10% of $170 taxable amount)
      expect(invoice.total_amount).toBe(15700); // $157.00 (subtotal + tax)
    });
  });

  it('should correctly apply multiple discounts in sequence', async () => {
    // Create test company
    const company_id = await context.createEntity<ICompany>('companies', {
      company_name: 'Multiple Discount Test Company',
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

    // Create a service with a round price for easy calculation
    const service = await context.createEntity('service_catalog', {
      service_name: 'Premium Service',
      service_type: 'Fixed',
      default_rate: 10000, // $100.00
      unit_of_measure: 'unit',
      tax_region: 'US-NY',
      is_taxable: true
    }, 'service_id');

    // Generate invoice with multiple discounts applied in sequence
    const invoice = await generateManualInvoice({
      companyId: company_id,
      items: [
        {
          // Base service
          service_id: service,
          description: 'Premium Service',
          quantity: 1,
          rate: 10000 // $100.00
        },
        {
          // First discount: 20% off
          description: '20% Loyalty Discount',
          quantity: 1,
          rate: 20, // 20% discount
          is_discount: true,
          discount_type: 'percentage',
          service_id: '',
          applies_to_service_id: service
        },
        {
          // Second discount: $10 fixed amount off (applied after the first discount)
          description: '$10 Promotional Discount',
          quantity: 1,
          rate: 1000, // $10.00 fixed discount
          is_discount: true,
          discount_type: 'fixed',
          service_id: '',
          applies_to_service_id: service
        }
      ]
    });

    // Get invoice items to verify calculations
    const invoiceItems = await context.db('invoice_items')
      .where({ invoice_id: invoice.invoice_id })
      .orderBy('created_at', 'asc'); // Order by creation time to verify sequence

    // Verify we have all three items
    expect(invoiceItems).toHaveLength(3);

    // Find each item
    const serviceItem = invoiceItems.find(item => item.service_id === service);
    const discountItems = invoiceItems.filter(item => item.is_discount === true);
    
    // Verify we have two discount items
    expect(discountItems).toHaveLength(2);
    
    // First discount should be 20% of $100 = $20
    const firstDiscount = discountItems.find(item => item.description.includes('Loyalty'));
    expect(firstDiscount).toBeDefined();
    expect(parseInt(firstDiscount!.net_amount)).toBe(-2000); // -$20.00
    
    // Second discount should be a fixed $10
    const secondDiscount = discountItems.find(item => item.description.includes('Promotional'));
    expect(secondDiscount).toBeDefined();
    expect(parseInt(secondDiscount!.net_amount)).toBe(-1000); // -$10.00

    // Verify service item
    expect(serviceItem).toBeDefined();
    expect(parseInt(serviceItem!.net_amount)).toBe(10000); // Original $100.00
    expect(parseInt(serviceItem!.tax_amount)).toBe(1000);  // $10.00 (10% tax)

    // Verify that discount items are marked as non-taxable
    expect(firstDiscount!.is_taxable).toBe(false);
    expect(secondDiscount!.is_taxable).toBe(false);

    // Verify invoice totals
    // Original amount: $100.00
    // First discount: -$20.00 (20% of $100)
    // Second discount: -$10.00 (fixed amount)
    // Final subtotal: $70.00
    // Tax: 10% of $100 = $10.00 (tax is calculated on pre-discount amount)
    // Total: $70.00 + $10.00 = $80.00
    expect(invoice.subtotal).toBe(7000);  // $70.00 ($100 - $20 - $10)
    expect(invoice.tax).toBe(1000);       // $10.00 (10% of $100 taxable amount)
    expect(invoice.total_amount).toBe(8000); // $80.00 (subtotal + tax)

    // Verify that tax is calculated on the full pre-discount amount
    // This is a key principle in our tax calculation guidance
    const taxableBase = parseInt(serviceItem!.net_amount);
    const expectedTax = Math.floor(taxableBase * 0.1); // 10% tax rate
    expect(invoice.tax).toBe(expectedTax);
    expect(invoice.tax).not.toBe(Math.floor(invoice.subtotal * 0.1)); // Not based on post-discount amount

    // Verify the discount application order by checking the applies_to_item_id
    // Both discounts should apply to the service item
    expect(firstDiscount!.applies_to_item_id).toBe(serviceItem!.item_id);
    expect(secondDiscount!.applies_to_item_id).toBe(serviceItem!.item_id);
  });

  it('should handle discount application when discounts exceed the subtotal amount', async () => {
    // Create test company
    const company_id = await context.createEntity<ICompany>('companies', {
      company_name: 'Excessive Discount Test Company',
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

    // Create a service with a price that will be exceeded by discounts
    const service = await context.createEntity('service_catalog', {
      service_name: 'Basic Service',
      service_type: 'Fixed',
      default_rate: 5000, // $50.00
      unit_of_measure: 'unit',
      tax_region: 'US-NY',
      is_taxable: true
    }, 'service_id');

    // Generate invoice with discounts exceeding the service price
    const invoice = await generateManualInvoice({
      companyId: company_id,
      items: [
        {
          // Base service
          service_id: service,
          description: 'Basic Service',
          quantity: 1,
          rate: 5000 // $50.00
        },
        {
          // First discount: 60% off
          description: '60% Special Discount',
          quantity: 1,
          rate: 60, // 60% discount = $30.00
          is_discount: true,
          discount_type: 'percentage',
          service_id: '',
          applies_to_service_id: service
        },
        {
          // Second discount: $30 fixed amount off
          description: '$30 Additional Discount',
          quantity: 1,
          rate: 3000, // $30.00 fixed discount
          is_discount: true,
          discount_type: 'fixed',
          service_id: '',
          applies_to_service_id: service
        }
      ]
    });

    // Get invoice items to verify calculations
    const invoiceItems = await context.db('invoice_items')
      .where({ invoice_id: invoice.invoice_id })
      .orderBy('created_at', 'asc');

    // Verify we have all three items
    expect(invoiceItems).toHaveLength(3);

    // Find each item
    const serviceItem = invoiceItems.find(item => item.service_id === service);
    const discountItems = invoiceItems.filter(item => item.is_discount === true);
    
    // Verify we have two discount items
    expect(discountItems).toHaveLength(2);
    
    // First discount should be 60% of $50 = $30
    const firstDiscount = discountItems.find(item => item.description.includes('Special'));
    expect(firstDiscount).toBeDefined();
    expect(parseInt(firstDiscount!.net_amount)).toBe(-3000); // -$30.00
    expect(firstDiscount!.is_taxable).toBe(false);
    
    // Second discount should be a fixed $30
    const secondDiscount = discountItems.find(item => item.description.includes('Additional'));
    expect(secondDiscount).toBeDefined();
    expect(parseInt(secondDiscount!.net_amount)).toBe(-3000); // -$30.00
    expect(secondDiscount!.is_taxable).toBe(false);

    // Verify service item
    expect(serviceItem).toBeDefined();
    expect(parseInt(serviceItem!.net_amount)).toBe(5000); // Original $50.00
    expect(parseInt(serviceItem!.tax_amount)).toBe(500);  // $5.00 (10% tax)

    // Verify invoice totals
    // Original amount: $50.00
    // First discount: -$30.00 (60% of $50)
    // Second discount: -$30.00 (fixed amount)
    // Final subtotal: -$10.00 (negative because discounts exceed the service price)
    // Tax: 10% of $50 = $5.00 (tax is calculated on pre-discount amount)
    // Total: -$10.00 + $5.00 = -$5.00 (credit balance)
    expect(invoice.subtotal).toBe(-1000);  // -$10.00 ($50 - $30 - $30)
    expect(invoice.tax).toBe(500);        // $5.00 (10% of $50 taxable amount)
    expect(invoice.total_amount).toBe(-500); // -$5.00 (subtotal + tax)

    // Verify that tax is calculated on the full pre-discount amount
    const taxableBase = parseInt(serviceItem!.net_amount);
    const expectedTax = Math.floor(taxableBase * 0.1); // 10% tax rate
    expect(invoice.tax).toBe(expectedTax);
    
    // Verify that even with a negative subtotal, the tax is still based on the original positive amount
    expect(invoice.subtotal).toBeLessThan(0); // Subtotal is negative
    expect(invoice.tax).toBeGreaterThan(0);   // But tax is still positive
  });
});