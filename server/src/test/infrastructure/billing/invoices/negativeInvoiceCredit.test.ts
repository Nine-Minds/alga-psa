import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { finalizeInvoice } from 'server/src/lib/actions/invoiceModification';
import { createInvoiceFromBillingResult } from 'server/src/lib/actions/invoiceGeneration';
import { v4 as uuidv4 } from 'uuid';
import { TextEncoder as NodeTextEncoder } from 'util';
import { Temporal } from '@js-temporal/polyfill';
import ClientContractLine from 'server/src/lib/models/clientContractLine';
import { TestContext } from '../../../../../test-utils/testContext';
import { createTestDate, dateHelpers } from '../../../../../test-utils/dateUtils';
import { setupCommonMocks } from '../../../../../test-utils/testMocks';
import {
  createTestService,
  setupClientTaxConfiguration,
  assignServiceTaxRate,
  ensureClientPlanBundlesTable
} from '../../../../../test-utils/billingTestHelpers';
import type { IBillingCharge, IBillingResult } from 'server/src/interfaces/billing.interfaces';

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

async function generateInvoiceFromCharges(
  context: TestContext,
  billingCycleId: string,
  charges: IBillingCharge[]
): Promise<{ invoiceId: string; invoice: Record<string, unknown> }> {
  const cycleRecord = await context.db('client_billing_cycles')
    .where({ billing_cycle_id: billingCycleId, tenant: context.tenantId })
    .first();

  if (!cycleRecord) {
    throw new Error(`Billing cycle ${billingCycleId} not found`);
  }

  const clientId = cycleRecord.client_id as string;
  const cycleStart = cycleRecord.period_start_date ?? cycleRecord.effective_date;
  const cycleEnd = cycleRecord.period_end_date ?? cycleRecord.effective_date;

  const totalAmount = charges.reduce((sum, charge) => sum + Number(charge.total || 0), 0);

  const billingResult: IBillingResult = {
    tenant: context.tenantId,
    charges,
    discounts: [],
    adjustments: [],
    totalAmount,
    finalAmount: totalAmount
  };

  const createdInvoice = await createInvoiceFromBillingResult(
    billingResult,
    clientId,
    cycleStart,
    cycleEnd,
    billingCycleId,
    context.userId
  );

  const invoiceRow = await context.db('invoices')
    .where({ invoice_id: createdInvoice.invoice_id, tenant: context.tenantId })
    .first();

  if (!invoiceRow) {
    throw new Error(`Invoice ${createdInvoice.invoice_id} not found`);
  }

  return {
    invoiceId: createdInvoice.invoice_id,
    invoice: invoiceRow
  };
}

async function ensureClientContractLine(context: TestContext, startDate: string): Promise<void> {
  const existingLine = await context.db('client_contract_lines')
    .where({ client_id: context.clientId, tenant: context.tenantId })
    .first();

  if (existingLine) {
    return;
  }

  const contractLineId = uuidv4();

  await context.db('contract_lines')
    .insert({
      contract_line_id: contractLineId,
      tenant: context.tenantId,
      contract_line_name: 'Test Contract Line',
      billing_frequency: 'monthly',
      is_custom: false,
      contract_line_type: 'Fixed',
      custom_rate: 0,
      enable_proration: false,
      billing_cycle_alignment: 'start',
      billing_timing: 'arrears'
    });

  await context.db('client_contract_lines')
    .insert({
      client_contract_line_id: uuidv4(),
      client_id: context.clientId,
      contract_line_id: contractLineId,
      tenant: context.tenantId,
      start_date: startDate,
      is_active: true
    });
}

