import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { TestContext } from '../../../../../test-utils/testContext';
import {
  createTestService,
  createFixedPlanAssignment as createFixedContractLineAssignment,
  addServiceToFixedPlan as addServiceToFixedContractLine,
  setupClientTaxConfiguration,
  assignServiceTaxRate,
  ensureDefaultBillingSettings,
  ensureClientPlanBundlesTable as ensureClientContractsTable
} from '../../../../../test-utils/billingTestHelpers';
import { generateInvoice } from 'server/src/lib/actions/invoiceGeneration';
import { generateManualInvoice } from 'server/src/lib/actions/manualInvoiceActions';
import { finalizeInvoice } from 'server/src/lib/actions/invoiceModification';
import { BillingEngine } from 'server/src/lib/billing/billingEngine';
import { TextEncoder as NodeTextEncoder } from 'util';
import { setupCommonMocks } from '../../../../../test-utils/testMocks';
import { v4 as uuidv4 } from 'uuid';
import { Temporal } from '@js-temporal/polyfill';
import type { IClient } from 'server/src/interfaces/client.interfaces';

let mockedTenantId = '11111111-1111-1111-1111-111111111111';
let mockedUserId = 'mock-user-id';

vi.mock('server/src/lib/auth/getSession', () => ({
  getSession: vi.fn(async () => ({
    user: {
      id: mockedUserId,
      tenant: mockedTenantId
    }
  }))
}));

vi.mock('server/src/lib/analytics/posthog', () => ({
  analytics: {
    capture: vi.fn(),
    identify: vi.fn(),
    trackPerformance: vi.fn(),
    getClient: () => null
  }
}));

vi.mock('@alga-psa/shared/db', () => ({
  withTransaction: vi.fn(async (knex, callback) => callback(knex)),
  withAdminTransaction: vi.fn(async (callback, existingConnection) => callback(existingConnection as any))
}));

