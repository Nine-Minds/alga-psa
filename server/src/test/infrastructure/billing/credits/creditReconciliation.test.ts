import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { TestContext } from '../../../../../test-utils/testContext';
import { createPrepaymentInvoice, applyCreditToInvoice, validateCreditBalance } from 'server/src/lib/actions/creditActions';
import { finalizeInvoice } from 'server/src/lib/actions/invoiceModification';
import { generateInvoice } from 'server/src/lib/actions/invoiceGeneration';
import {
  createTestService,
  createFixedPlanAssignment,
  setupClientTaxConfiguration,
  assignServiceTaxRate
} from '../../../../../test-utils/billingTestHelpers';
import { setupCommonMocks } from '../../../../../test-utils/testMocks';
import { Temporal } from '@js-temporal/polyfill';
import ClientBillingPlan from 'server/src/lib/models/clientBilling';
import { createTestDate } from '../../../../../test-utils/dateUtils';
import { TextEncoder as NodeTextEncoder } from 'util';

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

/**
 * Credit Reconciliation Tests
 *
 * These tests focus on verifying that the credit tracking table correctly
 * reconciles with the transaction log, ensuring data integrity between
 * the two sources of truth for credit management.
 */
describe('Credit Reconciliation Tests', () => {
  let context: TestContext;

  async function configureDefaultTax() {
    await setupClientTaxConfiguration(context, {
      regionCode: 'US-NY',
      regionName: 'New York',
      description: 'NY State + City Tax',
      startDate: '2025-01-01T00:00:00.000Z',
      taxPercentage: 8.875
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
        'credit_tracking',
        'credit_allocations',
        'client_billing_cycles',
        'client_billing_plans',
        'plan_service_configuration',
        'plan_service_fixed_config',
        'service_catalog',
        'billing_plan_fixed_config',
        'billing_plans',
        'tax_rates',
        'tax_regions',
        'client_tax_settings',
        'client_tax_rates',
        'client_billing_settings',
        'default_billing_settings'
      ],
      clientName: 'Credit Reconciliation Test Client',
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
    await configureDefaultTax();
  }, 30000);

  afterEach(async () => {
    await rollbackContext();
  }, 30000);

  afterAll(async () => {
    await cleanupContext();
  }, 30000);

  it('should verify credit tracking table reconciliation with transaction log', async () => {
    // Use the context's client instead of creating a new one
    const client_id = context.clientId;

    // 1. Set up client billing settings with expiration days
    await context.db('client_billing_settings').insert({
      client_id: client_id,
      tenant: context.tenantId,
      zero_dollar_invoice_handling: 'normal',
      suppress_zero_dollar_invoices: false,
      enable_credit_expiration: true,
      credit_expiration_days: 30,
      credit_expiration_notification_days: [7, 1],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    // 4. Create first prepayment invoice
    const prepaymentAmount1 = 10000; // $100.00 credit
    const prepaymentInvoice1 = await createPrepaymentInvoice(
      client_id,
      prepaymentAmount1
    );

    // 5. Finalize the first prepayment invoice to create the credit
    await finalizeInvoice(prepaymentInvoice1.invoice_id);

    // 6. Create second prepayment invoice
    const prepaymentAmount2 = 5000; // $50.00 credit
    const prepaymentInvoice2 = await createPrepaymentInvoice(
      client_id,
      prepaymentAmount2
    );

    // 7. Finalize the second prepayment invoice to create the credit
    await finalizeInvoice(prepaymentInvoice2.invoice_id);

    // 2. Create a service for a positive invoice using test helper
    const serviceId = await createTestService(context, {
      service_name: 'Regular Service',
      billing_method: 'fixed',
      default_rate: 8000, // $80.00
      unit_of_measure: 'unit',
      tax_region: 'US-NY'
    });

    // 3. Create billing plan and assign service using test helper
    const { planId } = await createFixedPlanAssignment(context, serviceId, {
      planName: 'Regular Plan',
      billingFrequency: 'monthly',
      baseRateCents: 8000, // $80.00
      quantity: 1,
      startDate: '2025-01-01'
    });

    // 4. Create a billing cycle
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

    // 5. Generate positive invoice using transactional connection
    const invoice = await generateInvoice(billingCycleId);

    if (!invoice) {
      throw new Error('Failed to generate invoice');
    }

    // 6. Verify invoice has expected structure
    expect(invoice.invoice_id).toBeDefined();
    expect(invoice.subtotal).toBeGreaterThan(0);

    // 7. Finalize the invoice to apply credit
    await finalizeInvoice(invoice.invoice_id);

    // 8. Verify invoice items were created correctly (invariant check)
    const invoiceItems = await context.db('invoice_items')
      .where({
        invoice_id: invoice.invoice_id,
        tenant: context.tenantId
      });

    expect(invoiceItems.length).toBeGreaterThan(0);

    // 9. Verify tax calculation on invoice items (invariant check)
    const itemsWithTax = invoiceItems.filter(item => Number(item.tax_amount) > 0);
    expect(itemsWithTax.length).toBeGreaterThan(0);

    // Calculate expected tax (8.875% of subtotal)
    const expectedTax = Math.round(invoice.subtotal * 0.08875);
    expect(invoice.tax).toBeCloseTo(expectedTax, -1); // Allow for rounding

    // 10. Verify invoice items sum to subtotal (invariant check)
    const itemsSubtotal = invoiceItems.reduce(
      (sum, item) => sum + Number(item.net_amount),
      0
    );
    expect(itemsSubtotal).toBe(invoice.subtotal);

    // 11. Verify invoice items tax sum matches invoice tax (invariant check)
    const itemsTax = invoiceItems.reduce(
      (sum, item) => sum + Number(item.tax_amount),
      0
    );
    expect(itemsTax).toBe(invoice.tax);

    // 12. Manually apply some credit to create a partial application
    const remainingCredit = await ClientBillingPlan.getClientCredit(client_id);
    const partialCreditAmount = 3000; // $30.00
    await applyCreditToInvoice(client_id, invoice.invoice_id, partialCreditAmount);

    // 13. Get the current credit balance before validation
    const beforeValidationCredit = await ClientBillingPlan.getClientCredit(client_id);

    // 14. Get all credit tracking entries before validation using transactional db
    const preValidationCreditEntries = await context.db('credit_tracking')
      .where({
        client_id: client_id,
        tenant: context.tenantId
      })
      .orderBy('created_at', 'asc');

    // 15. Calculate the expected credit balance based on credit tracking entries
    const expectedCreditBalance = preValidationCreditEntries.reduce(
      (sum, entry) => sum + Number(entry.remaining_amount),
      0
    );

    console.log(`Current credit balance: ${beforeValidationCredit}, Expected from tracking: ${expectedCreditBalance}`);

    // 16. Create an artificial discrepancy by directly modifying the client's credit_balance
    // This simulates a data corruption scenario that would require reconciliation
    const artificialBalance = expectedCreditBalance - 1000; // Reduce by $10.00
    await context.db('clients')
      .where({
        client_id: client_id,
        tenant: context.tenantId
      })
      .update({
        credit_balance: artificialBalance,
        updated_at: new Date().toISOString()
      });

    // 17. Get the modified balance using transactional context
    const modifiedBalance = await ClientBillingPlan.getClientCredit(client_id);
    console.log(`Artificially modified balance: ${modifiedBalance}, Expected from tracking: ${expectedCreditBalance}`);

    // 18. Verify that there's a discrepancy between the actual and expected balance
    expect(modifiedBalance).not.toEqual(expectedCreditBalance);

    // 19. Now run the credit balance validation to check reconciliation
    // This will automatically correct any discrepancies
    const validationResult = await validateCreditBalance(client_id);

    // 20. Verify that the validation detected an issue
    expect(validationResult.isValid).toBe(false);

    // 21. After validation, the balance should be corrected, so run it again to verify
    const secondValidationResult = await validateCreditBalance(client_id);

    // 22. Verify that the second validation shows the balance is now correct
    expect(secondValidationResult.isValid).toBe(true);

    // 23. Get all credit-related transactions using transactional db
    const transactions = await context.db('transactions')
      .where({
        client_id: client_id,
        tenant: context.tenantId
      })
      .whereIn('type', [
        'credit_issuance',
        'credit_application',
        'credit_adjustment',
        'credit_expiration',
        'credit_transfer'
      ])
      .orderBy('created_at', 'asc');

    // 24. Get all credit tracking entries using transactional db
    const creditTrackingEntries = await context.db('credit_tracking')
      .where({
        client_id: client_id,
        tenant: context.tenantId
      })
      .orderBy('created_at', 'asc');

    // 25. Verify that each credit issuance transaction has a corresponding credit tracking entry
    const issuanceTransactions = transactions.filter(tx =>
      tx.type === 'credit_issuance' || tx.type === 'credit_issuance_from_negative_invoice'
    );

    for (const tx of issuanceTransactions) {
      const matchingEntry = creditTrackingEntries.find(entry => entry.transaction_id === tx.transaction_id);
      expect(matchingEntry).toBeTruthy();
      expect(Number(matchingEntry!.amount)).toBe(Number(tx.amount));
    }

    // 26. Verify that credit application transactions have updated the remaining amounts correctly
    const applicationTransactions = transactions.filter(tx => tx.type === 'credit_application');
    
    for (const tx of applicationTransactions) {
      // Find the related credit tracking entries that were affected by this application
      const relatedEntries = creditTrackingEntries.filter(entry => {
        // Check if this entry's transaction_id is referenced in the application's metadata
        if (tx.metadata && typeof tx.metadata === 'string') {
          const metadata = JSON.parse(tx.metadata);
          return metadata.applied_credits && metadata.applied_credits.some(
            (credit: { transactionId: string }) => credit.transactionId === entry.transaction_id
          );
        }
        return false;
      });

      // Verify that the sum of remaining amounts plus applied amounts equals the original amounts
      for (const entry of relatedEntries) {
        const originalAmount = Number(entry.amount);
        const remainingAmount = Number(entry.remaining_amount);

        // The remaining amount should be less than or equal to the original amount
        expect(remainingAmount).toBeLessThanOrEqual(originalAmount);

        // Find all application transactions that reference this credit
        const applicationsForThisCredit = applicationTransactions.filter(appTx => {
          if (appTx.metadata && typeof appTx.metadata === 'string') {
            const metadata = JSON.parse(appTx.metadata);
            return metadata.applied_credits && metadata.applied_credits.some(
              (credit: { transactionId: string }) => credit.transactionId === entry.transaction_id
            );
          }
          return false;
        });

        // Calculate total applied amount for this credit
        let totalApplied = 0;
        for (const appTx of applicationsForThisCredit) {
          if (appTx.metadata && typeof appTx.metadata === 'string') {
            const metadata = JSON.parse(appTx.metadata);
            const creditInfo = metadata.applied_credits.find(
              (credit: { transactionId: string }) => credit.transactionId === entry.transaction_id
            );
            if (creditInfo) {
              totalApplied += Number(creditInfo.amount);
            }
          }
        }

        // Verify that original amount = remaining amount + total applied
        expect(originalAmount).toBeCloseTo(remainingAmount + totalApplied, 2);
      }
    }

    // 27. Verify the client's credit balance matches the sum of remaining amounts in credit tracking
    const clientCredit = await ClientBillingPlan.getClientCredit(client_id);
    const sumOfRemainingAmounts = creditTrackingEntries.reduce(
      (sum, entry) => sum + Number(entry.remaining_amount),
      0
    );

    expect(clientCredit).toBeCloseTo(sumOfRemainingAmounts, 2);

    // 28. Verify that the credit balance in the client record matches the calculated balance from transactions
    const calculatedBalance = transactions.reduce(
      (balance, tx) => balance + Number(tx.amount),
      0
    );

    expect(clientCredit).toBeCloseTo(calculatedBalance, 2);

    // 29. Verify consolidated invoice data integrity (invariant check)
    const consolidatedInvoice = await context.db('invoices')
      .where({
        invoice_id: invoice.invoice_id,
        tenant: context.tenantId
      })
      .first();

    expect(consolidatedInvoice).toBeDefined();
    expect(Number(consolidatedInvoice!.subtotal)).toBe(Number(invoice.subtotal));
    expect(Number(consolidatedInvoice!.tax)).toBe(Number(invoice.tax));
    const expectedRemainingTotal = Number(consolidatedInvoice!.subtotal) + Number(consolidatedInvoice!.tax) - Number(consolidatedInvoice!.credit_applied ?? 0);
    expect(Number(consolidatedInvoice!.total_amount)).toBe(expectedRemainingTotal);
  });
});
