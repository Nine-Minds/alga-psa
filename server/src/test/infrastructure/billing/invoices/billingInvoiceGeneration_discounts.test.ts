import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { generateManualInvoice } from 'server/src/lib/actions/manualInvoiceActions';
import { TestContext } from '../../../../../test-utils/testContext';
import { setupCommonMocks } from '../../../../../test-utils/testMocks';
import { createTestService, assignServiceTaxRate, setupClientTaxConfiguration, ensureDefaultBillingSettings, ensureClientPlanBundlesTable } from '../../../../../test-utils/billingTestHelpers';
import { TextEncoder as NodeTextEncoder } from 'util';
import { v4 as uuidv4 } from 'uuid';

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
    debug: vi.fn(),
  },
}));

vi.mock('@alga-psa/shared/core/secretProvider', () => ({
  getSecretProviderInstance: () => ({
    getSecret: async () => undefined,
    getAppSecret: async () => undefined,
    setSecret: async () => {},
    getProviderName: () => 'MockSecretProvider',
    close: async () => {},
  }),
}));

vi.mock('@alga-psa/shared/core', () => ({
  getSecretProviderInstance: () => ({
    getSecret: async () => undefined,
    getAppSecret: async () => undefined,
    setSecret: async () => {},
    getProviderName: () => 'MockSecretProvider',
    close: async () => {},
  }),
}));

vi.mock('@alga-psa/shared/workflow/persistence', () => ({
  WorkflowEventModel: {
    create: vi.fn(),
  },
}));