describe('Negative Invoice Credit Tests', () => {
  let context: TestContext;

  async function configureDefaultTax() {
    await setupClientTaxConfiguration(context, {
      regionCode: 'US-NY',
      regionName: 'New York',
      description: 'NY State Tax',
      startDate: '2020-01-01T00:00:00.000Z',
      taxPercentage: 10.0
    });
    await assignServiceTaxRate(context, '*', 'US-NY', { onlyUnset: true });
    await ensureClientPlanBundlesTable(context);
  }

  beforeAll(async () => {
    context = await setupContext({
      runSeeds: true,
      cleanupTables: [
        'invoice_charges',
        'invoices',
        'transactions',
        'client_billing_cycles',
        'client_contract_lines',
        'contract_line_services',
        'service_catalog',
        'contract_lines',
        'bucket_usage',
        'tax_rates',
        'tax_regions',
        'client_tax_settings',
        'client_tax_rates'
      ],
      clientName: 'Negative Credit Test Client',
      userType: 'internal'
    });

    const mockContext = setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      permissionCheck: () => true
    });

    mockedTenantId = mockContext.tenantId;
    mockedUserId = mockContext.userId;

    await configureDefaultTax();
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

    // Configure default tax for the test client
    await configureDefaultTax();
  }, 30000);

  afterEach(async () => {
    await rollbackContext();
  }, 30000);

  afterAll(async () => {
    await cleanupContext();
  }, 30000);

  describe('Basic Negative Invoice Credit Creation', () => {
    it('should create a credit when finalizing an invoice with negative total', async () => {
      // Use the default test client
      const client_id = context.clientId;

      // Calculate dates first
      const now = createTestDate();
      const startDate = dateHelpers.startOf(dateHelpers.subtractDuration(now, { months: 1 }), 'month').toInstant().toString();
      const endDate = dateHelpers.startOf(now, 'month').toInstant().toString();

      const serviceA = await createTestService(context, {
        service_name: 'Credit Service A',
        billing_method: 'fixed',
        default_rate: -5000,
        tax_region: 'US-NY'
      });

      const serviceB = await createTestService(context, {
        service_name: 'Credit Service B',
        billing_method: 'fixed',
        default_rate: -7500,
        tax_region: 'US-NY'
      });

      // 7. Create a billing cycle
      const billingCycleId = await context.createEntity('client_billing_cycles', {
        client_id: client_id,
        billing_cycle: 'monthly',
        period_start_date: startDate,
        period_end_date: endDate,
        effective_date: startDate
      }, 'billing_cycle_id');

      const charges: IBillingCharge[] = [
        {
          tenant: context.tenantId,
          type: 'usage',
          serviceId: serviceA,
          serviceName: 'Credit Service A',
          quantity: 1,
          rate: -5000,
          total: -5000,
          tax_amount: 0,
          tax_rate: 0,
          tax_region: 'US-NY',
          is_taxable: false,
          usageId: uuidv4(),
          servicePeriodStart: startDate,
          servicePeriodEnd: endDate,
          billingTiming: 'arrears'
        },
        {
          tenant: context.tenantId,
          type: 'usage',
          serviceId: serviceB,
          serviceName: 'Credit Service B',
          quantity: 1,
          rate: -7500,
          total: -7500,
          tax_amount: 0,
          tax_rate: 0,
          tax_region: 'US-NY',
          is_taxable: false,
          usageId: uuidv4(),
          servicePeriodStart: startDate,
          servicePeriodEnd: endDate,
          billingTiming: 'arrears'
        }
      ];

      const billingResult: IBillingResult = {
        tenant: context.tenantId,
        charges,
        discounts: [],
        adjustments: [],
        totalAmount: -12500,
        finalAmount: -12500
      };

      const createdInvoice = await createInvoiceFromBillingResult(
        billingResult,
        client_id,
        startDate,
        endDate,
        billingCycleId,
        context.userId
      );

      const invoice = await context.db('invoices')
        .where({ invoice_id: createdInvoice.invoice_id, tenant: context.tenantId })
        .first();

      // 8. Check initial credit balance is zero
      const initialCredit = await ClientContractLine.getClientCredit(client_id);
      expect(initialCredit).toBe(0);

      // 11. Verify the invoice has a negative total
      expect(Number(invoice.total_amount)).toBeLessThan(0);
      expect(Number(invoice.subtotal)).toBe(-12500); // -$125.00
      expect(Number(invoice.tax)).toBe(0);           // $0.00 (no tax on negative amounts)
      expect(Number(invoice.total_amount)).toBe(-12500); // -$125.00

      // 12. Finalize the invoice
      await finalizeInvoice(invoice.invoice_id);

      // 13. Verify the client credit balance has increased
      const updatedCredit = await ClientContractLine.getClientCredit(client_id);
      expect(updatedCredit).toBe(12500); // $125.00 credit

      // 14. Verify credit issuance transaction
      const creditTransaction = await context.db('transactions')
        .where({
          client_id: client_id,
          invoice_id: invoice.invoice_id,
          type: 'credit_issuance_from_negative_invoice'
        })
        .first();

      // 15. Verify transaction details
      expect(creditTransaction).toBeTruthy();
      expect(parseInt(creditTransaction.amount)).toBe(12500); // $125.00
      expect(creditTransaction.description).toContain('Credit issued from negative invoice');

      // 16. Verify invoice status
      const finalizedInvoice = await context.db('invoices')
        .where({ invoice_id: invoice.invoice_id })
        .first();

      expect(finalizedInvoice.status).toBe('sent');
      expect(finalizedInvoice.finalized_at).toBeTruthy();
    });
  });

  describe('Mixed Invoice with Net Negative Amount', () => {
    it('should create a credit when finalizing a mixed invoice with negative total', async () => {
      // Use the default test client
      const client_id = context.clientId;

      // Calculate dates first
      const now = createTestDate();
      const startDate = dateHelpers.startOf(dateHelpers.subtractDuration(now, { months: 1 }), 'month').toInstant().toString();
      const endDate = dateHelpers.startOf(now, 'month').toInstant().toString();

      // 4. Create three services with both positive and negative rates
      const serviceA = await createTestService(context, {
        service_name: 'Regular Service A',
        billing_method: 'fixed',
        default_rate: 10000, // $100.00 (positive)
        tax_region: 'US-NY'
      });

      const serviceB = await createTestService(context, {
        service_name: 'Credit Service B',
        billing_method: 'fixed',
        default_rate: -15000, // -$150.00 (negative)
        tax_region: 'US-NY'
      });

      const serviceC = await createTestService(context, {
        service_name: 'Credit Service C',
        billing_method: 'fixed',
        default_rate: -7500, // -$75.00 (negative)
        tax_region: 'US-NY'
      });

      // 7. Create a billing cycle
      const billingCycleId = await context.createEntity('client_billing_cycles', {
        client_id: client_id,
        billing_cycle: 'monthly',
        period_start_date: startDate,
        period_end_date: endDate,
        effective_date: startDate
      }, 'billing_cycle_id');

      const charges: IBillingCharge[] = [
        {
          tenant: context.tenantId,
          type: 'usage',
          serviceId: serviceA,
          serviceName: 'Regular Service A',
          quantity: 1,
          rate: 10000,
          total: 10000,
          tax_amount: 0,
          tax_rate: 0,
          tax_region: 'US-NY',
          is_taxable: true,
          usageId: uuidv4(),
          servicePeriodStart: startDate,
          servicePeriodEnd: endDate,
          billingTiming: 'arrears'
        },
        {
          tenant: context.tenantId,
          type: 'usage',
          serviceId: serviceB,
          serviceName: 'Credit Service B',
          quantity: 1,
          rate: -15000,
          total: -15000,
          tax_amount: 0,
          tax_rate: 0,
          tax_region: 'US-NY',
          is_taxable: false,
          usageId: uuidv4(),
          servicePeriodStart: startDate,
          servicePeriodEnd: endDate,
          billingTiming: 'arrears'
        },
        {
          tenant: context.tenantId,
          type: 'usage',
          serviceId: serviceC,
          serviceName: 'Credit Service C',
          quantity: 1,
          rate: -7500,
          total: -7500,
          tax_amount: 0,
          tax_rate: 0,
          tax_region: 'US-NY',
          is_taxable: false,
          usageId: uuidv4(),
          servicePeriodStart: startDate,
          servicePeriodEnd: endDate,
          billingTiming: 'arrears'
        }
      ];

      const { invoiceId, invoice } = await generateInvoiceFromCharges(context, billingCycleId, charges);

      // 8. Check initial credit balance is zero
      const initialCredit = await ClientContractLine.getClientCredit(client_id);
      expect(initialCredit).toBe(0);

      // 11. Verify the invoice calculations
      // Expected:
      // - Positive item: $100.00 with $10.00 tax (10%)
      // - Negative items: -$150.00 and -$75.00 with $0 tax
      // - Subtotal: -$125.00
      // - Tax: $10.00 (only on positive amount)
      // - Total: -$115.00 (-$125 + $10)
      expect(Number(invoice.subtotal)).toBe(-12500); // -$125.00
      expect(Number(invoice.tax)).toBe(1000);        // $10.00 (10% of $100)
      expect(Number(invoice.total_amount)).toBe(-11500); // -$115.00 (-$125 + $10)

      // Get invoice items to verify individual calculations
      const invoiceItems = await context.db('invoice_charges')
        .where({ invoice_id: invoiceId })
        .orderBy('net_amount', 'desc');

      expect(invoiceItems.length).toBe(3);
      const positiveItem = invoiceItems.find(item => Number(item.net_amount) === 10000);
      const negativeTotals = invoiceItems
        .filter(item => Number(item.net_amount) < 0)
        .map(item => Number(item.net_amount))
        .reduce((sum, value) => sum + value, 0);

      expect(positiveItem).toBeTruthy();
      expect(Number(positiveItem!.tax_amount)).toBe(1000); // $10.00 tax from positive portion
      expect(negativeTotals).toBe(-22500); // Combined negative net amount

      // 12. Finalize the invoice
      await finalizeInvoice(invoiceId);

      // 13. Verify the client credit balance has increased by the absolute value of the total
      const updatedCredit = await ClientContractLine.getClientCredit(client_id);
      expect(updatedCredit).toBe(11500); // $115.00 credit (absolute value of -$115.00)

      // 14. Verify credit issuance transaction
      const creditTransaction = await context.db('transactions')
        .where({
          client_id: client_id,
          invoice_id: invoiceId,
          type: 'credit_issuance_from_negative_invoice'
        })
        .first();

      // 15. Verify transaction details
      expect(creditTransaction).toBeTruthy();
      expect(parseInt(creditTransaction.amount)).toBe(11500); // $115.00
      expect(creditTransaction.description).toContain('Credit issued from negative invoice');
    });
  });

  describe('Applying Credit from Negative Invoice to Future Invoice', () => {
    it('should automatically apply credit from a negative invoice to a future invoice', async () => {
      // Use the default test client
      const client_id = context.clientId;

      // Calculate dates first
      const now = createTestDate();
      const startDate1 = dateHelpers.startOf(dateHelpers.subtractDuration(now, { months: 2 }), 'month').toInstant().toString();
      const endDate1 = dateHelpers.startOf(dateHelpers.subtractDuration(now, { months: 1 }), 'month').toInstant().toString();

      // 4. Create negative services for first invoice
      const negativeServiceA = await createTestService(context, {
        service_name: 'Credit Service A',
        billing_method: 'fixed',
        default_rate: -5000, // -$50.00
        tax_region: 'US-NY'
      });

      const negativeServiceB = await createTestService(context, {
        service_name: 'Credit Service B',
        billing_method: 'fixed',
        default_rate: -7500, // -$75.00
        tax_region: 'US-NY'
      });

      // 7. Create first billing cycle
      const billingCycleId1 = await context.createEntity('client_billing_cycles', {
        client_id: client_id,
        billing_cycle: 'monthly',
        period_start_date: startDate1,
        period_end_date: endDate1,
        effective_date: startDate1
      }, 'billing_cycle_id');

      await ensureClientContractLine(context, startDate1);

      const existingContractLine = await context.db('client_contract_lines')
        .where({ client_id: client_id, tenant: context.tenantId })
        .first();
      expect(existingContractLine).toBeTruthy();
      expect(existingContractLine?.tenant).toBe(context.tenantId);

      const negativeCharges: IBillingCharge[] = [
        {
          tenant: context.tenantId,
          type: 'usage',
          serviceId: negativeServiceA,
          serviceName: 'Credit Service A',
          quantity: 1,
          rate: -5000,
          total: -5000,
          tax_amount: 0,
          tax_rate: 0,
          tax_region: 'US-NY',
          is_taxable: false,
          usageId: uuidv4(),
          servicePeriodStart: startDate1,
          servicePeriodEnd: endDate1,
          billingTiming: 'arrears'
        },
        {
          tenant: context.tenantId,
          type: 'usage',
          serviceId: negativeServiceB,
          serviceName: 'Credit Service B',
          quantity: 1,
          rate: -7500,
          total: -7500,
          tax_amount: 0,
          tax_rate: 0,
          tax_region: 'US-NY',
          is_taxable: false,
          usageId: uuidv4(),
          servicePeriodStart: startDate1,
          servicePeriodEnd: endDate1,
          billingTiming: 'arrears'
        }
      ];

      const { invoiceId: negativeInvoiceId, invoice: negativeInvoice } =
        await generateInvoiceFromCharges(context, billingCycleId1, negativeCharges);

      // 9. Check initial credit balance is zero
      const initialCredit = await ClientContractLine.getClientCredit(client_id);
      expect(initialCredit).toBe(0);

      // 11. Verify the negative invoice calculations
      expect(Number(negativeInvoice.subtotal)).toBe(-12500); // -$125.00
      expect(Number(negativeInvoice.tax)).toBe(0);           // $0.00 (no tax on negative amounts)
      expect(Number(negativeInvoice.total_amount)).toBe(-12500); // -$125.00

      // 12. Finalize the negative invoice
      await finalizeInvoice(negativeInvoiceId);

      // Add a small delay to ensure all operations complete
      // await new Promise(resolve => setTimeout(resolve, 100));

      // 13. Verify credit was created
      const creditAfterNegativeInvoice = await ClientContractLine.getClientCredit(client_id);
      expect(creditAfterNegativeInvoice).toBe(12500); // $125.00 credit

      // Verify transaction record for the negative invoice credit
      const creditTransaction = await context.db('transactions')
        .where({ 
          client_id: client_id,
          type: 'credit_issuance_from_negative_invoice'
        })
        .orderBy('created_at', 'desc')
        .first();
      
      expect(creditTransaction).toBeTruthy();
      expect(parseInt(creditTransaction.amount)).toBe(12500);
      expect(parseInt(creditTransaction.balance_after)).toBe(12500);

      // Now create a positive invoice that will use the credit

      // 14. Calculate dates for second billing cycle
      const startDate2 = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();
      const endDate2 = Temporal.PlainDate.from(now).toString();

      await ensureClientContractLine(context, startDate2);

      // 15. Create positive service for second invoice
      const positiveService = await createTestService(context, {
        service_name: 'Regular Service',
        billing_method: 'fixed',
        default_rate: 10000, // $100.00
        tax_region: 'US-NY'
      });

      // 17. Create second billing cycle
      const billingCycleId2 = await context.createEntity('client_billing_cycles', {
        client_id: client_id,
        billing_cycle: 'monthly',
        period_start_date: startDate2,
        period_end_date: endDate2,
        effective_date: startDate2
      }, 'billing_cycle_id');

      const positiveCharges: IBillingCharge[] = [
        {
          tenant: context.tenantId,
          type: 'usage',
          serviceId: positiveService,
          serviceName: 'Regular Service',
          quantity: 1,
          rate: 10000,
          total: 10000,
          tax_amount: 0,
          tax_rate: 0,
          tax_region: 'US-NY',
          is_taxable: true,
          usageId: uuidv4(),
          servicePeriodStart: startDate2,
          servicePeriodEnd: endDate2,
          billingTiming: 'arrears'
        }
      ];

      const { invoiceId: positiveInvoiceId, invoice: positiveInvoice } =
        await generateInvoiceFromCharges(context, billingCycleId2, positiveCharges);

      // 20. Verify the positive invoice calculations
      expect(Number(positiveInvoice.subtotal)).toBe(10000); // $100.00
      expect(Number(positiveInvoice.tax)).toBe(1000);       // $10.00 (10% of $100)
      expect(Number(positiveInvoice.total_amount)).toBe(11000); // $110.00 ($100 + $10)

      // 21. Finalize the positive invoice to apply credit
      await finalizeInvoice(positiveInvoiceId);

      // 22. Verify the final state of the positive invoice
      const finalPositiveInvoice = await context.db('invoices')
        .where({ invoice_id: positiveInvoiceId })
        .first();

      // Credit should be fully applied
      expect(Number(finalPositiveInvoice.credit_applied)).toBe(11000); // $110.00 credit applied
      expect(parseInt(finalPositiveInvoice.total_amount)).toBe(0); // $0.00 remaining total

      // 23. Verify the credit balance is reduced
      const finalCredit = await ClientContractLine.getClientCredit(client_id);
      expect(finalCredit).toBe(1500); // $15.00 = $125.00 - $110.00 

      // 24. Verify credit application transaction
      const creditApplicationTransaction = await context.db('transactions')
        .where({
          client_id: client_id,
          invoice_id: positiveInvoiceId,
          type: 'credit_application'
        })
        .first();

      expect(creditApplicationTransaction).toBeTruthy();
      expect(parseInt(creditApplicationTransaction.amount)).toBe(-11000); // -$110.00 (negative as credit is used)
    });
  });

  describe('Partial Application of Negative Invoice Credit', () => {
    it('should apply partial credit when the invoice amount exceeds the available credit', async () => {
      // Use the default test client
      const client_id = context.clientId;

      // Calculate dates first
      const now = createTestDate();
      const startDate1 = dateHelpers.startOf(dateHelpers.subtractDuration(now, { months: 2 }), 'month').toInstant().toString();
      const endDate1 = dateHelpers.startOf(dateHelpers.subtractDuration(now, { months: 1 }), 'month').toInstant().toString();

      // 4. Create single negative service for first invoice (small amount)
      const negativeService = await createTestService(context, {
        service_name: 'Small Credit Service',
        billing_method: 'fixed',
        default_rate: -5000, // -$50.00 (small credit)
        tax_region: 'US-NY'
      });

      // 6. Create first billing cycle
      const billingCycleId1 = await context.createEntity('client_billing_cycles', {
        client_id: client_id,
        billing_cycle: 'monthly',
        period_start_date: startDate1,
        period_end_date: endDate1,
        effective_date: startDate1
      }, 'billing_cycle_id');

      await ensureClientContractLine(context, startDate1);

      const negativeCharges: IBillingCharge[] = [
        {
          tenant: context.tenantId,
          type: 'usage',
          serviceId: negativeService,
          serviceName: 'Small Credit Service',
          quantity: 1,
          rate: -5000,
          total: -5000,
          tax_amount: 0,
          tax_rate: 0,
          tax_region: 'US-NY',
          is_taxable: false,
          usageId: uuidv4(),
          servicePeriodStart: startDate1,
          servicePeriodEnd: endDate1,
          billingTiming: 'arrears'
        }
      ];

      const { invoiceId: negativeInvoiceId, invoice: negativeInvoice } =
        await generateInvoiceFromCharges(context, billingCycleId1, negativeCharges);

      // 10. Verify the negative invoice calculations
      expect(Number(negativeInvoice.subtotal)).toBe(-5000); // -$50.00
      expect(Number(negativeInvoice.tax)).toBe(0);          // $0.00 (no tax on negative amounts)
      expect(Number(negativeInvoice.total_amount)).toBe(-5000); // -$50.00

      // 11. Finalize the negative invoice
      await finalizeInvoice(negativeInvoiceId);

      // 12. Verify credit was created
      const creditAfterNegativeInvoice = await ClientContractLine.getClientCredit(client_id);
      expect(creditAfterNegativeInvoice).toBe(5000); // $50.00 credit

      // Now create a positive invoice with a larger amount

      // 13. Calculate dates for second billing cycle
      const startDate2 = dateHelpers.startOf(dateHelpers.subtractDuration(now, { months: 1 }), 'month').toInstant().toString();
      const endDate2 = dateHelpers.startOf(now, 'month').toInstant().toString();

      await ensureClientContractLine(context, startDate2);

      // 14. Create expensive positive service for second invoice
      const expensiveService = await createTestService(context, {
        service_name: 'Expensive Service',
        billing_method: 'fixed',
        default_rate: 17500, // $175.00 (larger than the credit)
        tax_region: 'US-NY'
      });

      // 16. Create second billing cycle
      const billingCycleId2 = await context.createEntity('client_billing_cycles', {
        client_id: client_id,
        billing_cycle: 'monthly',
        period_start_date: startDate2,
        period_end_date: endDate2,
        effective_date: startDate2
      }, 'billing_cycle_id');

      const positiveCharges: IBillingCharge[] = [
        {
          tenant: context.tenantId,
          type: 'usage',
          serviceId: expensiveService,
          serviceName: 'Expensive Service',
          quantity: 1,
          rate: 17500,
          total: 17500,
          tax_amount: 0,
          tax_rate: 0,
          tax_region: 'US-NY',
          is_taxable: true,
          usageId: uuidv4(),
          servicePeriodStart: startDate2,
          servicePeriodEnd: endDate2,
          billingTiming: 'arrears'
        }
      ];

      const { invoiceId: positiveInvoiceId, invoice: positiveInvoice } =
        await generateInvoiceFromCharges(context, billingCycleId2, positiveCharges);

      // 19. Verify the positive invoice calculations
      expect(Number(positiveInvoice.subtotal)).toBe(17500);  // $175.00
      expect(Number(positiveInvoice.tax)).toBe(1750);        // $17.50 (10% of $175)
      expect(Number(positiveInvoice.total_amount)).toBe(19250); // $192.50 ($175 + $17.50)

      // 20. Finalize the positive invoice to apply credit
      await finalizeInvoice(positiveInvoiceId);

      // 21. Verify the final state of the positive invoice
      const finalPositiveInvoice = await context.db('invoices')
        .where({ invoice_id: positiveInvoiceId })
        .first();

      // Credit should be partially applied
      expect(Number(finalPositiveInvoice.credit_applied)).toBe(5000); // $50.00 credit applied (all available)
      expect(parseInt(finalPositiveInvoice.total_amount)).toBe(14250); // $142.50 remaining total ($192.50 - $50.00)

      // 22. Verify the credit balance is now zero
      const finalCredit = await ClientContractLine.getClientCredit(client_id);
      expect(finalCredit).toBe(0); // All credit was used

      // 23. Verify credit application transaction
      const creditApplicationTransaction = await context.db('transactions')
        .where({
          client_id: client_id,
          invoice_id: positiveInvoiceId,
          type: 'credit_application'
        })
        .first();

      expect(creditApplicationTransaction).toBeTruthy();
      expect(parseInt(creditApplicationTransaction.amount)).toBe(-5000); // -$50.00 (negative as credit is used)
    });
  });

  describe('Full Credit Coverage from Negative Invoice', () => {
    it('should fully cover a smaller invoice with excess credit from a negative invoice', async () => {
      // Use the default test client
      const client_id = context.clientId;

      // Calculate dates first
      const now = createTestDate();
      const startDate1 = dateHelpers.startOf(dateHelpers.subtractDuration(now, { months: 2 }), 'month').toInstant().toString();
      const endDate1 = dateHelpers.startOf(dateHelpers.subtractDuration(now, { months: 1 }), 'month').toInstant().toString();

      // 4. Create large negative service for first invoice
      const largeNegativeService = await createTestService(context, {
        service_name: 'Large Credit Service',
        billing_method: 'fixed',
        default_rate: -20000, // -$200.00 (large credit)
        tax_region: 'US-NY'
      });

      // 6. Create first billing cycle
      const billingCycleId1 = await context.createEntity('client_billing_cycles', {
        client_id: client_id,
        billing_cycle: 'monthly',
        period_start_date: startDate1,
        period_end_date: endDate1,
        effective_date: startDate1
      }, 'billing_cycle_id');

      await ensureClientContractLine(context, startDate1);

      const negativeCharges: IBillingCharge[] = [
        {
          tenant: context.tenantId,
          type: 'usage',
          serviceId: largeNegativeService,
          serviceName: 'Large Credit Service',
          quantity: 1,
          rate: -20000,
          total: -20000,
          tax_amount: 0,
          tax_rate: 0,
          tax_region: 'US-NY',
          is_taxable: false,
          usageId: uuidv4(),
          servicePeriodStart: startDate1,
          servicePeriodEnd: endDate1,
          billingTiming: 'arrears'
        }
      ];

      const { invoiceId: negativeInvoiceId, invoice: negativeInvoice } =
        await generateInvoiceFromCharges(context, billingCycleId1, negativeCharges);

      // 10. Verify the negative invoice calculations
      expect(Number(negativeInvoice.subtotal)).toBe(-20000); // -$200.00
      expect(Number(negativeInvoice.tax)).toBe(0);           // $0.00 (no tax on negative amounts)
      expect(Number(negativeInvoice.total_amount)).toBe(-20000); // -$200.00

      // 11. Finalize the negative invoice
      await finalizeInvoice(negativeInvoiceId);

      // 12. Verify credit was created
      const creditAfterNegativeInvoice = await ClientContractLine.getClientCredit(client_id);
      expect(creditAfterNegativeInvoice).toBe(20000); // $200.00 credit

      // Now create a positive invoice with a smaller amount

      // 13. Calculate dates for second billing cycle
      const startDate2 = dateHelpers.startOf(dateHelpers.subtractDuration(now, { months: 1 }), 'month').toInstant().toString();
      const endDate2 = dateHelpers.startOf(now, 'month').toInstant().toString();

      await ensureClientContractLine(context, startDate2);

      // 14. Create small positive service for second invoice
      const smallService = await createTestService(context, {
        service_name: 'Small Service',
        billing_method: 'fixed',
        default_rate: 5000, // $50.00 (smaller than the credit)
        tax_region: 'US-NY'
      });

      // 16. Create second billing cycle
      const billingCycleId2 = await context.createEntity('client_billing_cycles', {
        client_id: client_id,
        billing_cycle: 'monthly',
        period_start_date: startDate2,
        period_end_date: endDate2,
        effective_date: startDate2
      }, 'billing_cycle_id');

      const positiveCharges: IBillingCharge[] = [
        {
          tenant: context.tenantId,
          type: 'usage',
          serviceId: smallService,
          serviceName: 'Small Service',
          quantity: 1,
          rate: 5000,
          total: 5000,
          tax_amount: 0,
          tax_rate: 0,
          tax_region: 'US-NY',
          is_taxable: true,
          usageId: uuidv4(),
          servicePeriodStart: startDate2,
          servicePeriodEnd: endDate2,
          billingTiming: 'arrears'
        }
      ];

      const { invoiceId: positiveInvoiceId, invoice: positiveInvoice } =
        await generateInvoiceFromCharges(context, billingCycleId2, positiveCharges);

      // 19. Verify the positive invoice calculations
      expect(Number(positiveInvoice.subtotal)).toBe(5000);  // $50.00
      expect(Number(positiveInvoice.tax)).toBe(500);        // $5.00 (10% of $50)
      expect(Number(positiveInvoice.total_amount)).toBe(5500); // $55.00 ($50 + $5)

      // 20. Finalize the positive invoice to apply credit
      await finalizeInvoice(positiveInvoiceId);

      // 21. Verify the final state of the positive invoice
      const finalPositiveInvoice = await context.db('invoices')
        .where({ invoice_id: positiveInvoiceId })
        .first();

      // Credit should fully cover the invoice
      expect(Number(finalPositiveInvoice.credit_applied)).toBe(5500); // $55.00 credit applied
      expect(parseInt(finalPositiveInvoice.total_amount)).toBe(0); // $0.00 remaining total

      // 22. Verify the credit balance is reduced but still has remaining credit
      const finalCredit = await ClientContractLine.getClientCredit(client_id);
      expect(finalCredit).toBe(14500); // $145.00 remaining credit ($200.00 - $55.00)

      // 23. Verify credit application transaction
      const creditApplicationTransaction = await context.db('transactions')
        .where({
          client_id: client_id,
          invoice_id: positiveInvoiceId,
          type: 'credit_application'
        })
        .first();

      expect(creditApplicationTransaction).toBeTruthy();
      expect(parseInt(creditApplicationTransaction.amount)).toBe(-5500); // -$55.00 (negative as credit is used)
    });
  });
});
