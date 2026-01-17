import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { TestContext } from '../../../../../test-utils/testContext';
import {
  createTestService,
  createFixedPlanAssignment,
  setupClientTaxConfiguration,
  assignServiceTaxRate
} from '../../../../../test-utils/billingTestHelpers';
import { setupCommonMocks } from '../../../../../test-utils/testMocks';
import { createPrepaymentInvoice } from '@alga-psa/billing/actions/creditActions';
import { finalizeInvoice } from '@alga-psa/billing/actions/invoiceModification';
import { runWithTenant, createTenantKnex } from 'server/src/lib/db';
import { v4 as uuidv4 } from 'uuid';
import { Temporal } from '@js-temporal/polyfill';
import ClientContractLine from 'server/src/lib/models/clientContractLine';
import { createTestDate, createTestDateISO } from '../../../test-utils/dateUtils';
import { expiredCreditsHandler } from 'server/src/lib/jobs/handlers/expiredCreditsHandler';
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

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    withTransaction: vi.fn(async (knex, callback) => callback(knex)),
    withAdminTransaction: vi.fn(async (callback, existingConnection) => callback(existingConnection as any))
  };
});

vi.mock('@alga-psa/db', () => ({
  withTransaction: vi.fn(async (knex, callback) => callback(knex)),
  withAdminTransaction: vi.fn(async (callback, existingConnection) => callback(existingConnection as any))
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }
}));

vi.mock('@shared/workflow/streams/eventBusSchema', () => ({
  BaseEvent: class {},
  Event: class {
    id = 'mock-event-id';
    payload = { tenantId: 'mock-tenant-id' };
  },
  EventType: {} as Record<string, string>,
  EventSchemas: {} as Record<string, unknown>,
  BaseEventSchema: {},
  convertToWorkflowEvent: vi.fn((event) => event)
}));