vi.mock('@alga-psa/shared/core/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

vi.mock('@alga-psa/shared/core/secretProvider', () => ({
  getSecretProviderInstance: () => ({
    getSecret: async () => undefined,
    getAppSecret: async () => undefined,
    setSecret: async () => {},
    getProviderName: () => 'MockSecretProvider',
    close: async () => {}
  })
}));

vi.mock('@alga-psa/shared/core', () => ({
  getSecretProviderInstance: () => ({
    getSecret: async () => undefined,
    getAppSecret: async () => undefined,
    setSecret: async () => {},
    getProviderName: () => 'MockSecretProvider',
    close: async () => {}
  })
}));

vi.mock('@alga-psa/shared/workflow/persistence', () => ({
  WorkflowEventModel: {
    create: vi.fn()
  }
}));

vi.mock('@alga-psa/shared/workflow/streams', () => ({
  getRedisStreamClient: () => ({
    publishEvent: vi.fn()
  }),
  toStreamEvent: (event: unknown) => event
}));

vi.mock('server/src/lib/auth/rbac', () => ({
  hasPermission: vi.fn(() => Promise.resolve(true))
}));

const globalForVitest = globalThis as { TextEncoder: typeof NodeTextEncoder };
globalForVitest.TextEncoder = NodeTextEncoder;

const {
  beforeAll: setupContext,
  beforeEach: resetContext,
  afterEach: rollbackContext,
  afterAll: cleanupContext
} = TestContext.createHelpers();

describe('Billing Invoice Tax Calculations', () => {
  let context: TestContext;

  async function ensureDefaultTax() {
    await setupClientTaxConfiguration(context, {
      regionCode: 'US-NY',
      regionName: 'New York',
      description: 'NY State + City Tax',
      startDate: '2025-01-01T00:00:00.000Z',
      taxPercentage: 10 // easier math for tests
    });
    await assignServiceTaxRate(context, '*', 'US-NY', { onlyUnset: false });
    await ensureClientContractsTable(context);
  }

  beforeAll(async () => {
    context = await setupContext({
      runSeeds: false,
      cleanupTables: [
        'invoice_items',
        'invoices',
        'usage_tracking',
        'bucket_usage',
        'time_entries',
        'tickets',
        'client_billing_cycles',
        'client_contract_lines',
        'contract_line_services',
        'contract_line_service_configuration',
        'contract_line_service_fixed_config',
        'contract_line_mappings',
        'service_catalog',
        'contract_lines',
        'contracts',
        'client_contracts',
        'contract_pricing_schedules',
        'bucket_plans',
        'tax_rates',
        'tax_regions',
        'client_tax_settings',
        'client_tax_rates'
      ],
      clientName: 'Tax Test Client',
      userType: 'internal'
    });

    const mockContext = setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      permissionCheck: () => true
    });

    mockedTenantId = mockContext.tenantId;
    mockedUserId = mockContext.userId;

    await ensureDefaultTax();
    await ensureDefaultBillingSettings(context);
  }, 60000);

  beforeEach(async () => {
    context = await resetContext();
    const mockContext = setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      permissionCheck: () => true
    });

    mockedTenantId = mockContext.tenantId;
    mockedUserId = mockContext.userId;

    await ensureDefaultTax();
    await ensureDefaultBillingSettings(context);
  }, 30000);

  afterEach(async () => {
    await rollbackContext();
  }, 30000);

  afterAll(async () => {
    await cleanupContext();
  }, 30000);

  describe('Tax Calculation', () => {
    it('should verify total calculation when subtotal is zero but tax is positive', async () => {
      // Create test client
      const client_id = await context.createEntity<IClient>('clients', {
        client_name: 'Discount Tax Test Client',
        billing_cycle: 'monthly',
        client_id: uuidv4(),
        region_code: 'US-NY',
        is_tax_exempt: false,
        created_at: Temporal.Now.plainDateISO().toString(),
        updated_at: Temporal.Now.plainDateISO().toString(),
        credit_balance: 0,
        url: '',
        is_inactive: false
      }, 'client_id');

      // Ensure tax region exists
      await context.db('tax_regions').insert({
        tenant: context.tenantId,
        region_code: 'US-NY',
        region_name: 'New York',
        is_active: true
      }).onConflict(['tenant', 'region_code']).ignore();

      // Create NY tax rate (10% for easy calculation)
      const nyTaxRate = await context.db('tax_rates')
        .where({ tenant: context.tenantId, region_code: 'US-NY', is_active: true })
        .first('tax_rate_id');

      if (!nyTaxRate) {
        throw new Error('Expected active NY tax rate to be present from default configuration');
      }

      const nyTaxRateId = nyTaxRate.tax_rate_id as string;

      // Set up client tax settings
      await context.db('client_tax_settings').insert({
        client_id: client_id,
        tenant: context.tenantId,
        is_reverse_charge_applicable: false
      });

      // Set up client tax rate relationship
      await context.db('client_tax_rates').insert({
        client_tax_rates_id: uuidv4(),
        client_id: client_id,
        tenant: context.tenantId,
        tax_rate_id: nyTaxRateId,
        is_default: true,
        created_at: context.db.fn.now(),
        updated_at: context.db.fn.now()
      });

      const taxableService = await createTestService(context, {
        service_name: 'Taxable Service',
        billing_method: 'fixed',
        default_rate: 10000, // $100.00
        unit_of_measure: 'unit',
        tax_region: 'US-NY',
        tax_rate_id: nyTaxRateId
      });

      const manualInvoice = await generateManualInvoice({
        clientId: client_id,
        items: [
          {
            service_id: taxableService,
            description: 'Taxable Service',
            quantity: 1,
            rate: 10000
          },
          {
            description: 'Full Discount',
            quantity: 1,
            rate: -10000,
            is_discount: true,
            discount_type: 'fixed',
            applies_to_service_id: taxableService
          }
        ]
      });

      await finalizeInvoice(manualInvoice.invoice_id);

      const invoice = await context.db('invoices')
        .where({ invoice_id: manualInvoice.invoice_id, tenant: context.tenantId })
        .first();

      expect(invoice).not.toBeNull();
      expect(Number(invoice!.subtotal)).toBe(0);    // $0.00 after discount
      expect(Number(invoice!.tax)).toBe(1000);      // $10.00 (10% of original $100)
      expect(Number(invoice!.total_amount)).toBe(1000); // $10.00 (tax only)

      const invoiceItems = await context.db('invoice_items')
        .where({ invoice_id: manualInvoice.invoice_id, tenant: context.tenantId })
        .orderBy('net_amount', 'desc');

      expect(invoiceItems).toHaveLength(2);

      const taxableItem = invoiceItems.find(item => item.service_id === taxableService);
      expect(taxableItem).toBeDefined();
      expect(Number(taxableItem!.net_amount)).toBe(10000);
      expect(Number(taxableItem!.tax_amount)).toBe(1000);

      const discountItem = invoiceItems.find(item => item.is_discount === true);
      expect(discountItem).toBeDefined();
      expect(Number(discountItem!.net_amount)).toBe(-10000);
      expect(Number(discountItem!.tax_amount)).toBe(0);
    });

    it('should calculate tax correctly for services with different tax regions', async () => {
      const clientId = await context.createEntity<IClient>('clients', {
        client_name: 'Multi-Region Tax Test Client',
        billing_cycle: 'monthly',
        client_id: uuidv4(),
        region_code: 'US-NY',
        is_tax_exempt: false,
        credit_balance: 0,
        url: '',
        is_inactive: false,
        created_at: Temporal.Now.plainDateISO().toString(),
        updated_at: Temporal.Now.plainDateISO().toString()
      }, 'client_id');

      await context.db('tax_regions').insert([
        {
          tenant: context.tenantId,
          region_code: 'US-NY',
          region_name: 'New York',
          is_active: true
        },
        {
          tenant: context.tenantId,
          region_code: 'US-CA',
          region_name: 'California',
          is_active: true
        }
      ]).onConflict(['tenant', 'region_code']).ignore();

      await context.db('tax_rates')
        .where({ tenant: context.tenantId, region_code: 'US-NY' })
        .update({ is_active: false });

      const nyTaxRateId = await context.createEntity('tax_rates', {
        region_code: 'US-NY',
        tax_percentage: 8.875,
        description: 'NY State + City Tax',
        start_date: '2025-02-01',
        is_active: true
      }, 'tax_rate_id');

      await context.db('client_tax_settings').insert({
        client_id: clientId,
        tenant: context.tenantId,
        is_reverse_charge_applicable: false
      });

      await context.db('client_tax_rates').insert({
        client_tax_rates_id: uuidv4(),
        client_id: clientId,
        tenant: context.tenantId,
        tax_rate_id: nyTaxRateId,
        is_default: true,
        created_at: context.db.fn.now(),
        updated_at: context.db.fn.now()
      });

      const serviceNY = await createTestService(context, {
        service_name: 'NY Service',
        billing_method: 'fixed',
        default_rate: 1000,
        unit_of_measure: 'unit',
        tax_region: 'US-NY',
        tax_rate_id: nyTaxRateId
      });

      await createFixedContractLineAssignment(context, serviceNY, {
        planName: 'Multi-Region Contract Line',
        billingFrequency: 'monthly',
        baseRateCents: 1000,
        detailBaseRateCents: 1000,
        startDate: '2025-02-01T00:00:00.000Z',
        clientId
      });

      const caTaxRateId = await context.createEntity('tax_rates', {
        region_code: 'US-CA',
        tax_percentage: 8.0,
        description: 'CA State Tax',
        start_date: '2025-01-01'
      }, 'tax_rate_id');

      const serviceCA = await createTestService(context, {
        service_name: 'CA Service',
        billing_method: 'fixed',
        default_rate: 500,
        unit_of_measure: 'unit',
        tax_region: 'US-CA',
        tax_rate_id: caTaxRateId
      });

      await createFixedContractLineAssignment(context, serviceCA, {
        planName: 'CA Contract Line',
        billingFrequency: 'monthly',
        baseRateCents: 500,
        detailBaseRateCents: 500,
        startDate: '2025-02-01T00:00:00.000Z',
        clientId
      });

      await assignServiceTaxRate(context, serviceNY, 'US-NY');
      await assignServiceTaxRate(context, serviceCA, 'US-CA');

      await context.db('client_tax_rates').insert({
        client_tax_rates_id: uuidv4(),
        client_id: clientId,
        tenant: context.tenantId,
        tax_rate_id: caTaxRateId,
        is_default: false,
        created_at: context.db.fn.now(),
        updated_at: context.db.fn.now()
      });

      const billingCycleId = await context.createEntity('client_billing_cycles', {
        client_id: clientId,
        billing_cycle: 'monthly',
        effective_date: '2025-02-01',
        period_start_date: '2025-02-01',
        period_end_date: '2025-03-01'
      }, 'billing_cycle_id');

      const invoice = await generateInvoice(billingCycleId);

      const invoiceItems = await context.db('invoice_items')
        .where({ invoice_id: invoice!.invoice_id, tenant: context.tenantId })
        .orderBy('description', 'asc');

      const totalItemTax = invoiceItems.reduce((sum, item) => sum + Number(item.tax_amount), 0);
      expect(totalItemTax).toBe(Number(invoice!.tax));

      // Verify tax calculations:
      // NY Service: $10.00 * 8.875% = $0.89 (rounded up)
      // CA Service: $5.00 * 8.0% = $0.40
      // Total tax should be $1.29
      expect(invoice!.subtotal).toBe(1500); // $15.00
      expect(invoice!.tax).toBe(129); // $1.29
      expect(invoice!.total_amount).toBe(1629); // $16.29
    });

    it('should handle tax calculation correctly with mixed positive and negative amounts', async () => {
      // Create test client
      const client_id = await context.createEntity<IClient>('clients', {
        client_name: 'Mixed Tax Test Client',
        billing_cycle: 'monthly',
        client_id: uuidv4(),
        region_code: 'US-NY',
        is_tax_exempt: false,
        created_at: Temporal.Now.plainDateISO().toString(),
        updated_at: Temporal.Now.plainDateISO().toString(),
        credit_balance: 0,
        url: '',
        is_inactive: false
      }, 'client_id');

      // Ensure tax region exists
      await context.db('tax_regions').insert({
        tenant: context.tenantId,
        region_code: 'US-NY',
        region_name: 'New York',
        is_active: true
      }).onConflict(['tenant', 'region_code']).ignore();

      // Create NY tax rate
      const nyTaxRateId = await context.createEntity('tax_rates', {
        region_code: 'US-NY',
        tax_percentage: 8.875,
        description: 'NY State + City Tax',
        start_date: '2025-01-01'
      }, 'tax_rate_id');

      // Set up client tax settings
      await context.db('client_tax_settings').insert({
        client_id: client_id,
        tenant: context.tenantId,
        is_reverse_charge_applicable: false
      });

      // Set up client tax rate relationship
      await context.db('client_tax_rates').insert({
        client_tax_rates_id: uuidv4(),
        client_id: client_id,
        tenant: context.tenantId,
        tax_rate_id: nyTaxRateId,
        is_default: true,
        created_at: context.db.fn.now(),
        updated_at: context.db.fn.now()
      });

      const regularService = await createTestService(context, {
        service_name: 'Regular Service',
        billing_method: 'fixed',
        default_rate: 1000,
        unit_of_measure: 'unit',
        tax_region: 'US-NY',
        tax_rate_id: nyTaxRateId
      });

      const creditService = await createTestService(context, {
        service_name: 'Credit Service',
        billing_method: 'fixed',
        default_rate: -200,
        unit_of_measure: 'unit',
        tax_region: 'US-NY'
      });

      const discountService = await createTestService(context, {
        service_name: 'Manual Discount',
        billing_method: 'fixed',
        default_rate: -100,
        unit_of_measure: 'unit',
        tax_region: 'US-NY'
      });

      const manualInvoice = await generateManualInvoice({
        clientId: client_id,
        items: [
          {
            service_id: regularService,
            description: 'Regular Service',
            quantity: 1,
            rate: 1000
          },
          {
            service_id: creditService,
            description: 'Credit Service',
            quantity: 1,
            rate: -200
          },
          {
            description: 'Manual Discount',
            quantity: 1,
            rate: -100,
            is_discount: true,
            discount_type: 'fixed',
            applies_to_service_id: regularService
          }
        ]
      });

      await finalizeInvoice(manualInvoice.invoice_id);

      const updatedInvoice = await context.db('invoices')
        .where({ invoice_id: manualInvoice.invoice_id, tenant: context.tenantId })
        .first();

      const invoiceItems = await context.db('invoice_items')
        .where({ invoice_id: manualInvoice.invoice_id, tenant: context.tenantId })
        .orderBy('net_amount', 'desc');

      const subtotal = invoiceItems.reduce((sum, item) => sum + Number(item.net_amount), 0);
      expect(Number(updatedInvoice!.subtotal)).toBe(subtotal);

      const positiveItem = invoiceItems.find((item) => Number(item.net_amount) > 0);
      expect(positiveItem).toBeDefined();
      expect(Number(positiveItem!.net_amount)).toBe(1000);
      expect(Number(positiveItem!.tax_amount)).toBe(189);

      const creditItem = invoiceItems.find((item) => item.service_id === creditService);
      expect(creditItem).toBeDefined();
      expect(Number(creditItem!.net_amount)).toBe(-200);
      expect(Number(creditItem!.tax_amount)).toBe(0);

      const discountItem = invoiceItems.find((item) => item.is_discount);
      expect(discountItem).toBeDefined();
      expect(Number(discountItem!.net_amount)).toBe(-100);
      expect(Number(discountItem!.tax_amount)).toBe(0);

      expect(Number(updatedInvoice!.subtotal)).toBe(700);
      expect(Number(updatedInvoice!.tax)).toBe(189);
      expect(Number(updatedInvoice!.total_amount)).toBe(889);
    });
  });

  describe("Tax Calculation with Tax-Exempt Line Items", () => {
    it("should only calculate tax for taxable line items", async () => {
      // Create test client with tax settings
      const client_id = await context.createEntity('clients', {
        client_name: 'Tax Exempt Test Client',
        billing_cycle: 'monthly',
        client_id: uuidv4(),
        region_code: 'US-NY',
        is_tax_exempt: false,
        created_at: Temporal.Now.plainDateISO().toString(),
        updated_at: Temporal.Now.plainDateISO().toString(),
        credit_balance: 0,
        url: '',
        is_inactive: false
      }, 'client_id');

      // Ensure tax region exists
      await context.db('tax_regions').insert({
        tenant: context.tenantId,
        region_code: 'US-NY',
        region_name: 'New York',
        is_active: true
      }).onConflict(['tenant', 'region_code']).ignore();

      const nyTaxRate = await context.db('tax_rates')
        .where({ tenant: context.tenantId, region_code: 'US-NY', is_active: true })
        .first('tax_rate_id');

      if (!nyTaxRate) {
        throw new Error('Expected default NY tax rate to be available');
      }

      const nyTaxRateId = nyTaxRate.tax_rate_id as string;

      // Set up client tax settings
      await context.db('client_tax_settings').insert({
        client_id: client_id,
        tenant: context.tenantId,
        is_reverse_charge_applicable: false
      });

      // Set up client tax rate relationship
      await context.db('client_tax_rates').insert({
        client_tax_rates_id: uuidv4(),
        client_id: client_id,
        tenant: context.tenantId,
        tax_rate_id: nyTaxRateId,
        is_default: true,
        created_at: context.db.fn.now(),
        updated_at: context.db.fn.now()
      });

      // Ensure tax rate is active
      await context.db('tax_rates')
        .where({ tax_rate_id: nyTaxRateId })
        .update({ is_active: true });

      // Create services with different tax settings
      const taxableService = await createTestService(context, {
        service_name: 'Taxable Service',
        billing_method: 'fixed',
        default_rate: 10000, // $100.00
        unit_of_measure: 'unit',
        tax_rate_id: nyTaxRateId
      });

      const nonTaxableService = await createTestService(context, {
        service_name: 'Non-Taxable Service',
        billing_method: 'fixed',
        default_rate: 5000, // $50.00
        unit_of_measure: 'unit'
      });

      const mixedTaxInvoice = await generateManualInvoice({
        clientId: client_id,
        items: [
          {
            service_id: taxableService,
            description: 'Taxable Service',
            quantity: 1,
            rate: 10000
          },
          {
            service_id: nonTaxableService,
            description: 'Non-Taxable Service',
            quantity: 1,
            rate: 5000
          }
        ]
      });

      await finalizeInvoice(mixedTaxInvoice.invoice_id);

      const persistedInvoice = await context.db('invoices')
        .where({ invoice_id: mixedTaxInvoice.invoice_id, tenant: context.tenantId })
        .first();

      const invoiceItems = await context.db('invoice_items')
        .where({ invoice_id: mixedTaxInvoice.invoice_id, tenant: context.tenantId })
        .orderBy('net_amount', 'desc');

      const taxableItem = invoiceItems.find(item => item.service_id === taxableService);
      const nonTaxableItem = invoiceItems.find(item => item.service_id === nonTaxableService);

      expect(taxableItem).toBeDefined();
      expect(Number(taxableItem!.net_amount)).toBe(10000); // $100.00
      expect(Number(taxableItem!.tax_amount)).toBe(1000);  // $10.00
      expect(Number(taxableItem!.total_price)).toBe(11000);

      expect(nonTaxableItem).toBeDefined();
      expect(Number(nonTaxableItem!.net_amount)).toBe(5000);  // $50.00
      expect(Number(nonTaxableItem!.tax_amount)).toBe(0);     // No tax
      expect(Number(nonTaxableItem!.total_price)).toBe(5000);

      expect(Number(persistedInvoice!.subtotal)).toBe(15000); // $150.00
      expect(Number(persistedInvoice!.tax)).toBe(1000);       // $10.00 (only from taxable service)
      expect(Number(persistedInvoice!.total_amount)).toBe(16000); // $160.00
    });
  });

  it('should verify total calculation when subtotal is positive but tax is zero', async () => {
    // Create test client with tax exempt status
    const client_id = await context.createEntity<IClient>('clients', {
      client_name: 'Tax Exempt Client',
      billing_cycle: 'monthly',
      client_id: uuidv4(),
      region_code: 'US-NY',
      is_tax_exempt: true, // Set client as tax exempt
      created_at: Temporal.Now.plainDateISO().toString(),
      updated_at: Temporal.Now.plainDateISO().toString(),
      credit_balance: 0,
      url: '',
      is_inactive: false
    }, 'client_id');

    // Ensure tax region exists
    await context.db('tax_regions').insert({
      tenant: context.tenantId,
      region_code: 'US-NY',
      region_name: 'New York',
      is_active: true
    }).onConflict(['tenant', 'region_code']).ignore();

    // Create NY tax rate (10% but won't be applied due to tax exempt status)
    const nyTaxRateId = await context.createEntity('tax_rates', {
      region_code: 'US-NY',
      tax_percentage: 10.0,
      description: 'NY Test Tax',
      start_date: '2025-01-01'
    }, 'tax_rate_id');

    // Set up client tax settings
    await context.db('client_tax_settings').insert({
      client_id: client_id,
      tenant: context.tenantId,
      is_reverse_charge_applicable: false
    });

    // Set up client tax rate relationship
    await context.db('client_tax_rates').insert({
      client_tax_rates_id: uuidv4(),
      client_id: client_id,
      tenant: context.tenantId,
      tax_rate_id: nyTaxRateId,
      is_default: true,
      created_at: context.db.fn.now(),
      updated_at: context.db.fn.now()
    });

    // Create a service with a simple price for clear calculations
    const service = await createTestService(context, {
      service_name: 'Basic Service',
      billing_method: 'fixed',
      default_rate: 10000, // $100.00
      unit_of_measure: 'unit',
      tax_rate_id: nyTaxRateId
    });

    const { contractLineId: _basicContractLineId } = await createFixedContractLineAssignment(context, service, {
      planName: 'Basic Contract Line',
      billingFrequency: 'monthly',
      baseRateCents: 10000,
      detailBaseRateCents: 10000,
      clientId: client_id,
      startDate: '2025-02-01T00:00:00.000Z'
    });

    // Create billing cycle
    const billingCycle = await context.createEntity('client_billing_cycles', {
      client_id: client_id,
      billing_cycle: 'monthly',
      effective_date: '2025-02-01',
      period_start_date: '2025-02-01',
      period_end_date: '2025-03-01'
    }, 'billing_cycle_id');

    // Generate invoice
    const invoice = await generateInvoice(billingCycle);

    // Verify calculations:
    // - Service price: $100.00 (10000 cents)
    // - Tax: $0.00 (0 cents) because client is tax exempt
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
    // Create test client
    const client_id = await context.createEntity<IClient>('clients', {
      client_name: 'Basic Tax Test Client',
      billing_cycle: 'monthly',
      client_id: uuidv4(),
      region_code: 'US-NY',
      is_tax_exempt: false,
      created_at: Temporal.Now.plainDateISO().toString(),
      updated_at: Temporal.Now.plainDateISO().toString(),
      credit_balance: 0,
      url: '',
      is_inactive: false
    }, 'client_id');

    // Ensure tax region exists
    await context.db('tax_regions').insert({
      tenant: context.tenantId,
      region_code: 'US-NY',
      region_name: 'New York',
      is_active: true
    }).onConflict(['tenant', 'region_code']).ignore();

    const nyTaxRate = await context.db('tax_rates')
      .where({ tenant: context.tenantId, region_code: 'US-NY', is_active: true })
      .first('tax_rate_id');

    if (!nyTaxRate) {
      throw new Error('Expected NY tax rate to exist');
    }

    const nyTaxRateId = nyTaxRate.tax_rate_id as string;

    // Set up client tax settings
    await context.db('client_tax_settings').insert({
      client_id: client_id,
      tenant: context.tenantId,
      is_reverse_charge_applicable: false
    });

    // Set up client tax rate relationship
    await context.db('client_tax_rates').insert({
      client_tax_rates_id: uuidv4(),
      client_id: client_id,
      tenant: context.tenantId,
      tax_rate_id: nyTaxRateId,
      is_default: true,
      created_at: context.db.fn.now(),
      updated_at: context.db.fn.now()
    });

    // Create a service with a simple price for clear calculations
    const service = await createTestService(context, {
      service_name: 'Basic Service',
      billing_method: 'fixed',
      default_rate: 10000, // $100.00
      unit_of_measure: 'unit',
      tax_rate_id: nyTaxRateId
    });

    const manualInvoice = await generateManualInvoice({
      clientId: client_id,
      items: [
        {
          service_id: service,
          description: 'Basic Service',
          quantity: 1,
          rate: 10000
        }
      ]
    });

    await finalizeInvoice(manualInvoice.invoice_id);

    const invoice = await context.db('invoices')
      .where({ invoice_id: manualInvoice.invoice_id, tenant: context.tenantId })
      .first();

    expect(invoice).not.toBeNull();
    expect(Number(invoice!.subtotal)).toBe(10000); // $100.00
    expect(Number(invoice!.tax)).toBe(1000);       // $10.00
    expect(Number(invoice!.total_amount)).toBe(11000); // $110.00
    expect(Number(invoice!.subtotal)).toBeGreaterThan(0);
    expect(Number(invoice!.tax)).toBeGreaterThan(0);
  });
  
  it('should correctly handle different tax regions during invoice recalculation', async () => {
    // Create test client
    const client_id = await context.createEntity<IClient>('clients', {
      client_name: 'Tax Recalculation Test Client',
      billing_cycle: 'monthly',
      client_id: uuidv4(),
      region_code: 'US-NY', // Default tax region
      is_tax_exempt: false,
      credit_balance: 0,
      url: '',
      is_inactive: false,
      created_at: Temporal.Now.plainDateISO().toString(),
      updated_at: Temporal.Now.plainDateISO().toString()
    }, 'client_id');

    // Ensure tax regions exist
    await context.db('tax_regions').insert([
      {
        tenant: context.tenantId,
        region_code: 'US-NY',
        region_name: 'New York',
        is_active: true
      },
      {
        tenant: context.tenantId,
        region_code: 'US-CA',
        region_name: 'California',
        is_active: true
      }
    ]).onConflict(['tenant', 'region_code']).ignore();

    // Create tax rates for different regions
    await context.db('tax_rates')
      .where({ tenant: context.tenantId, region_code: 'US-NY' })
      .update({ is_active: false });

    const nyTaxRateId = await context.createEntity('tax_rates', {
      region_code: 'US-NY',
      tax_percentage: 8.875,
      description: 'NY State + City Tax',
      start_date: '2025-01-01'
    }, 'tax_rate_id');

    await context.db('tax_rates')
      .where({ tenant: context.tenantId, region_code: 'US-CA' })
      .update({ is_active: false });

    const caTaxRateId = await context.createEntity('tax_rates', {
      region_code: 'US-CA',
      tax_percentage: 8.0,
      description: 'CA State Tax',
      start_date: '2025-01-01'
    }, 'tax_rate_id');

    // Set up client tax settings
    await context.db('client_tax_settings').insert({
      client_id: client_id,
      tenant: context.tenantId,
      is_reverse_charge_applicable: false
    });

    // Set up client tax rate relationship
    await context.db('client_tax_rates').insert({
      client_tax_rates_id: uuidv4(),
      client_id: client_id,
      tenant: context.tenantId,
      tax_rate_id: nyTaxRateId,
      is_default: true,
      created_at: context.db.fn.now(),
      updated_at: context.db.fn.now()
    });

    // Create services with different tax regions
    const serviceNY = await createTestService(context, {
      service_name: 'NY Service',
      billing_method: 'fixed',
      default_rate: 1000,
      unit_of_measure: 'unit',
      tax_rate_id: nyTaxRateId
    });

    const serviceCA = await createTestService(context, {
      service_name: 'CA Service',
      billing_method: 'fixed',
      default_rate: 500,
      unit_of_measure: 'unit',
      tax_rate_id: caTaxRateId
    });

    // Create initial invoice with NY service
    const initialInvoice = await generateManualInvoice({
      clientId: client_id,
      items: [{
        service_id: serviceNY,
        quantity: 1,
        description: 'NY Service Item',
        rate: 1000
      }]
    });

    // Get invoice ID
    const invoiceId = initialInvoice.invoice_id;

    // Verify initial calculations
    expect(initialInvoice.subtotal).toBe(1000);
    expect(initialInvoice.tax).toBe(89); // 8.875% of 1000 = 88.75, rounded to 89

    // Set up for recalculation by ensuring dates are in a format that Temporal.PlainDate.from() can parse
    const today = new Date().toISOString().split('T')[0]; // Format: YYYY-MM-DD
    await context.db('invoices')
      .where({ invoice_id: invoiceId })
      .update({
        invoice_date: today,
        due_date: today
      });

    // Update invoice by adding a CA service item
    const billingEngine = new BillingEngine();
    
    // First update the invoice items
    await context.db('invoice_items').where({ invoice_id: invoiceId }).delete();
    
    // Insert both the NY and CA items
    await context.db('invoice_items').insert([
      {
        item_id: uuidv4(),
        invoice_id: invoiceId,
        service_id: serviceNY,
        description: 'NY Service Item',
        quantity: 1,
        unit_price: 1000,
        net_amount: 1000,
        tax_amount: 0, // Will be recalculated
        tax_rate: 0,   // Will be recalculated
        tax_region: 'US-NY',
        is_taxable: true,
        is_discount: false,
        total_price: 1000,
        tenant: context.tenantId,
        created_at: new Date().toISOString(),
        created_by: 'test'
      },
      {
        item_id: uuidv4(),
        invoice_id: invoiceId,
        service_id: serviceCA,
        description: 'CA Service Item',
        quantity: 1,
        unit_price: 500,
        net_amount: 500,
        tax_amount: 0, // Will be recalculated
        tax_rate: 0,   // Will be recalculated
        tax_region: 'US-CA',
        is_taxable: true,
        is_discount: false,
        total_price: 500,
        tenant: context.tenantId,
        created_at: new Date().toISOString(),
        created_by: 'test'
      }
    ]);
    
    // Trigger recalculation
    await billingEngine.recalculateInvoice(invoiceId);
    
    // Fetch updated invoice
    const updatedInvoice = await context.db('invoices')
      .where({ invoice_id: invoiceId })
      .first();
      
    // Fetch updated items
    const updatedItems = await context.db('invoice_items')
      .where({ invoice_id: invoiceId })
      .orderBy('created_at', 'asc');

    // Verify both items are present
    expect(updatedItems).toHaveLength(2);

    // Verify NY service item
    const nyItem = updatedItems.find((item) => item.service_id === serviceNY)!;
    expect(nyItem).toBeDefined();
    expect(Number(nyItem.net_amount)).toBe(1000);
    expect(Number(nyItem.tax_amount)).toBeGreaterThan(0); // Should have NY tax

    // Verify CA service item
    const caItem = updatedItems.find((item) => item.service_id === serviceCA)!;
    expect(caItem).toBeDefined();
    expect(Number(caItem.net_amount)).toBe(500);
    expect(Number(caItem.tax_amount)).toBeGreaterThan(0); // Should have CA tax

    // Verify totals
    expect(updatedInvoice).toBeDefined();
    expect(Number(updatedInvoice!.subtotal)).toBe(1500); // $15.00
    expect(Number(updatedInvoice!.tax)).toBeGreaterThan(0); // Should have combined tax
  });

  it('distributes tax across services from different regions', async () => {
    // Ensure California tax rate exists (7.25%)
    await setupClientTaxConfiguration(context, {
      regionCode: 'US-CA',
      regionName: 'California',
      description: 'CA State Tax',
      taxPercentage: 7.25,
      startDate: '2025-01-01T00:00:00.000Z'
    });

    const nyService = await createTestService(context, {
      service_name: 'NY Service',
      default_rate: 10000,
      tax_region: 'US-NY'
    });

    const caService = await createTestService(context, {
      service_name: 'CA Service',
      default_rate: 20000,
      tax_region: 'US-CA'
    });

    await assignServiceTaxRate(context, caService, 'US-CA');

    const { contractLineId } = await createFixedContractLineAssignment(context, nyService, {
      planName: 'Multi Region Contract Line',
      baseRateCents: 30000,
      detailBaseRateCents: 10000,
      startDate: '2025-02-01'
    });

    await addServiceToFixedContractLine(context, contractLineId, caService, { detailBaseRateCents: 20000 });

    const billingCycle = await context.createEntity('client_billing_cycles', {
      client_id: context.clientId,
      billing_cycle: 'monthly',
      effective_date: '2025-02-01',
      period_start_date: '2025-02-01',
      period_end_date: '2025-03-01',
      tenant: context.tenantId
    }, 'billing_cycle_id');

    const invoice = await generateInvoice(billingCycle);

    expect(invoice).not.toBeNull();

    // Get the invoice items
    const items = await context.db('invoice_items')
      .where({ invoice_id: invoice!.invoice_id, tenant: context.tenantId })
      .orderBy('created_at', 'asc');

    // Verify we have a consolidated item
    expect(items).toHaveLength(1);

    // The contract line consolidates services into a single invoice item
    // Base rate is $300.00 (30000 cents) for the entire contract line
    expect(invoice!.subtotal).toBe(30000); // $300.00

    // Tax should be calculated on the consolidated amount
    // Since the consolidated item uses the first service's tax region (US-NY with 10% rate)
    // or a weighted average, verify tax exists and is reasonable
    expect(invoice!.tax).toBeGreaterThan(0);
    expect(Number(items[0].tax_amount)).toBe(invoice!.tax);

    // The total should be subtotal + tax
    expect(invoice!.total_amount).toBe(invoice!.subtotal + invoice!.tax);

    // Verify the consolidated item has tax information
    expect(items[0].is_taxable).toBe(true);
    expect(items[0].tax_region).toBeTruthy();
    expect(Number(items[0].net_amount)).toBe(30000);
  });
});
