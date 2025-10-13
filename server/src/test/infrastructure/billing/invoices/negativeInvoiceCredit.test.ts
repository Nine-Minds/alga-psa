import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { finalizeInvoice } from 'server/src/lib/actions/invoiceModification';
import { generateInvoice } from 'server/src/lib/actions/invoiceGeneration';
import { v4 as uuidv4 } from 'uuid';
import { TextEncoder as NodeTextEncoder } from 'util';
import { Temporal } from '@js-temporal/polyfill';
import ClientContractLine from 'server/src/lib/models/clientContractLine';
import { createTestDate } from '../../../test-utils/dateUtils';

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

vi.mock('@alga-psa/shared/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/shared/db')>();
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
  }

  beforeAll(async () => {
    context = await setupContext({
      runSeeds: true,
      cleanupTables: [
        'invoice_items',
        'invoices',
        'transactions',
        'client_billing_cycles',
        'client_contract_lines',
        'contract_line_services',
        'service_catalog',
        'contract_lines',
        'bucket_plans',
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
      // 1. Create a test client with zero initial credit balance
      const client_id = await context.createEntity('clients', {
        client_name: 'Basic Negative Invoice Client',
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

      // 2. Set up client tax settings
      await setupClientTaxConfiguration(context, {
        regionCode: 'US-NY',
        clientId: client_id
      });

      // 3. Create two services with negative rates
      const serviceA = await createTestService(context, {
        service_name: 'Credit Service A',
        billing_method: 'fixed',
        default_rate: -5000, // -$50.00
        tax_region: 'US-NY'
      });

      const serviceB = await createTestService(context, {
        service_name: 'Credit Service B',
        billing_method: 'fixed',
        default_rate: -7500, // -$75.00
        tax_region: 'US-NY'
      });

      // 5. Create a contract line
      const planId = await context.createEntity('contract_lines', {
        contract_line_name: 'Credit Plan',
        billing_frequency: 'monthly',
        is_custom: false,
        contract_line_type: 'Fixed'
      }, 'contract_line_id');

      // 6. Assign services to plan
      await context.db('contract_line_services').insert([
        {
          contract_line_id: planId,
          service_id: serviceA,
          quantity: 1,
          tenant: context.tenantId
        },
        {
          contract_line_id: planId,
          service_id: serviceB,
          quantity: 1,
          tenant: context.tenantId
        }
      ]);

      // 7. Create a billing cycle
      const now = createTestDate();
      const startDate = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();
      const endDate = Temporal.PlainDate.from(now).toString();

      const billingCycleId = await context.createEntity('client_billing_cycles', {
        client_id: client_id,
        billing_cycle: 'monthly',
        period_start_date: startDate,
        period_end_date: endDate,
        effective_date: startDate
      }, 'billing_cycle_id');

      // 8. Assign plan to client
      await context.db('client_contract_lines').insert({
        client_contract_line_id: uuidv4(),
        client_id: client_id,
        contract_line_id: planId,
        tenant: context.tenantId,
        start_date: startDate,
        is_active: true
      });

      // 9. Check initial credit balance is zero
      const initialCredit = await ClientContractLine.getClientCredit(client_id);
      expect(initialCredit).toBe(0);

      // 10. Generate invoice
      const invoice = await generateInvoice(billingCycleId);

      if (!invoice) {
        throw new Error('Failed to generate invoice');
      }

      // 11. Verify the invoice has a negative total
      expect(invoice.total_amount).toBeLessThan(0);
      expect(invoice.subtotal).toBe(-12500); // -$125.00
      expect(invoice.tax).toBe(0);           // $0.00 (no tax on negative amounts)
      expect(invoice.total_amount).toBe(-12500); // -$125.00

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
      // 1. Create a test client with zero initial credit balance
      const client_id = await context.createEntity('clients', {
        client_name: 'Mixed Invoice Client',
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

      // 2. Set up client tax settings
      await setupClientTaxConfiguration(context, {
        regionCode: 'US-NY',
        clientId: client_id
      });

      // 3. Create three services with both positive and negative rates
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

      // 5. Create a contract line
      const planId = await context.createEntity('contract_lines', {
        contract_line_name: 'Mixed Credit Plan',
        billing_frequency: 'monthly',
        is_custom: false,
        contract_line_type: 'Fixed'
      }, 'contract_line_id');

      // 6. Assign services to plan
      await context.db('contract_line_services').insert([
        {
          contract_line_id: planId,
          service_id: serviceA,
          configuration_type: 'Fixed',
          tenant: context.tenantId
        },
        {
          contract_line_id: planId,
          service_id: serviceB,
          configuration_type: 'Fixed',
          tenant: context.tenantId
        },
        {
          contract_line_id: planId,
          service_id: serviceC,
          configuration_type: 'Fixed',
          tenant: context.tenantId
        }
      ]);

      await context.db('plan_service_fixed_config').insert([
        {
          config_id: configIdA,
          base_rate: 100.00, // $100.00
          tenant: context.tenantId
        },
        {
          config_id: configIdB,
          base_rate: -150.00, // -$150.00
          tenant: context.tenantId
        },
        {
          config_id: configIdC,
          base_rate: -75.00, // -$75.00
          tenant: context.tenantId
        }
      ]);

      // 7. Create a billing cycle
      const now = createTestDate();
      const startDate = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();
      const endDate = Temporal.PlainDate.from(now).toString();

      const billingCycleId = await context.createEntity('client_billing_cycles', {
        client_id: client_id,
        billing_cycle: 'monthly',
        period_start_date: startDate,
        period_end_date: endDate,
        effective_date: startDate
      }, 'billing_cycle_id');

      // 8. Assign plan to client
      await context.db('client_contract_lines').insert({
        client_contract_line_id: uuidv4(),
        client_id: client_id,
        contract_line_id: planId,
        tenant: context.tenantId,
        start_date: startDate,
        is_active: true
      });

      // 9. Check initial credit balance is zero
      const initialCredit = await ClientContractLine.getClientCredit(client_id);
      expect(initialCredit).toBe(0);

      // 10. Generate invoice
      const invoice = await generateInvoice(billingCycleId);

      if (!invoice) {
        throw new Error('Failed to generate invoice');
      }

      // 11. Verify the invoice calculations
      // Expected:
      // - Positive item: $100.00 with $10.00 tax (10%)
      // - Negative items: -$150.00 and -$75.00 with $0 tax
      // - Subtotal: -$125.00
      // - Tax: $10.00 (only on positive amount)
      // - Total: -$115.00 (-$125 + $10)
      expect(invoice.subtotal).toBe(-12500); // -$125.00
      expect(invoice.tax).toBe(1000);        // $10.00 (10% of $100)
      expect(invoice.total_amount).toBe(-11500); // -$115.00 (-$125 + $10)

      // Get invoice items to verify individual calculations
      const invoiceItems = await context.db('invoice_items')
        .where({ invoice_id: invoice.invoice_id })
        .orderBy('net_amount', 'desc');

      expect(invoiceItems.length).toBe(1);
      const [aggregatedItem] = invoiceItems;
      expect(parseInt(aggregatedItem.net_amount)).toBe(-12500); // Combined net amount
      expect(parseInt(aggregatedItem.tax_amount)).toBe(1000); // $10.00 tax from positive portion
      expect(aggregatedItem.description).toContain('Mixed Credit Plan');

      // 12. Finalize the invoice
      await finalizeInvoice(invoice.invoice_id);

      // 13. Verify the client credit balance has increased by the absolute value of the total
      const updatedCredit = await ClientContractLine.getClientCredit(client_id);
      expect(updatedCredit).toBe(11500); // $115.00 credit (absolute value of -$115.00)

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
      expect(parseInt(creditTransaction.amount)).toBe(11500); // $115.00
      expect(creditTransaction.description).toContain('Credit issued from negative invoice');
    });
  });

  describe('Applying Credit from Negative Invoice to Future Invoice', () => {
    it('should automatically apply credit from a negative invoice to a future invoice', async () => {
      // 1. Create a test client with zero initial credit balance
      const client_id = await context.createEntity('clients', {
        client_name: 'Credit Application Client',
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

      // 2. Set up client tax settings
      await setupClientTaxConfiguration(context, {
        regionCode: 'US-NY',
        clientId: client_id
      });

      // 3. Create negative services for first invoice
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

      // 5. Create a contract line for negative services
      const planId1 = await context.createEntity('contract_lines', {
        contract_line_name: 'Credit Plan',
        billing_frequency: 'monthly',
        is_custom: false,
        contract_line_type: 'Fixed'
      }, 'contract_line_id');

      // 6. Assign negative services to plan
      await context.db('contract_line_services').insert([
        {
          contract_line_id: planId1,
          service_id: negativeServiceA,
          configuration_type: 'Fixed',
          tenant: context.tenantId
        },
        {
          contract_line_id: planId1,
          service_id: negativeServiceB,
          configuration_type: 'Fixed',
          tenant: context.tenantId
        }
      ]);

      await context.db('plan_service_fixed_config').insert([
        {
          config_id: configIdNegA,
          base_rate: -50.00, // -$50.00
          tenant: context.tenantId
        },
        {
          config_id: configIdNegB,
          base_rate: -75.00, // -$75.00
          tenant: context.tenantId
        }
      ]);

      // 7. Create first billing cycle
      const now = createTestDate();
      const startDate1 = Temporal.PlainDate.from(now).subtract({ months: 2 }).toString();
      const endDate1 = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();

      const billingCycleId1 = await context.createEntity('client_billing_cycles', {
        client_id: client_id,
        billing_cycle: 'monthly',
        period_start_date: startDate1,
        period_end_date: endDate1,
        effective_date: startDate1
      }, 'billing_cycle_id');

      // 8. Assign first plan to client
      const firstPlanId = uuidv4();
      await context.db('client_contract_lines').insert({
        client_contract_line_id: firstPlanId,
        client_id: client_id,
        contract_line_id: planId1,
        tenant: context.tenantId,
        start_date: startDate1,
        is_active: true
      });

      // 9. Check initial credit balance is zero
      const initialCredit = await ClientContractLine.getClientCredit(client_id);
      expect(initialCredit).toBe(0);

      // 10. Generate negative invoice
      const negativeInvoice = await generateInvoice(billingCycleId1);

      if (!negativeInvoice) {
        throw new Error('Failed to generate negative invoice');
      }

      // 11. Verify the negative invoice calculations
      expect(negativeInvoice.subtotal).toBe(-12500); // -$125.00
      expect(negativeInvoice.tax).toBe(0);           // $0.00 (no tax on negative amounts)
      expect(negativeInvoice.total_amount).toBe(-12500); // -$125.00

      // 12. Finalize the negative invoice
      await finalizeInvoice(negativeInvoice.invoice_id);

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

      // 14. Create positive service for second invoice
      const positiveService = await createTestService(context, {
        service_name: 'Regular Service',
        billing_method: 'fixed',
        default_rate: 10000, // $100.00
        tax_region: 'US-NY'
      });

      // 15. Create a contract line for positive service
      const planId2 = await context.createEntity('contract_lines', {
        contract_line_name: 'Regular Plan',
        billing_frequency: 'monthly',
        is_custom: false,
        contract_line_type: 'Fixed'
      }, 'contract_line_id');

      await context.db('billing_plan_fixed_config').insert({
        plan_id: planId2,
        tenant: context.tenantId
      });

      // 16. Assign positive service to second plan
      await context.db('contract_line_services').insert({
        contract_line_id: planId2,
        service_id: positiveService,
        configuration_type: 'fixed',
        tenant: context.tenantId
      });

      await context.db('plan_service_fixed_config').insert({
        config_id: configIdPos,
        base_rate: 100.00, // $100.00
        tenant: context.tenantId
      });

      // 17. Create second billing cycle
      const startDate2 = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();
      const endDate2 = Temporal.PlainDate.from(now).toString();

      const billingCycleId2 = await context.createEntity('client_billing_cycles', {
        client_id: client_id,
        billing_cycle: 'monthly',
        period_start_date: startDate2,
        period_end_date: endDate2,
        effective_date: startDate2
      }, 'billing_cycle_id');

      // 18. Deactivate first plan and assign second plan to client
      await context.db('client_contract_lines')
        .where({ client_contract_line_id: firstPlanId })
        .update({ is_active: false });
        
      await context.db('client_contract_lines').insert({
        client_contract_line_id: uuidv4(),
        client_id: client_id,
        contract_line_id: planId2,
        tenant: context.tenantId,
        start_date: startDate2,
        is_active: true
      });

      // 19. Generate positive invoice
      const positiveInvoice = await generateInvoice(billingCycleId2);

      if (!positiveInvoice) {
        throw new Error('Failed to generate positive invoice');
      }

      // 20. Verify the positive invoice calculations
      expect(positiveInvoice.subtotal).toBe(10000); // $100.00
      expect(positiveInvoice.tax).toBe(1000);       // $10.00 (10% of $100)
      expect(positiveInvoice.total_amount).toBe(11000); // $110.00 ($100 + $10)

      // 21. Finalize the positive invoice to apply credit
      await finalizeInvoice(positiveInvoice.invoice_id);

      // 22. Verify the final state of the positive invoice
      const finalPositiveInvoice = await context.db('invoices')
        .where({ invoice_id: positiveInvoice.invoice_id })
        .first();

      // Credit should be fully applied
      expect(finalPositiveInvoice.credit_applied).toBe(11000); // $110.00 credit applied
      expect(parseInt(finalPositiveInvoice.total_amount)).toBe(0); // $0.00 remaining total

      // 23. Verify the credit balance is reduced
      const finalCredit = await ClientContractLine.getClientCredit(client_id);
      expect(finalCredit).toBe(1500); // $15.00 = $125.00 - $110.00 

      // 24. Verify credit application transaction
      const creditApplicationTransaction = await context.db('transactions')
        .where({
          client_id: client_id,
          invoice_id: positiveInvoice.invoice_id,
          type: 'credit_application'
        })
        .first();

      expect(creditApplicationTransaction).toBeTruthy();
      expect(parseInt(creditApplicationTransaction.amount)).toBe(-11000); // -$110.00 (negative as credit is used)
    });
  });

  describe('Partial Application of Negative Invoice Credit', () => {
    it('should apply partial credit when the invoice amount exceeds the available credit', async () => {
      // 1. Create a test client with zero initial credit balance
      const client_id = await context.createEntity('clients', {
        client_name: 'Partial Credit Application Client',
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

      // 2. Set up client tax settings
      await setupClientTaxConfiguration(context, {
        regionCode: 'US-NY',
        clientId: client_id
      });

      // 3. Create single negative service for first invoice (small amount)
      const negativeService = await createTestService(context, {
        service_name: 'Small Credit Service',
        billing_method: 'fixed',
        default_rate: -5000, // -$50.00 (small credit)
        tax_region: 'US-NY'
      });

      // 5. Create a contract line for negative services
      const planId1 = await context.createEntity('contract_lines', {
        contract_line_name: 'Small Credit Plan',
        billing_frequency: 'monthly',
        is_custom: false,
        contract_line_type: 'Fixed'
      }, 'contract_line_id');

      // 6. Assign negative service to plan
      await context.db('contract_line_services').insert({
        contract_line_id: planId1,
        service_id: negativeService,
        configuration_type: 'fixed',
        tenant: context.tenantId
      });

      await context.db('plan_service_fixed_config').insert({
        config_id: configIdNeg,
        base_rate: -50.00, // -$50.00
        tenant: context.tenantId
      });

      // 7. Create first billing cycle
      const now = createTestDate();
      const startDate1 = Temporal.PlainDate.from(now).subtract({ months: 2 }).toString();
      const endDate1 = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();

      const billingCycleId1 = await context.createEntity('client_billing_cycles', {
        client_id: client_id,
        billing_cycle: 'monthly',
        period_start_date: startDate1,
        period_end_date: endDate1,
        effective_date: startDate1
      }, 'billing_cycle_id');

      // 8. Assign first plan to client
      await context.db('client_contract_lines').insert({
        client_contract_line_id: uuidv4(),
        client_id: client_id,
        contract_line_id: planId1,
        tenant: context.tenantId,
        start_date: startDate1,
        is_active: true
      });

      // 9. Generate negative invoice (small amount)
      const negativeInvoice = await generateInvoice(billingCycleId1);

      if (!negativeInvoice) {
        throw new Error('Failed to generate negative invoice');
      }

      // 10. Verify the negative invoice calculations
      expect(negativeInvoice.subtotal).toBe(-5000); // -$50.00
      expect(negativeInvoice.tax).toBe(0);          // $0.00 (no tax on negative amounts)
      expect(negativeInvoice.total_amount).toBe(-5000); // -$50.00

      // 11. Finalize the negative invoice
      await finalizeInvoice(negativeInvoice.invoice_id);

      // 12. Verify credit was created
      const creditAfterNegativeInvoice = await ClientContractLine.getClientCredit(client_id);
      expect(creditAfterNegativeInvoice).toBe(5000); // $50.00 credit

      // Now create a positive invoice with a larger amount

      // 13. Create expensive positive service for second invoice
      const expensiveService = await createTestService(context, {
        service_name: 'Expensive Service',
        billing_method: 'fixed',
        default_rate: 17500, // $175.00 (larger than the credit)
        tax_region: 'US-NY'
      });

      // 14. Create a contract line for expensive service
      const planId2 = await context.createEntity('contract_lines', {
        contract_line_name: 'Expensive Plan',
        billing_frequency: 'monthly',
        is_custom: false,
        contract_line_type: 'Fixed'
      }, 'contract_line_id');

      await context.db('billing_plan_fixed_config').insert({
        plan_id: planId2,
        tenant: context.tenantId
      });

      // 15. Assign positive service to second plan
      await context.db('contract_line_services').insert({
        contract_line_id: planId2,
        service_id: expensiveService,
        configuration_type: 'fixed',
        tenant: context.tenantId
      });

      await context.db('plan_service_fixed_config').insert({
        config_id: configIdExp,
        base_rate: 175.00, // $175.00
        tenant: context.tenantId
      });

      // 16. Create second billing cycle
      const startDate2 = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();
      const endDate2 = Temporal.PlainDate.from(now).toString();

      const billingCycleId2 = await context.createEntity('client_billing_cycles', {
        client_id: client_id,
        billing_cycle: 'monthly',
        period_start_date: startDate2,
        period_end_date: endDate2,
        effective_date: startDate2
      }, 'billing_cycle_id');

      // 17. Deactivate the first plan and assign second plan to client
      await context.db('client_contract_lines')
        .where({ 
          client_id: client_id,
          contract_line_id: planId1,
          tenant: context.tenantId
        })
        .update({ is_active: false });
        
      await context.db('client_contract_lines').insert({
        client_contract_line_id: uuidv4(),
        client_id: client_id,
        contract_line_id: planId2,
        tenant: context.tenantId,
        start_date: startDate2,
        is_active: true
      });

      // 18. Generate positive invoice
      const positiveInvoice = await generateInvoice(billingCycleId2);

      if (!positiveInvoice) {
        throw new Error('Failed to generate positive invoice');
      }

      // 19. Verify the positive invoice calculations
      expect(positiveInvoice.subtotal).toBe(17500);  // $175.00
      expect(positiveInvoice.tax).toBe(1750);        // $17.50 (10% of $175)
      expect(positiveInvoice.total_amount).toBe(19250); // $192.50 ($175 + $17.50)

      // 20. Finalize the positive invoice to apply credit
      await finalizeInvoice(positiveInvoice.invoice_id);

      // 21. Verify the final state of the positive invoice
      const finalPositiveInvoice = await context.db('invoices')
        .where({ invoice_id: positiveInvoice.invoice_id })
        .first();

      // Credit should be partially applied
      expect(finalPositiveInvoice.credit_applied).toBe(5000); // $50.00 credit applied (all available)
      expect(parseInt(finalPositiveInvoice.total_amount)).toBe(14250); // $142.50 remaining total ($192.50 - $50.00)

      // 22. Verify the credit balance is now zero
      const finalCredit = await ClientContractLine.getClientCredit(client_id);
      expect(finalCredit).toBe(0); // All credit was used

      // 23. Verify credit application transaction
      const creditApplicationTransaction = await context.db('transactions')
        .where({
          client_id: client_id,
          invoice_id: positiveInvoice.invoice_id,
          type: 'credit_application'
        })
        .first();

      expect(creditApplicationTransaction).toBeTruthy();
      expect(parseInt(creditApplicationTransaction.amount)).toBe(-5000); // -$50.00 (negative as credit is used)
    });
  });

  describe('Full Credit Coverage from Negative Invoice', () => {
    it('should fully cover a smaller invoice with excess credit from a negative invoice', async () => {
      // 1. Create a test client with zero initial credit balance
      const client_id = await context.createEntity('clients', {
        client_name: 'Full Credit Coverage Client',
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

      // 2. Set up client tax settings
      await setupClientTaxConfiguration(context, {
        regionCode: 'US-NY',
        clientId: client_id
      });

      // 3. Create large negative service for first invoice
      const largeNegativeService = await createTestService(context, {
        service_name: 'Large Credit Service',
        billing_method: 'fixed',
        default_rate: -20000, // -$200.00 (large credit)
        tax_region: 'US-NY'
      });

      // 5. Create a contract line for negative service
      const planId1 = await context.createEntity('contract_lines', {
        contract_line_name: 'Large Credit Plan',
        billing_frequency: 'monthly',
        is_custom: false,
        contract_line_type: 'Fixed'
      }, 'contract_line_id');

      // 6. Assign negative service to plan
      await context.db('contract_line_services').insert({
        contract_line_id: planId1,
        service_id: largeNegativeService,
        configuration_type: 'fixed',
        tenant: context.tenantId
      });

      await context.db('plan_service_fixed_config').insert({
        config_id: configIdLarge,
        base_rate: -200.00, // -$200.00
        tenant: context.tenantId
      });

      // 7. Create first billing cycle
      const now = createTestDate();
      const startDate1 = Temporal.PlainDate.from(now).subtract({ months: 2 }).toString();
      const endDate1 = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();

      const billingCycleId1 = await context.createEntity('client_billing_cycles', {
        client_id: client_id,
        billing_cycle: 'monthly',
        period_start_date: startDate1,
        period_end_date: endDate1,
        effective_date: startDate1
      }, 'billing_cycle_id');

      // 8. Assign first plan to client
      await context.db('client_contract_lines').insert({
        client_contract_line_id: uuidv4(),
        client_id: client_id,
        contract_line_id: planId1,
        tenant: context.tenantId,
        start_date: startDate1,
        is_active: true
      });

      // 9. Generate negative invoice (large amount)
      const negativeInvoice = await generateInvoice(billingCycleId1);

      if (!negativeInvoice) {
        throw new Error('Failed to generate negative invoice');
      }

      // 10. Verify the negative invoice calculations
      expect(negativeInvoice.subtotal).toBe(-20000); // -$200.00
      expect(negativeInvoice.tax).toBe(0);           // $0.00 (no tax on negative amounts)
      expect(negativeInvoice.total_amount).toBe(-20000); // -$200.00

      // 11. Finalize the negative invoice
      await finalizeInvoice(negativeInvoice.invoice_id);

      // 12. Verify credit was created
      const creditAfterNegativeInvoice = await ClientContractLine.getClientCredit(client_id);
      expect(creditAfterNegativeInvoice).toBe(20000); // $200.00 credit

      // Now create a positive invoice with a smaller amount

      // 13. Create small positive service for second invoice
      const smallService = await createTestService(context, {
        service_name: 'Small Service',
        billing_method: 'fixed',
        default_rate: 5000, // $50.00 (smaller than the credit)
        tax_region: 'US-NY'
      });

      // 14. Create a contract line for small service
      const planId2 = await context.createEntity('contract_lines', {
        contract_line_name: 'Small Service Plan',
        billing_frequency: 'monthly',
        is_custom: false,
        contract_line_type: 'Fixed'
      }, 'contract_line_id');

      await context.db('billing_plan_fixed_config').insert({
        plan_id: planId2,
        tenant: context.tenantId
      });

      // 15. Assign positive service to second plan
      await context.db('contract_line_services').insert({
        contract_line_id: planId2,
        service_id: smallService,
        configuration_type: 'fixed',
        tenant: context.tenantId
      });

      await context.db('plan_service_fixed_config').insert({
        config_id: configIdSmall,
        base_rate: 50.00, // $50.00
        tenant: context.tenantId
      });

      // 16. Create second billing cycle
      const startDate2 = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();
      const endDate2 = Temporal.PlainDate.from(now).toString();

      const billingCycleId2 = await context.createEntity('client_billing_cycles', {
        client_id: client_id,
        billing_cycle: 'monthly',
        period_start_date: startDate2,
        period_end_date: endDate2,
        effective_date: startDate2
      }, 'billing_cycle_id');

      // 17. Deactivate the first plan and assign second plan to client
      await context.db('client_contract_lines')
        .where({ 
          client_id: client_id,
          contract_line_id: planId1,
          tenant: context.tenantId
        })
        .update({ is_active: false });
        
      await context.db('client_contract_lines').insert({
        client_contract_line_id: uuidv4(),
        client_id: client_id,
        contract_line_id: planId2,
        tenant: context.tenantId,
        start_date: startDate2,
        is_active: true
      });

      // 18. Generate positive invoice
      const positiveInvoice = await generateInvoice(billingCycleId2);

      if (!positiveInvoice) {
        throw new Error('Failed to generate positive invoice');
      }

      // 19. Verify the positive invoice calculations
      expect(positiveInvoice.subtotal).toBe(5000);  // $50.00
      expect(positiveInvoice.tax).toBe(500);        // $5.00 (10% of $50)
      expect(positiveInvoice.total_amount).toBe(5500); // $55.00 ($50 + $5)

      // 20. Finalize the positive invoice to apply credit
      await finalizeInvoice(positiveInvoice.invoice_id);

      // 21. Verify the final state of the positive invoice
      const finalPositiveInvoice = await context.db('invoices')
        .where({ invoice_id: positiveInvoice.invoice_id })
        .first();

      // Credit should fully cover the invoice
      expect(finalPositiveInvoice.credit_applied).toBe(5500); // $55.00 credit applied
      expect(parseInt(finalPositiveInvoice.total_amount)).toBe(0); // $0.00 remaining total

      // 22. Verify the credit balance is reduced but still has remaining credit
      const finalCredit = await ClientContractLine.getClientCredit(client_id);
      expect(finalCredit).toBe(14500); // $145.00 remaining credit ($200.00 - $55.00)

      // 23. Verify credit application transaction
      const creditApplicationTransaction = await context.db('transactions')
        .where({
          client_id: client_id,
          invoice_id: positiveInvoice.invoice_id,
          type: 'credit_application'
        })
        .first();

      expect(creditApplicationTransaction).toBeTruthy();
      expect(parseInt(creditApplicationTransaction.amount)).toBe(-5500); // -$55.00 (negative as credit is used)
    });
  });
});