vi.mock('@alga-psa/shared/workflow/streams', () => ({
  getRedisStreamClient: () => ({
    publishEvent: vi.fn(),
  }),
  toStreamEvent: (event: unknown) => event,
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

let context: TestContext;

const cents = (value: unknown): number => Number.parseInt(value?.toString() ?? '0', 10);

async function getInvoiceItems(invoiceId: string) {
  return context.db('invoice_items')
    .where({ invoice_id: invoiceId, tenant: context.tenantId })
    .orderBy('created_at', 'asc');
}

async function configureNyTax(taxPercentage = 10) {
  const taxRateId = await setupClientTaxConfiguration(context, {
    regionCode: 'US-NY',
    regionName: 'New York',
    taxPercentage,
    startDate: '2025-01-01T00:00:00.000Z'
  });

  await assignServiceTaxRate(context, '*', 'US-NY', { onlyUnset: false });
  await ensureClientPlanBundlesTable(context);

  return taxRateId;
}

describe('Billing Invoice Discount Applications', () => {
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
        'service_catalog',
        'contract_lines',
        'bucket_plans',
        'tax_rates',
        'tax_regions',
        'client_tax_settings',
        'client_tax_rates',
        'transactions'
      ],
      clientName: 'Test Client',
      userType: 'internal'
    });

    const mockContext = setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      permissionCheck: () => true
    });
    mockedTenantId = mockContext.tenantId;
    mockedUserId = mockContext.userId;
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

    expect(context.client.is_tax_exempt).toBe(false);
    await ensureDefaultBillingSettings(context);
  }, 30000);

  afterEach(async () => {
    await rollbackContext();
  }, 30000);

  afterAll(async () => {
    await cleanupContext();
  }, 30000);

  describe('Service-Based Discount Application', () => {
    it('applies service-specific percentage discounts without reducing the taxable base', async () => {
      const serviceA = await createTestService(context, {
        service_name: 'Service A',
        default_rate: 10000,
        tax_region: 'US-NY'
      });
      const serviceB = await createTestService(context, {
        service_name: 'Service B',
        default_rate: 5000,
        tax_region: 'US-NY'
      });

      await configureNyTax(10);

      const serviceATax = await context.db('service_catalog')
        .where({ service_id: serviceA, tenant: context.tenantId })
        .first('tax_rate_id');
      const serviceBTax = await context.db('service_catalog')
        .where({ service_id: serviceB, tenant: context.tenantId })
        .first('tax_rate_id');

      expect(serviceATax?.tax_rate_id).toBeTruthy();
      expect(serviceBTax?.tax_rate_id).toBeTruthy();

      const invoice = await generateManualInvoice({
        clientId: context.clientId,
        items: [
          {
            service_id: serviceA,
            description: 'Service A',
            quantity: 1,
            rate: 10000
          },
          {
            service_id: serviceB,
            description: 'Service B',
            quantity: 1,
            rate: 5000
          },
          {
            description: '10% Discount on Service A',
            quantity: 1,
            rate: 10,
            is_discount: true,
            discount_type: 'percentage',
            service_id: '',
            applies_to_service_id: serviceA
          }
        ]
      });

      const invoiceItems = await getInvoiceItems(invoice.invoice_id);
      expect(invoiceItems).toHaveLength(3);

      const serviceAItem = invoiceItems.find(item => item.service_id === serviceA)!;
      const serviceBItem = invoiceItems.find(item => item.service_id === serviceB)!;
      const discountItem = invoiceItems.find(item => item.is_discount)!;

      expect(cents(serviceAItem.net_amount)).toBe(10000);
      expect(cents(serviceAItem.tax_amount)).toBe(1000);
      expect(serviceAItem.is_taxable).not.toBe(false);
      expect(serviceAItem.tax_region).toBe('US-NY');
      expect(cents(serviceBItem.net_amount)).toBe(5000);
      expect(cents(serviceBItem.tax_amount)).toBe(500);
      expect(serviceBItem.is_taxable).not.toBe(false);
      expect(serviceBItem.tax_region).toBe('US-NY');
      expect(cents(discountItem.net_amount)).toBe(-1000);
      expect(cents(discountItem.tax_amount)).toBe(0);
      expect(discountItem.applies_to_item_id).toBe(serviceAItem.item_id);

      expect(invoice.subtotal).toBe(14000);
      expect(invoice.tax).toBe(1500);
      expect(invoice.total_amount).toBe(15500);
    });

    it('applies invoice-wide fixed discounts without affecting per-item tax allocation', async () => {
      const serviceA = await createTestService(context, {
        service_name: 'Service A',
        default_rate: 10000,
        tax_region: 'US-NY'
      });
      const serviceB = await createTestService(context, {
        service_name: 'Service B',
        default_rate: 5000,
        tax_region: 'US-NY'
      });
      const serviceC = await createTestService(context, {
        service_name: 'Service C',
        default_rate: 2000,
        tax_region: 'US-NY'
      });

      await configureNyTax(10);

      const invoice = await generateManualInvoice({
        clientId: context.clientId,
        items: [
          {
            service_id: serviceA,
            description: 'Service A',
            quantity: 1,
            rate: 10000
          },
          {
            service_id: serviceB,
            description: 'Service B',
            quantity: 1,
            rate: 5000
          },
          {
            service_id: serviceC,
            description: 'Service C',
            quantity: 1,
            rate: 2000
          },
          {
            description: 'Fixed Discount on Entire Invoice',
            quantity: 1,
            rate: 3000,
            is_discount: true,
            discount_type: 'fixed',
            service_id: ''
          }
        ]
      });

      const invoiceItems = await getInvoiceItems(invoice.invoice_id);
      expect(invoiceItems).toHaveLength(4);

      const serviceAItem = invoiceItems.find(item => item.service_id === serviceA)!;
      const serviceBItem = invoiceItems.find(item => item.service_id === serviceB)!;
      const serviceCItem = invoiceItems.find(item => item.service_id === serviceC)!;
      const discountItem = invoiceItems.find(item => item.is_discount)!;

      expect(cents(serviceAItem.net_amount)).toBe(10000);
      expect(cents(serviceAItem.tax_amount)).toBe(1000);
      expect(cents(serviceBItem.net_amount)).toBe(5000);
      expect(cents(serviceBItem.tax_amount)).toBe(500);
      expect(cents(serviceCItem.net_amount)).toBe(2000);
      expect(cents(serviceCItem.tax_amount)).toBe(200);
      expect(cents(discountItem.net_amount)).toBe(-3000);
      expect(discountItem.applies_to_item_id).toBeNull();

      expect(invoice.subtotal).toBe(14000);
      expect(invoice.tax).toBe(1700);
      expect(invoice.total_amount).toBe(15700);
    });
  });

  it('applies multiple discounts sequentially to the same service', async () => {
    const serviceId = await createTestService(context, {
      service_name: 'Premium Service',
      default_rate: 10000,
      tax_region: 'US-NY'
    });

    await configureNyTax(10);

    const invoice = await generateManualInvoice({
      clientId: context.clientId,
      items: [
        {
          service_id: serviceId,
          description: 'Premium Service',
          quantity: 1,
          rate: 10000
        },
        {
          description: '20% Loyalty Discount',
          quantity: 1,
          rate: 20,
          is_discount: true,
          discount_type: 'percentage',
          service_id: '',
          applies_to_service_id: serviceId
        },
        {
          description: '$10 Promotional Discount',
          quantity: 1,
          rate: 1000,
          is_discount: true,
          discount_type: 'fixed',
          service_id: '',
          applies_to_service_id: serviceId
        }
      ]
    });

    const invoiceItems = await getInvoiceItems(invoice.invoice_id);
    expect(invoiceItems).toHaveLength(3);

    const serviceItem = invoiceItems.find(item => item.service_id === serviceId)!;
    const loyaltyDiscount = invoiceItems.find(item => item.description.includes('Loyalty'))!;
    const promoDiscount = invoiceItems.find(item => item.description.includes('Promotional'))!;

    expect(cents(serviceItem.net_amount)).toBe(10000);
    expect(cents(serviceItem.tax_amount)).toBe(1000);
    expect(cents(loyaltyDiscount.net_amount)).toBe(-2000);
    expect(cents(promoDiscount.net_amount)).toBe(-1000);
    expect(loyaltyDiscount.applies_to_item_id).toBe(serviceItem.item_id);
    expect(promoDiscount.applies_to_item_id).toBe(serviceItem.item_id);

    expect(invoice.subtotal).toBe(7000);
    expect(invoice.tax).toBe(1000);
    expect(invoice.total_amount).toBe(8000);
  });

  it('handles scenarios where discounts exceed the subtotal', async () => {
    const serviceId = await createTestService(context, {
      service_name: 'Basic Service',
      default_rate: 5000,
      tax_region: 'US-NY'
    });

    await configureNyTax(10);

    const invoice = await generateManualInvoice({
      clientId: context.clientId,
      items: [
        {
          service_id: serviceId,
          description: 'Basic Service',
          quantity: 1,
          rate: 5000
        },
        {
          description: '60% Special Discount',
          quantity: 1,
          rate: 60,
          is_discount: true,
          discount_type: 'percentage',
          service_id: '',
          applies_to_service_id: serviceId
        },
        {
          description: '$30 Additional Discount',
          quantity: 1,
          rate: 3000,
          is_discount: true,
          discount_type: 'fixed',
          service_id: '',
          applies_to_service_id: serviceId
        }
      ]
    });

    const invoiceItems = await getInvoiceItems(invoice.invoice_id);
    expect(invoiceItems).toHaveLength(3);

    const serviceItem = invoiceItems.find(item => item.service_id === serviceId)!;
    const discounts = invoiceItems.filter(item => item.is_discount);
    const percentageDiscount = discounts.find(item => item.description.includes('Special'))!;
    const fixedDiscount = discounts.find(item => item.description.includes('Additional'))!;

    expect(discounts).toHaveLength(2);
    expect(percentageDiscount.applies_to_item_id).toBe(serviceItem.item_id);
    expect(fixedDiscount.applies_to_item_id).toBe(serviceItem.item_id);

    expect(cents(serviceItem.net_amount)).toBe(5000);
    expect(cents(serviceItem.tax_amount)).toBe(500);
    expect(cents(percentageDiscount.net_amount)).toBe(-3000);
    expect(cents(fixedDiscount.net_amount)).toBe(-3000);

    expect(invoice.subtotal).toBe(-1000);
    expect(invoice.tax).toBe(500);
    expect(invoice.total_amount).toBe(-500);
  });
});
