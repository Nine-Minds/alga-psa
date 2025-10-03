import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import '../../../test-utils/nextApiMock';
import { TestContext } from '../../../test-utils/testContext';
import { TaxService } from '../../lib/services/taxService';
import { Temporal } from '@js-temporal/polyfill';
import { createDefaultTaxSettings } from 'server/src/lib/actions/taxSettingsActions';
import { ICompany } from '../../interfaces/company.interfaces';
import { v4 as uuidv4 } from 'uuid';

describe('Tax Rate Changes Mid-Billing Period', () => {
  const testHelpers = TestContext.createHelpers();
  let context: TestContext;
  let taxService: TaxService;
  let company_id: string;

  beforeAll(async () => {
    context = await testHelpers.beforeAll({
      runSeeds: true,
      cleanupTables: [
        'companies',
        'tax_rates', 
        'company_tax_settings'
      ],
      companyName: 'Test Company',
      userType: 'internal'
    });
    taxService = new TaxService();
  });

  beforeEach(async () => {
    await testHelpers.beforeEach();
    
    // Create test company with US-NY tax region
    company_id = await context.createEntity<ICompany>('companies', {
      company_name: 'Test Company 1',
      is_tax_exempt: false,
      tax_region: 'US-NY',
      company_id: uuidv4(),
      phone_no: '123-456-7890',
      credit_balance: 0,
      email: 'test@example.com',
      url: 'https://example.com',
      address: '123 Test St',
      created_at: Temporal.Now.plainDateISO().toString(),
      updated_at: Temporal.Now.plainDateISO().toString(),
      is_inactive: false,
      billing_cycle: 'weekly',
      properties: {}
    }, 'company_id');

    // Create default tax settings
    await createDefaultTaxSettings(company_id);

    // Create initial tax rate (10%) for US-NY ending just before new rate starts
    await context.createEntity('tax_rates', {
      tax_type: 'VAT',
      country_code: 'US',
      tax_percentage: 10,
      region: 'US-NY', // Changed to match company tax_region
      is_reverse_charge_applicable: false,
      is_composite: false,
      start_date: '2024-10-01',
      end_date: '2024-10-14', // End date set to day before new rate starts
      is_active: true,
      description: 'Initial Tax Rate'
    }, 'tax_rate_id');

    // Create new tax rate (12%) for US-NY effective 2024-10-15
    await context.createEntity('tax_rates', {
      tax_type: 'VAT',
      country_code: 'US',
      tax_percentage: 12,
      region: 'US-NY', // Changed to match company tax_region
      is_reverse_charge_applicable: false,
      is_composite: false,
      start_date: '2024-10-15',
      is_active: true,
      description: 'Increased Tax Rate'
    }, 'tax_rate_id');
  });

  afterAll(async () => {
    await testHelpers.afterAll();
  });

  it('should apply correct tax rates based on charge dates', async () => {
    // Charge before rate change
    const charge1 = {
      amount: 10000, // $100.00
      date: '2024-10-10'
    };

    // Charge after rate change
    const charge2 = {
      amount: 20000, // $200.00
      date: '2024-10-20'
    };

    // Calculate taxes with explicit tax region
    const taxResult1 = await taxService.calculateTax(
      company_id, 
      charge1.amount, 
      charge1.date,
      'US-NY' // Explicitly pass tax region
    );
    const taxResult2 = await taxService.calculateTax(
      company_id, 
      charge2.amount, 
      charge2.date,
      'US-NY' // Explicitly pass tax region
    );

    // Verify individual taxes
    expect(taxResult1.taxAmount).toBe(1000); // 10% of $100
    expect(taxResult2.taxAmount).toBe(2400); // 12% of $200

    // Verify total tax
    const totalTax = taxResult1.taxAmount + taxResult2.taxAmount;
    expect(totalTax).toBe(3400); // $34.00 total tax
  });
});