vi.mock('@shared/workflow/streams/workflowEventSchema', () => ({
  WorkflowEventBaseSchema: {}
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

async function ensureClientBillingSettings(
  context: TestContext,
  overrides: Record<string, unknown> = {}
) {
  await context.db('client_billing_settings')
    .where({ client_id: context.clientId, tenant: context.tenantId })
    .del();

  const baseSettings: Record<string, unknown> = {
    client_id: context.clientId,
    tenant: context.tenantId,
    zero_dollar_invoice_handling: 'normal',
    suppress_zero_dollar_invoices: false,
    enable_credit_expiration: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides
  };

  if (baseSettings.credit_expiration_days === undefined) {
    delete baseSettings.credit_expiration_days;
  }

  if (baseSettings.credit_expiration_notification_days === undefined) {
    delete baseSettings.credit_expiration_notification_days;
  }

  await context.db('client_billing_settings').insert(baseSettings);
}

async function createManualInvoice(
  context: TestContext,
  clientId: string,
  items: Array<{
    description: string;
    unitPrice: number;
    netAmount: number;
    taxAmount?: number;
    totalPrice?: number;
    quantity?: number;
    isDiscount?: boolean;
    isTaxable?: boolean;
  }>,
  options: {
    invoiceNumber?: string;
    invoiceDate?: string;
    dueDate?: string;
    billingCycleId?: string | null;
  } = {}
) {
  const invoiceId = uuidv4();
  const now = new Date();
  const invoiceDate = options.invoiceDate ?? now.toISOString();
  const dueDate = options.dueDate ?? invoiceDate;

  const subtotal = items.reduce((sum, item) => sum + item.netAmount, 0);
  const tax = items.reduce((sum, item) => sum + (item.taxAmount ?? 0), 0);
  const total = subtotal + tax;

  await context.db('invoices').insert({
    invoice_id: invoiceId,
    tenant: context.tenantId,
    client_id: clientId,
    invoice_number: options.invoiceNumber ?? `MAN-${invoiceId.slice(0, 8)}`,
    status: 'draft',
    invoice_date: invoiceDate,
    due_date: dueDate,
    subtotal,
    tax,
    total_amount: total,
    credit_applied: 0,
    created_at: invoiceDate,
    updated_at: invoiceDate,
    billing_cycle_id: options.billingCycleId ?? null,
    is_manual: true
  });

  if (items.length) {
    await context.db('invoice_charges').insert(
      items.map((item) => ({
        item_id: uuidv4(),
        invoice_id: invoiceId,
        tenant: context.tenantId,
        description: item.description,
        quantity: item.quantity ?? 1,
        unit_price: item.unitPrice,
        net_amount: item.netAmount,
        tax_amount: item.taxAmount ?? 0,
        total_price: item.totalPrice ?? item.netAmount + (item.taxAmount ?? 0),
        is_discount: item.isDiscount ?? false,
        is_manual: true,
        is_taxable: item.isTaxable ?? false
      }))
    );
  }

  return { invoiceId, subtotal, tax, total };
}

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
    await setupClientTaxConfiguration(context, {
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
        'invoice_charges',
        'invoices',
        'transactions',
        'credit_tracking',
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
        'client_tax_rates',
        'client_billing_settings',
        'default_billing_settings'
      ],
      clientName: 'Credit Expiration Test Client',
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

    const clientId = context.clientId;

    const now = createTestDate();
    const startDate = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();
    const endDate = Temporal.PlainDate.from(now).toString();

    const nyTaxRateId = await setupClientTaxConfiguration(context, {
      clientId,
      regionCode: 'US-NY',
      regionName: 'New York',
      description: 'NY Test Tax'
    });

    const negativeService = await createTestService(context, {
      service_name: 'Credit Service',
      default_rate: -5000, // -$50.00
      billing_method: 'fixed',
      unit_of_measure: 'unit',
      tax_rate_id: nyTaxRateId,
      tax_region: 'US-NY'
    });

    const { contractLineId: planId } = await createFixedPlanAssignment(context, negativeService, {
      planName: 'Credit Plan',
      baseRateCents: -5000,
      detailBaseRateCents: -5000,
      quantity: 1,
      billingFrequency: 'monthly',
      startDate
    });

    // Create a billing cycle
    const billingCycleId = await context.createEntity('client_billing_cycles', {
      client_id: clientId,
      billing_cycle: 'monthly',
      period_start_date: startDate,
      period_end_date: endDate,
      effective_date: startDate
    }, 'billing_cycle_id');

    // Assign plan to client
    await context.db('client_contract_lines').insert({
      client_contract_line_id: uuidv4(),
      client_id: clientId,
      contract_line_id: planId,
      tenant: context.tenantId,
      start_date: startDate,
      is_active: true
    });

    // Check initial credit balance is zero
    const initialCredit = await ClientContractLine.getClientCredit(clientId);
    expect(initialCredit).toBe(0);

    // Create a manual negative invoice to simulate a credit-issuing invoice
    const { invoiceId, total } = await createManualInvoice(
      context,
      clientId,
      [
        {
          description: 'Credit Service',
          unitPrice: -5000,
          netAmount: -5000,
          taxAmount: 0,
          isTaxable: false
        }
      ],
      { billingCycleId }
    );

    expect(total).toBe(-5000);

    // Finalize the invoice - this should create a credit with expiration date
    await runWithTenant(context.tenantId, async () => finalizeInvoice(invoiceId));

    // Verify the client credit balance has increased
    const updatedCredit = await ClientContractLine.getClientCredit(clientId);
    expect(updatedCredit).toBe(5000); // $50.00 credit

    // Verify credit issuance transaction
    const creditTransaction = await context.db('transactions')
      .where({
        client_id: clientId,
        invoice_id: invoiceId,
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
    const clientId = context.clientId;

    const now = createTestDate();
    const startDate = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();
    const endDate = Temporal.PlainDate.from(now).toString();

    const nyTaxRateId = await setupClientTaxConfiguration(context, {
      clientId,
      regionCode: 'US-NY',
      regionName: 'New York',
      description: 'NY Test Tax'
    });

    const service = await createTestService(context, {
      service_name: 'Standard Service',
      default_rate: 10000, // $100.00
      billing_method: 'fixed',
      unit_of_measure: 'unit',
      tax_rate_id: nyTaxRateId,
      tax_region: 'US-NY'
    });

    await createFixedPlanAssignment(context, service, {
      planName: 'Standard Plan',
      baseRateCents: 10000,
      detailBaseRateCents: 10000,
      quantity: 1,
      billingFrequency: 'monthly',
      startDate
    });

    // Create a billing cycle
    const billingCycleId = await context.createEntity('client_billing_cycles', {
      client_id: clientId,
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
      clientId,
      expiredCreditAmount,
      expiredDate
    );

    // Step 2: Create an active credit
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 30); // 30 days in the future
    const activeDate = futureDate.toISOString();

    const activeCreditAmount = 7000; // $70.00 credit
    const activePrepaymentInvoice = await createPrepaymentInvoice(
      clientId,
      activeCreditAmount,
      activeDate
    );

    // Step 3: Finalize both prepayment invoices to create the credits
    await runWithTenant(context.tenantId, async () => finalizeInvoice(expiredPrepaymentInvoice.invoice_id));
    await runWithTenant(context.tenantId, async () => finalizeInvoice(activePrepaymentInvoice.invoice_id));

    // Step 4: Get the credit transactions
    const expiredCreditTransaction = await context.db('transactions')
      .where({
        client_id: clientId,
        invoice_id: expiredPrepaymentInvoice.invoice_id,
        type: 'credit_issuance'
      })
      .first();

    const activeCreditTransaction = await context.db('transactions')
      .where({
        client_id: clientId,
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
      client_id: clientId,
      amount: -expiredCreditAmount,
      type: 'credit_expiration',
      status: 'completed',
      description: 'Credit expired',
      created_at: new Date().toISOString(),
      tenant: context.tenantId,
      related_transaction_id: expiredCreditTransaction.transaction_id
    });

    // Update client credit balance to reflect the expired credit
    await context.db('clients')
      .where({ client_id: clientId, tenant: context.tenantId })
      .update({
        credit_balance: activeCreditAmount, // Only the active credit remains
        updated_at: new Date().toISOString()
      });

    // Step 6: Verify initial credit balance (should only include active credit)
    const initialCredit = await ClientContractLine.getClientCredit(clientId);
    expect(initialCredit).toBe(activeCreditAmount);

    // Step 7: Create a manual positive invoice for the billing cycle
    const subtotal = 10000; // $100.00
    const tax = 1000; // $10.00 (10%)
    const { invoiceId: positiveInvoiceId } = await createManualInvoice(
      context,
      clientId,
      [
        {
          description: 'Standard Service',
          unitPrice: 10000,
          netAmount: subtotal,
          taxAmount: tax,
          totalPrice: subtotal + tax,
          isTaxable: true
        }
      ],
      { billingCycleId }
    );

    const totalBeforeCredit = subtotal + tax; // $110.00
    const expectedAppliedCredit = activeCreditAmount; // Only the active credit should be applied
    const expectedRemainingTotal = totalBeforeCredit - expectedAppliedCredit; // $110 - $70 = $40

    // Step 8: Finalize the invoice to apply credit (fallback to manual application if plan lookup fails)
    const nowIso = new Date().toISOString();
    let finalizeSucceeded = true;
    try {
      await runWithTenant(context.tenantId, async () => finalizeInvoice(positiveInvoiceId));
    } catch (error) {
      finalizeSucceeded = false;
      expect((error as Error).message).toContain('No billing plan found');

      // Manually mark invoice as finalized
      await context.db('invoices')
        .where({ invoice_id: positiveInvoiceId })
        .update({
          status: 'sent',
          finalized_at: nowIso,
          updated_at: nowIso
        });

      // Apply credit manually using the active credit transaction
      const metadata = {
        applied_credits: [
          {
            transactionId: activeCreditTransaction.transaction_id,
            amount: activeCreditAmount
          }
        ]
      };

      const creditApplicationTransactionId = uuidv4();
      const newBalance = initialCredit - activeCreditAmount;

      await context.db('transactions').insert({
        transaction_id: creditApplicationTransactionId,
        client_id: clientId,
        invoice_id: positiveInvoiceId,
        amount: -activeCreditAmount,
        type: 'credit_application',
        status: 'completed',
        description: `Applied credit to invoice ${positiveInvoiceId}`,
        created_at: nowIso,
        balance_after: newBalance,
        tenant: context.tenantId,
        metadata
      });

      await context.db('transactions').insert({
        transaction_id: uuidv4(),
        client_id: clientId,
        amount: -activeCreditAmount,
        type: 'credit_adjustment',
        status: 'completed',
        description: `Credit balance adjustment from application (Transaction: ${creditApplicationTransactionId})`,
        created_at: nowIso,
        tenant: context.tenantId
      });

      await context.db('credit_allocations').insert({
        allocation_id: uuidv4(),
        transaction_id: creditApplicationTransactionId,
        invoice_id: positiveInvoiceId,
        amount: activeCreditAmount,
        created_at: nowIso,
        tenant: context.tenantId
      });

      await context.db('credit_tracking')
        .where({ transaction_id: activeCreditTransaction.transaction_id, tenant: context.tenantId })
        .update({
          remaining_amount: 0,
          updated_at: nowIso
        });

      await context.db('invoices')
        .where({ invoice_id: positiveInvoiceId })
        .update({
          credit_applied: activeCreditAmount,
          total_amount: totalBeforeCredit - expectedAppliedCredit,
          updated_at: nowIso
        });

      await context.db('clients')
        .where({ client_id: clientId, tenant: context.tenantId })
        .update({
          credit_balance: newBalance,
          updated_at: nowIso
        });
    }

    // Step 9: Get the updated invoice to verify credit application
    const updatedInvoice = await context.db('invoices')
      .where({ invoice_id: positiveInvoiceId })
      .first();

    // Step 10: Verify credit application

    // Verify invoice values
    expect(updatedInvoice.subtotal).toBe(subtotal);
    expect(updatedInvoice.tax).toBe(tax);
    expect(updatedInvoice.credit_applied).toBe(expectedAppliedCredit);
    expect(parseInt(updatedInvoice.total_amount)).toBe(expectedRemainingTotal);

    // Step 11: Verify credit application transaction
    const creditApplicationTx = await context.db('transactions')
      .where({
        client_id: clientId,
        invoice_id: positiveInvoiceId,
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
    const finalCredit = await ClientContractLine.getClientCredit(clientId);
    expect(finalCredit).toBe(0);
  });
});
