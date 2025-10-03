import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import '../../../test-utils/nextApiMock';
import { TestContext } from '../../../test-utils/testContext';
import { TaxService } from '../../lib/services/taxService';
import { Temporal } from '@js-temporal/polyfill';
import { ICompany } from '../../interfaces/company.interfaces';
import { v4 as uuidv4 } from 'uuid';
import { generateManualInvoice } from 'server/src/lib/actions/manualInvoiceActions';

describe('Tax Allocation Strategy', () => {
  const testHelpers = TestContext.createHelpers();
  let context: TestContext;
  let taxService: TaxService;
  let company_id: string;
  let default_service_id: string;

  beforeAll(async () => {
    context = await testHelpers.beforeAll({
      runSeeds: true,
      cleanupTables: [
        'companies',
        'tax_rates',
        'company_tax_settings',
        'invoices',
        'invoice_items',
        'service_catalog'
      ],
      companyName: 'Test Company',
      userType: 'internal'
    });
    taxService = new TaxService();
  });

  beforeEach(async () => {
    await testHelpers.beforeEach();

    // Create test company
    company_id = await context.createEntity<ICompany>('companies', {
      company_name: 'Tax Allocation Test Company',
      billing_cycle: 'monthly',
      company_id: uuidv4(),
      tax_region: 'US-NY',
      is_tax_exempt: false,
      phone_no: '',
      credit_balance: 0,
      email: '',
      url: '',
      address: '',
      created_at: Temporal.Now.plainDateISO().toString(),
      updated_at: Temporal.Now.plainDateISO().toString(),
      is_inactive: false,
      properties: {}
    }, 'company_id');

    // Create a default service for testing
    default_service_id = await context.createEntity('service_catalog', {
      service_name: 'Test Service',
      service_type: 'Fixed',
      default_rate: 1000,
      unit_of_measure: 'unit',
      tax_region: 'US-NY',
      is_taxable: true
    }, 'service_id');
  });

  afterAll(async () => {
    await testHelpers.afterAll();
  });

  describe('Tax Distribution Rules', () => {
    it('should distribute tax proportionally among positive line items only', async () => {
      // Create tax rate of 10% for simple calculation
      const taxRateId = await context.createEntity('tax_rates', {
        region: 'US-NY',
        tax_percentage: 10,
        description: 'Test Tax Rate',
        start_date: '2025-01-01',
        is_active: true
      }, 'tax_rate_id');

      // Set up company tax settings
      await context.db('company_tax_settings').insert({
        company_id: company_id,
        tenant: context.tenantId,
        tax_rate_id: taxRateId,
        is_reverse_charge_applicable: false
      });

      // Create invoice with mixed positive and negative amounts
      const invoice = await generateManualInvoice({
        companyId: company_id,
        items: [
          {
            service_id: default_service_id,
            description: 'Positive Service A',
            quantity: 1,
            rate: 3000 // $30.00
          },
          {
            service_id: default_service_id,
            description: 'Negative Service',
            quantity: 1,
            rate: -1000 // -$10.00
          },
          {
            service_id: default_service_id,
            description: 'Positive Service B',
            quantity: 1,
            rate: 2000 // $20.00
          }
        ]
      });

      // Net subtotal: $40.00 ($50.00 positive - $10.00 negative)
      // Total tax at 10%: $4.00
      // Distribution:
      // - $30.00 item (60% of positive) gets $2.40 tax
      // - $20.00 item (40% of positive) gets $1.60 tax
      // - Negative item gets no tax
      const invoiceItems = await context.db('invoice_items')
        .where({ invoice_id: invoice.invoice_id })
        .orderBy('net_amount', 'desc');

      expect(invoice.subtotal).toBe(4000); // $40.00
      expect(invoice.tax).toBe(400); // $4.00
      expect(invoice.total_amount).toBe(4400); // $44.00

      // Verify tax distribution
      expect(invoiceItems[0].tax_amount).toBe('240'); // $2.40 on $30.00 item
      expect(invoiceItems[1].tax_amount).toBe('160'); // $1.60 on $20.00 item
      expect(invoiceItems[2].tax_amount).toBe('0'); // $0.00 on negative item
    });

    it('should handle rounding by using Math.floor for all but last item', async () => {
      // Create tax rate of 8.875% (NY rate)
      const taxRateId = await context.createEntity('tax_rates', {
        region: 'US-NY',
        tax_percentage: 8.875,
        description: 'NY State + City Tax',
        start_date: '2025-01-01',
        is_active: true
      }, 'tax_rate_id');

      // Update company tax settings
      await context.db('company_tax_settings')
        .where({ company_id: company_id })
        .update({
          tax_rate_id: taxRateId,
          is_reverse_charge_applicable: false
        });

      // Create invoice with amounts that will produce fractional tax cents
      const invoice = await generateManualInvoice({
        companyId: company_id,
        items: [
          {
            service_id: default_service_id,
            description: 'Service A',
            quantity: 1,
            rate: 3000 // $30.00 * 8.875% = $2.6625
          },
          {
            service_id: default_service_id,
            description: 'Service B',
            quantity: 1,
            rate: 2000 // $20.00 * 8.875% = $1.775
          },
          {
            service_id: default_service_id,
            description: 'Service C',
            quantity: 1,
            rate: 1000 // $10.00 * 8.875% = $0.8875
          }
        ]
      });

      // Total: $60.00 * 8.875% = $5.325 total tax
      // Distribution (ordered by amount, highest to lowest):
      // - $30.00 item: Math.floor($2.6625) = $2.66
      // - $20.00 item: Math.floor($1.775) = $1.77
      // - $10.00 item: Gets remaining to match total = $0.90 (rounds up from $0.8875)
      const invoiceItems = await context.db('invoice_items')
        .where({ invoice_id: invoice.invoice_id })
        .orderBy('net_amount', 'desc');

      expect(invoice.subtotal).toBe(6000); // $60.00
      expect(invoice.tax).toBe(533); // $5.33 (rounded from $5.325)
      expect(invoice.total_amount).toBe(6533); // $65.33

      // Verify tax distribution
      expect(invoiceItems[0].tax_amount).toBe('266'); // $2.66 on $30.00 item (Math.floor)
      expect(invoiceItems[1].tax_amount).toBe('177'); // $1.77 on $20.00 item (Math.floor)
      expect(invoiceItems[2].tax_amount).toBe('90'); // $0.90 on $10.00 item (remaining amount)
    });

    it('should handle very small amounts by allocating to last positive item', async () => {
      // Create tax rate of 1% for testing small amounts
      const taxRateId = await context.createEntity('tax_rates', {
        region: 'US-NY',
        tax_percentage: 1,
        description: 'Test Tax Rate',
        start_date: '2025-01-01',
        is_active: true
      }, 'tax_rate_id');

      // Update company tax settings
      await context.db('company_tax_settings')
        .where({ company_id: company_id })
        .update({
          tax_rate_id: taxRateId,
          is_reverse_charge_applicable: false
        });

      // Create invoice with small amounts
      const invoice = await generateManualInvoice({
        companyId: company_id,
        items: [
          {
            service_id: default_service_id,
            description: 'Service A',
            quantity: 1,
            rate: 300 // $3.00 * 1% = $0.03
          },
          {
            service_id: default_service_id,
            description: 'Service B',
            quantity: 1,
            rate: 200 // $2.00 * 1% = $0.02
          },
          {
            service_id: default_service_id,
            description: 'Service C',
            quantity: 1,
            rate: 100 // $1.00 * 1% = $0.01
          }
        ]
      });

      // Total: $6.00 * 1% = $0.06 total tax
      const invoiceItems = await context.db('invoice_items')
        .where({ invoice_id: invoice.invoice_id })
        .orderBy('net_amount', 'desc');

      expect(invoice.subtotal).toBe(600); // $6.00
      expect(invoice.tax).toBe(6); // $0.06
      expect(invoice.total_amount).toBe(606); // $6.06

      // Verify tax distribution
      expect(parseInt(invoiceItems[0].tax_amount)).toBe(3); // $0.03 on $3.00 item (Math.floor)
      expect(parseInt(invoiceItems[1].tax_amount)).toBe(2); // $0.02 on $2.00 item (Math.floor)
      expect(parseInt(invoiceItems[2].tax_amount)).toBe(1); // $0.01 on $1.00 item (remaining amount)
    });
  });
});