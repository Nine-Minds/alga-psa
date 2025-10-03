import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { TestContext } from '../../../../../test-utils/testContext';
import {
  createTestService,
  createFixedPlanAssignment,
  setupCompanyTaxConfiguration,
  assignServiceTaxRate
} from '../../../../../test-utils/billingTestHelpers';
import { setupCommonMocks } from '../../../../../test-utils/testMocks';
import { createPrepaymentInvoice } from 'server/src/lib/actions/creditActions';
import { finalizeInvoice } from 'server/src/lib/actions/invoiceModification';
import { generateInvoice } from 'server/src/lib/actions/invoiceGeneration';
import { v4 as uuidv4 } from 'uuid';
import { Temporal } from '@js-temporal/polyfill';
import CompanyBillingPlan from 'server/src/lib/models/clientBilling';
import { createTestDate } from '../../../../../test-utils/dateUtils';
import { toPlainDate } from 'server/src/lib/utils/dateTimeUtils';
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
 * Integration tests for credit expiration with other system components.
 *
 * These tests focus on how credit expiration interacts with other parts of the system:
 * - Handling credits generated from negative invoices
 * - Ensuring expired credits are excluded from credit application
 * - Verifying proper integration with the invoicing and billing systems
 */
describe('Credit Expiration Integration Tests', () => {
  let context: TestContext;

  async function ensureDefaultTax() {
    await setupCompanyTaxConfiguration(context, {
      regionCode: 'US-NY',
      regionName: 'New York',
      description: 'NY State Tax',
      startDate: '2025-01-01T00:00:00.000Z',
      taxPercentage: 10
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
        'company_billing_cycles',
        'company_billing_plans',
        'plan_service_configuration',
        'plan_service_fixed_config',
        'service_catalog',
        'billing_plan_fixed_config',
        'billing_plans',
        'tax_rates',
        'tax_regions',
        'company_tax_settings',
        'company_tax_rates',
        'company_billing_settings',
        'default_billing_settings'
      ],
      companyName: 'Credit Expiration Test Company',
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
  }, 30000);

  afterEach(async () => {
    await rollbackContext();
  }, 30000);

  afterAll(async () => {
    await cleanupContext();
  }, 30000);

  it('should validate that credits from negative invoices receive proper expiration dates', async () => {
    // Set up default billing settings with specific expiration days
    const defaultExpirationDays = 90; // 90-day default expiration period

    await context.db('default_billing_settings')
      .insert({
        tenant: context.tenantId,
        zero_dollar_invoice_handling: 'normal',
        suppress_zero_dollar_invoices: false,
        enable_credit_expiration: true,
        credit_expiration_days: defaultExpirationDays,
        credit_expiration_notification_days: [30, 14, 7],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .onConflict(['tenant'])
      .merge({
        enable_credit_expiration: true,
        credit_expiration_days: defaultExpirationDays,
        credit_expiration_notification_days: [30, 14, 7],
        updated_at: new Date().toISOString()
      });

    // Create a service with negative rate to generate a credit
    const negativeService = await createTestService(context, {
      service_name: 'Credit Service',
      default_rate: -5000, // -$50.00
      tax_region: 'US-NY'
    });

    // Create a billing plan with the negative service
    const { planId } = await createFixedPlanAssignment(context, negativeService, {
      planName: 'Credit Plan',
      billingFrequency: 'monthly',
      baseRateCents: 0,
      detailBaseRateCents: -5000,
      quantity: 1,
      startDate: '2025-02-01'
    });

    // Create a billing cycle
    const now = createTestDate();
    const startDate = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();
    const endDate = Temporal.PlainDate.from(now).toString();

    const billingCycleId = await context.createEntity('company_billing_cycles', {
      company_id: context.companyId,
      billing_cycle: 'monthly',
      period_start_date: startDate,
      period_end_date: endDate,
      effective_date: startDate
    }, 'billing_cycle_id');

    // Check initial credit balance is zero
    const initialCredit = await CompanyBillingPlan.getCompanyCredit(context.companyId);
    expect(initialCredit).toBe(0);

    // Generate negative invoice
    const invoice = await generateInvoice(billingCycleId);

    if (!invoice) {
      throw new Error('Failed to generate invoice');
    }

    // Verify the invoice has a negative total
    expect(invoice.total_amount).toBeLessThan(0);
    expect(invoice.subtotal).toBe(-5000); // -$50.00
    expect(invoice.tax).toBe(0);          // $0.00 (no tax on negative amounts)
    expect(invoice.total_amount).toBe(-5000); // -$50.00

    // Finalize the invoice - this should create a credit with expiration date
    await finalizeInvoice(invoice.invoice_id);

    // Verify the company credit balance has increased
    const updatedCredit = await CompanyBillingPlan.getCompanyCredit(context.companyId);
    expect(updatedCredit).toBe(5000); // $50.00 credit

    // Verify credit issuance transaction
    const creditTransaction = await context.db('transactions')
      .where({
        company_id: context.companyId,
        invoice_id: invoice.invoice_id,
        type: 'credit_issuance_from_negative_invoice'
      })
      .first();

    // Verify transaction details
    expect(creditTransaction).toBeTruthy();
    expect(parseInt(creditTransaction.amount.toString())).toBe(5000); // $50.00
    expect(creditTransaction.description).toContain('Credit issued from negative invoice');

    // Verify the transaction has an expiration date
    expect(creditTransaction.expiration_date).toBeTruthy();

    // Calculate expected expiration date (current date + defaultExpirationDays)
    const today = new Date();
    const expectedExpirationDate = new Date(today);
    expectedExpirationDate.setDate(today.getDate() + defaultExpirationDays);

    // Convert both dates to date-only strings for comparison (ignoring time)
    const actualExpirationDate = new Date(creditTransaction.expiration_date);
    const actualDateString = actualExpirationDate.toISOString().split('T')[0];
    const expectedDateString = expectedExpirationDate.toISOString().split('T')[0];

    // Verify the expiration date matches default settings
    expect(actualDateString).toBe(expectedDateString);

    // Get the credit tracking entry
    const creditTracking = await context.db('credit_tracking')
      .where({
        transaction_id: creditTransaction.transaction_id,
        tenant: context.tenantId
      })
      .first();

    // Verify credit tracking entry has the same expiration date
    expect(creditTracking).toBeTruthy();
    expect(toPlainDate(creditTracking.expiration_date)).toEqual(toPlainDate(expectedExpirationDate));
    expect(creditTracking.is_expired).toBe(false);
    expect(Number(creditTracking.remaining_amount)).toBe(5000);
  });

  it('should verify that expired credits are excluded from credit application', async () => {
    // Create a service for regular invoice
    const service = await createTestService(context, {
      service_name: 'Standard Service',
      default_rate: 10000, // $100.00
      tax_region: 'US-NY'
    });

    // Create a billing plan with the service
    const { planId } = await createFixedPlanAssignment(context, service, {
      planName: 'Standard Plan',
      billingFrequency: 'monthly',
      baseRateCents: 0,
      detailBaseRateCents: 10000,
      quantity: 1,
      startDate: '2025-02-01'
    });

    // Create a billing cycle
    const now = createTestDate();
    const startDate = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();
    const endDate = Temporal.PlainDate.from(now).toString();

    const billingCycleId = await context.createEntity('company_billing_cycles', {
      company_id: context.companyId,
      billing_cycle: 'monthly',
      period_start_date: startDate,
      period_end_date: endDate,
      effective_date: startDate
    }, 'billing_cycle_id');

    // Step 1: Create an expired credit
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 10); // 10 days ago
    const expiredDate = pastDate.toISOString();

    const expiredCreditAmount = 5000; // $50.00 credit
    const expiredPrepaymentInvoice = await createPrepaymentInvoice(
      context.companyId,
      expiredCreditAmount,
      expiredDate
    );

    // Step 2: Create an active credit
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 30); // 30 days in the future
    const activeDate = futureDate.toISOString();

    const activeCreditAmount = 7000; // $70.00 credit
    const activePrepaymentInvoice = await createPrepaymentInvoice(
      context.companyId,
      activeCreditAmount,
      activeDate
    );

    // Step 3: Finalize both prepayment invoices to create the credits
    await finalizeInvoice(expiredPrepaymentInvoice.invoice_id);
    await finalizeInvoice(activePrepaymentInvoice.invoice_id);

    // Step 4: Get the credit transactions
    const expiredCreditTransaction = await context.db('transactions')
      .where({
        company_id: context.companyId,
        invoice_id: expiredPrepaymentInvoice.invoice_id,
        type: 'credit_issuance'
      })
      .first();

    const activeCreditTransaction = await context.db('transactions')
      .where({
        company_id: context.companyId,
        invoice_id: activePrepaymentInvoice.invoice_id,
        type: 'credit_issuance'
      })
      .first();

    // Step 5: Manually expire the expired credit
    await context.db('credit_tracking')
      .where({
        transaction_id: expiredCreditTransaction.transaction_id,
        tenant: context.tenantId
      })
      .update({
        is_expired: true,
        remaining_amount: 0,
        updated_at: new Date().toISOString()
      });

    // Create an expiration transaction
    await context.db('transactions').insert({
      transaction_id: uuidv4(),
      company_id: context.companyId,
      amount: -expiredCreditAmount,
      type: 'credit_expiration',
      status: 'completed',
      description: 'Credit expired',
      created_at: new Date().toISOString(),
      tenant: context.tenantId,
      related_transaction_id: expiredCreditTransaction.transaction_id
    });

    // Update company credit balance to reflect the expired credit
    await context.db('companies')
      .where({ company_id: context.companyId, tenant: context.tenantId })
      .update({
        credit_balance: activeCreditAmount, // Only the active credit remains
        updated_at: new Date().toISOString()
      });

    // Step 6: Verify initial credit balance (should only include active credit)
    const initialCredit = await CompanyBillingPlan.getCompanyCredit(context.companyId);
    expect(initialCredit).toBe(activeCreditAmount);

    // Step 7: Generate an invoice
    const invoice = await generateInvoice(billingCycleId);

    if (!invoice) {
      throw new Error('Failed to generate invoice');
    }

    // Step 8: Finalize the invoice to apply credit
    await finalizeInvoice(invoice.invoice_id);

    // Step 9: Get the updated invoice to verify credit application
    const updatedInvoice = await context.db('invoices')
      .where({ invoice_id: invoice.invoice_id })
      .first();

    // Step 10: Verify credit application
    // Calculate expected values
    const subtotal = 10000; // $100.00
    const tax = 1000;      // $10.00 (10% of $100)
    const totalBeforeCredit = subtotal + tax; // $110.00
    const expectedAppliedCredit = activeCreditAmount; // Only the active credit should be applied
    const expectedRemainingTotal = totalBeforeCredit - expectedAppliedCredit; // $110 - $70 = $40

    // Verify invoice values
    expect(updatedInvoice.subtotal).toBe(subtotal);
    expect(updatedInvoice.tax).toBe(tax);
    expect(updatedInvoice.credit_applied).toBe(expectedAppliedCredit);
    expect(parseInt(updatedInvoice.total_amount)).toBe(expectedRemainingTotal);

    // Step 11: Verify credit application transaction
    const creditApplicationTx = await context.db('transactions')
      .where({
        company_id: context.companyId,
        invoice_id: invoice.invoice_id,
        type: 'credit_application'
      })
      .first();

    expect(creditApplicationTx).toBeTruthy();
    expect(parseFloat(creditApplicationTx.amount)).toBe(-expectedAppliedCredit);

    // Step 12: Verify the metadata contains only the active credit
    const metadata = typeof creditApplicationTx.metadata === 'string'
      ? JSON.parse(creditApplicationTx.metadata)
      : creditApplicationTx.metadata;

    expect(metadata.applied_credits).toBeTruthy();
    expect(metadata.applied_credits.length).toBe(1); // Only one credit should be applied

    // Verify the applied credit is the active one
    expect(metadata.applied_credits[0].transactionId).toBe(activeCreditTransaction.transaction_id);
    expect(metadata.applied_credits[0].amount).toBe(activeCreditAmount);

    // Step 13: Verify the expired credit was not used
    const expiredCreditTracking = await context.db('credit_tracking')
      .where({
        transaction_id: expiredCreditTransaction.transaction_id,
        tenant: context.tenantId
      })
      .first();

    expect(expiredCreditTracking.is_expired).toBe(true);
    expect(Number(expiredCreditTracking.remaining_amount)).toBe(0);

    // Step 14: Verify the active credit was fully used
    const activeCreditTracking = await context.db('credit_tracking')
      .where({
        transaction_id: activeCreditTransaction.transaction_id,
        tenant: context.tenantId
      })
      .first();

    expect(activeCreditTracking.is_expired).toBe(false);
    expect(Number(activeCreditTracking.remaining_amount)).toBe(0); // Fully used

    // Step 15: Verify final credit balance is zero
    const finalCredit = await CompanyBillingPlan.getCompanyCredit(context.companyId);
    expect(finalCredit).toBe(0);
  });
});
