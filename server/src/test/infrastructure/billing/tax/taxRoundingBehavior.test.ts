import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { TestContext } from '../../../../../test-utils/testContext';
import { generateManualInvoice } from 'server/src/lib/actions/manualInvoiceActions';
import { v4 as uuidv4 } from 'uuid';
import { TextEncoder as NodeTextEncoder } from 'util';
import {
  createTestService,
  setupClientTaxConfiguration,
  assignServiceTaxRate
} from '../../../../../test-utils/billingTestHelpers';
import { setupCommonMocks } from '../../../../../test-utils/testMocks';

// Override DB_PORT to connect directly to PostgreSQL instead of pgbouncer
// This is critical for tests that use advisory locks or other features not supported by pgbouncer
process.env.DB_PORT = '5432';
process.env.DB_HOST = process.env.DB_HOST === 'pgbouncer' ? 'localhost' : process.env.DB_HOST;

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

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    withTransaction: vi.fn(async (knex, callback) => callback(knex)),
    withAdminTransaction: vi.fn(async (callback, existingConnection) => callback(existingConnection as any))
  };
});

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

describe('Tax Allocation Strategy', () => {
  let context: TestContext;
  let default_service_id: string;

  beforeAll(async () => {
    context = await setupContext({
      runSeeds: true,
      cleanupTables: [
        'invoice_charges',
        'invoices',
        'service_catalog',
        'tax_rates',
        'tax_regions',
        'client_tax_settings',
        'client_tax_rates',
        'clients'
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
  }, 120000);

  beforeEach(async () => {
    context = await resetContext();

    const mockContext = setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      permissionCheck: () => true
    });
    mockedTenantId = mockContext.tenantId;
    mockedUserId = mockContext.userId;

    // Create a default service for testing
    // NOTE: Do NOT set tax_region here - each test configures its own tax
    default_service_id = await createTestService(context, {
      service_name: 'Test Service',
      billing_method: 'fixed',
      default_rate: 1000,
      unit_of_measure: 'unit'
    });

    // NOTE: Do NOT configure default tax here - each test sets its own tax rate
  }, 30000);

  afterEach(async () => {
    await rollbackContext();
  }, 30000);

  afterAll(async () => {
    await cleanupContext();
  }, 30000);

  describe('Tax Distribution Rules', () => {
    it('should distribute tax proportionally among positive line items only', async () => {
      // Set up tax rate of 10% for simple calculation
      await setupClientTaxConfiguration(context, {
        regionCode: 'US-NY',
        regionName: 'New York',
        description: 'Test Tax Rate',
        startDate: '2025-01-01T00:00:00.000Z',
        taxPercentage: 10
      });
      await assignServiceTaxRate(context, '*', 'US-NY', { onlyUnset: true });

      // Create invoice with mixed positive and negative amounts
      const invoice = await generateManualInvoice({
        clientId: context.clientId,
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
      // Tax calculated on positive items only: $50.00 * 10% = $5.00
      // Distribution:
      // - $30.00 item (60% of positive $50) gets $3.00 tax
      // - $20.00 item (40% of positive $50) gets $2.00 tax
      // - Negative item gets no tax
      const invoiceItems = await context.db('invoice_charges')
        .where({ invoice_id: invoice.invoice_id })
        .orderBy('net_amount', 'desc');

      expect(invoice.subtotal).toBe(4000); // $40.00
      expect(invoice.tax).toBe(500); // $5.00 (10% of $50 positive items)
      expect(invoice.total_amount).toBe(4500); // $45.00

      // Verify tax distribution
      expect(invoiceItems[0].tax_amount).toBe('300'); // $3.00 on $30.00 item (60% of $5 tax)
      expect(invoiceItems[1].tax_amount).toBe('200'); // $2.00 on $20.00 item (40% of $5 tax)
      expect(invoiceItems[2].tax_amount).toBe('0'); // $0.00 on negative item
    });

    it('should handle rounding by using Math.floor for all but last item', async () => {
      // Set up tax rate of 8.875% (NY rate)
      await setupClientTaxConfiguration(context, {
        regionCode: 'US-NY',
        regionName: 'New York',
        description: 'NY State + City Tax',
        startDate: '2025-01-01T00:00:00.000Z',
        taxPercentage: 8.875
      });
      await assignServiceTaxRate(context, '*', 'US-NY', { onlyUnset: true });

      // Create invoice with amounts that will produce fractional tax cents
      const invoice = await generateManualInvoice({
        clientId: context.clientId,
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
      const invoiceItems = await context.db('invoice_charges')
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
      // Set up tax rate of 1% for testing small amounts
      await setupClientTaxConfiguration(context, {
        regionCode: 'US-NY',
        regionName: 'New York',
        description: 'Test Tax Rate',
        startDate: '2025-01-01T00:00:00.000Z',
        taxPercentage: 1
      });
      await assignServiceTaxRate(context, '*', 'US-NY', { onlyUnset: true });

      // Create invoice with small amounts
      const invoice = await generateManualInvoice({
        clientId: context.clientId,
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
      const invoiceItems = await context.db('invoice_charges')
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