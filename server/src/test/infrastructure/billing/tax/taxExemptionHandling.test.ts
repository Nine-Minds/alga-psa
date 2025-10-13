import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { TestContext } from '../../../../../test-utils/testContext';
import { TaxService } from '../../lib/services/taxService';
import { Temporal } from '@js-temporal/polyfill';
import { createDefaultTaxSettings } from 'server/src/lib/actions/taxSettingsActions';
import { IClient } from '../../interfaces/client.interfaces';
import { v4 as uuidv4 } from 'uuid';

describe('Tax Exemption Handling', () => {
  const testHelpers = TestContext.createHelpers();
  let context: TestContext;
  let taxService: TaxService;

  beforeAll(async () => {
    context = await testHelpers.beforeAll({
      runSeeds: true,
      cleanupTables: [
        'clients',
        'tax_rates',
        'client_tax_settings'
      ],
      clientName: 'Test Client',
      userType: 'internal'
    });
    taxService = new TaxService();
  });

  beforeEach(async () => {
    await testHelpers.beforeEach();
    
    // Create default tax rate
    await context.createEntity('tax_rates', {
      tax_type: 'VAT',
      country_code: 'US',
      tax_percentage: 10,
      region: null,
      is_reverse_charge_applicable: false,
      is_composite: false,
      start_date: Temporal.Now.plainDateISO().toString(),
      is_active: true,
      description: 'Test Tax Rate'
    }, 'tax_rate_id');
  });

  afterAll(async () => {
    await testHelpers.afterAll();
  });

  it('should not apply tax to exempt clients', async () => {
    // Create a tax-exempt client
    const client_id = await context.createEntity<IClient>('clients', {
      client_name: 'Exempt Client',
      is_tax_exempt: true,
      tax_region: 'US-NY',
      client_id: uuidv4(),
      phone_no: '',
      credit_balance: 0,
      email: '',
      url: '',
      address: '',
      created_at: Temporal.Now.plainDateISO().toString(),
      updated_at: Temporal.Now.plainDateISO().toString(),
      is_inactive: false,
      billing_cycle: 'weekly'
    }, 'client_id');

    // Create default tax settings
    await createDefaultTaxSettings(client_id);

    // Create a test charge
    const chargeAmount = 10000; // $100.00 in cents
    const currentDate = Temporal.Now.plainDateISO().toString();
    const taxResult = await taxService.calculateTax(client_id, chargeAmount, currentDate);

    expect(taxResult.taxAmount).toBe(0);
    expect(taxResult.taxRate).toBe(0);
  });

  it('should apply tax to non-exempt clients', async () => {
    // Create a non-exempt client
    const client_id = await context.createEntity<IClient>('clients', {
      client_name: 'Non-Exempt Client',
      is_tax_exempt: false,
      tax_region: 'US-NY',
      client_id: uuidv4(),
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
    }, 'client_id');

    // Create default tax settings
    await createDefaultTaxSettings(client_id);

    // Create a test charge
    const chargeAmount = 10000; // $100.00 in cents
    const currentDate = Temporal.Now.plainDateISO().toString();
    const taxResult = await taxService.calculateTax(client_id, chargeAmount, currentDate);

    expect(taxResult.taxAmount).toBeGreaterThan(0);
    expect(parseInt(taxResult.taxRate.toString())).toBeGreaterThan(0);
  });

  it('should handle tax exemption status changes', async () => {
    // Create a client
    const client_id = await context.createEntity<IClient>('clients', {
      client_name: 'Status Change Client',
      is_tax_exempt: false,
      tax_region: 'US-NY',
      client_id: uuidv4(),
      phone_no: '',
      credit_balance: 0,
      email: '',
      url: '',
      address: '',
      created_at: Temporal.Now.plainDateISO().toString(),
      updated_at: Temporal.Now.plainDateISO().toString(),
      is_inactive: false,
      billing_cycle: 'weekly'
    }, 'client_id');

    // Create default tax settings
    await createDefaultTaxSettings(client_id);

    // Test as non-exempt
    const chargeAmount = 10000;
    const currentDate = Temporal.Now.plainDateISO().toString();
    let taxResult = await taxService.calculateTax(client_id, chargeAmount, currentDate);
    expect(taxResult.taxAmount).toBeGreaterThan(0);

    // Update to exempt
    await context.db('clients')
      .where({ client_id: client_id })
      .update({ is_tax_exempt: true });

    // Test as exempt
    taxResult = await taxService.calculateTax(client_id, chargeAmount, currentDate);
    expect(taxResult.taxAmount).toBe(0);
  });
});