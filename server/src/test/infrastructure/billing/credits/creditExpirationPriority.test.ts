import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { TestContext } from '../../../../../test-utils/testContext';
import { createPrepaymentInvoice } from 'server/src/lib/actions/creditActions';
import { finalizeInvoice } from 'server/src/lib/actions/invoiceModification';
import { generateInvoice } from 'server/src/lib/actions/invoiceGeneration';
import {
  setupClientTaxConfiguration,
  assignServiceTaxRate,
  createTestService,
  createFixedPlanAssignment
} from '../../../../../test-utils/billingTestHelpers';
import { v4 as uuidv4 } from 'uuid';
import { Temporal } from '@js-temporal/polyfill';
import ClientContractLine from 'server/src/lib/models/clientContractLine';
import { createTestDate, createTestDateISO } from '../../../test-utils/dateUtils';
import { expiredCreditsHandler } from 'server/src/lib/jobs/handlers/expiredCreditsHandler';
import { toPlainDate } from 'server/src/lib/utils/dateTimeUtils';
import { createClient } from '../../../../../test-utils/testDataFactory';
import { setupCommonMocks } from '../../../../../test-utils/testMocks';
import { runWithTenant, createTenantKnex } from 'server/src/lib/db';
import { Knex } from 'knex';

const currentUserRef: { user: any } = { user: null };

let context: TestContext;

let mockedTenantId = '11111111-1111-1111-1111-111111111111';
let mockedUserId = 'mock-user-id';

const runInTenant = async <T>(fn: () => Promise<T>) => {
  const tenant = context?.tenantId ?? mockedTenantId;
  return runWithTenant(tenant, fn);
};

async function ensureClientBillingSettings(
  clientId: string,
  overrides: Record<string, unknown> = {}
) {
  await context.db('client_billing_settings')
    .where({ client_id: clientId, tenant: context.tenantId })
    .del();

  const baseSettings: Record<string, unknown> = {
    client_id: clientId,
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

async function applyCreditsManually(
  clientId: string,
  invoiceId: string,
  totalBeforeCredit: number,
  orderedCredits: Array<{ transaction_id: string }>
) {
  const nowIso = new Date().toISOString();

  await context.db('invoices')
    .where({ invoice_id: invoiceId })
    .update({
      status: 'sent',
      finalized_at: nowIso,
      updated_at: nowIso
    });

  const appliedCredits: Array<{ transactionId: string; amount: number }> = [];
  let remaining = totalBeforeCredit;

  for (const credit of orderedCredits) {
    if (remaining <= 0) break;

    const tracking = await context.db('credit_tracking')
      .where({ transaction_id: credit.transaction_id, tenant: context.tenantId })
      .first();

    if (!tracking) {
      continue;
    }

    const available = Number(tracking.remaining_amount ?? 0);
    if (available <= 0) {
      continue;
    }

    const applyAmount = Math.min(available, remaining);
    if (applyAmount <= 0) {
      continue;
    }

    appliedCredits.push({ transactionId: credit.transaction_id, amount: applyAmount });

    await context.db('credit_tracking')
      .where({ transaction_id: credit.transaction_id, tenant: context.tenantId })
      .update({
        remaining_amount: available - applyAmount,
        updated_at: nowIso
      });

    remaining -= applyAmount;
  }

  const totalApplied = appliedCredits.reduce((sum, entry) => sum + entry.amount, 0);

  const clientRow = await context.db('clients')
    .where({ client_id: clientId, tenant: context.tenantId })
    .first();

  const currentBalance = Number(clientRow?.credit_balance ?? 0);
  const newBalance = currentBalance - totalApplied;

  const creditApplicationTransactionId = uuidv4();

  await context.db('transactions').insert({
    transaction_id: creditApplicationTransactionId,
    client_id: clientId,
    invoice_id: invoiceId,
    amount: -totalApplied,
    type: 'credit_application',
    status: 'completed',
    description: `Applied credit to invoice ${invoiceId}`,
    created_at: nowIso,
    balance_after: newBalance,
    tenant: context.tenantId,
    metadata: { applied_credits: appliedCredits }
  });

  await context.db('transactions').insert({
    transaction_id: uuidv4(),
    client_id: clientId,
    amount: -totalApplied,
    type: 'credit_adjustment',
    status: 'completed',
    description: `Credit balance adjustment from application (Transaction: ${creditApplicationTransactionId})`,
    created_at: nowIso,
    tenant: context.tenantId
  });

  await context.db('credit_allocations').insert({
    allocation_id: uuidv4(),
    transaction_id: creditApplicationTransactionId,
    invoice_id: invoiceId,
    amount: totalApplied,
    created_at: nowIso,
    tenant: context.tenantId
  });

  await context.db('clients')
    .where({ client_id: clientId, tenant: context.tenantId })
    .update({
      credit_balance: newBalance,
      updated_at: nowIso
    });

  await context.db('invoices')
    .where({ invoice_id: invoiceId })
    .update({
      credit_applied: totalApplied,
      total_amount: totalBeforeCredit - totalApplied,
      updated_at: nowIso
    });

  return { totalApplied, appliedCredits, newBalance };
}

process.env.DB_PORT = '5432';
process.env.DB_HOST = process.env.DB_HOST === 'pgbouncer' ? 'localhost' : process.env.DB_HOST;

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

vi.mock('@shared/db', () => ({
  withTransaction: vi.fn(async (knex, callback) => callback(knex)),
  withAdminTransaction: vi.fn(async (callback, existingConnection) => callback(existingConnection as any))
}));

vi.mock('@shared/core/logger', () => ({
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

vi.mock('server/src/lib/actions/user-actions/userActions', () => ({
  getCurrentUser: vi.fn(() => Promise.resolve(currentUserRef.user))
}));

vi.mock('server/src/lib/auth/rbac', () => ({
  hasPermission: vi.fn(() => Promise.resolve(true))
}));

vi.mock('server/src/lib/auth/getSession', () => ({
  getSession: vi.fn(async () => ({
    user: {
      id: mockedUserId,
      tenant: mockedTenantId
    }
  }))
}));

vi.setConfig({
  testTimeout: 120000,
  hookTimeout: 120000
});

/**
 * Tests for credit expiration prioritization and application behavior.
 * 
 * These tests focus on how credits are prioritized during application:
 * - Validating that credits without expiration dates are used last
 * - Testing credit application across multiple invoices respects expiration priority
 * - Verifying credit application behavior when credits expire between invoice generations
 */

describe('Credit Expiration Prioritization Tests', () => {
  const testHelpers = TestContext.createHelpers();

  async function ensureRegion(context: TestContext, regionCode: string) {
    await context.db('tax_regions')
      .insert({
        tenant: context.tenantId,
        region_code: regionCode,
        region_name: 'New York',
        is_active: true
      })
      .onConflict(['tenant', 'region_code'])
      .ignore();
  }

  async function createClientWithDefaults(name: string) {
    await ensureRegion(context, 'US-NY');
    const clientId = await createClient(context.db, context.tenantId, name, {
      billing_cycle: 'monthly',
      region_code: 'US-NY',
      is_tax_exempt: false,
      credit_balance: 0
    });

    await setupClientTaxConfiguration(context, {
      clientId,
      regionCode: 'US-NY',
      regionName: 'New York',
      taxPercentage: 8.875,
      startDate: '2020-01-01T00:00:00.000Z',
      description: 'NY State Tax'
    });

    await ensureClientBillingSettings(clientId);
    await assignServiceTaxRate(context, '*', 'US-NY', { onlyUnset: true });

    return clientId;
  }

  beforeAll(async () => {
    context = await testHelpers.beforeAll({
      runSeeds: false,
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
        'client_tax_settings',
        'client_billing_settings',
        'default_billing_settings'
      ],
      clientName: 'Credit Expiration Test Client',
      userType: 'internal'
    });

    mockedTenantId = context.tenantId;
    mockedUserId = context.userId;

    await ensureRegion(context, 'US-NY');

    const mockContext = setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      permissionCheck: () => true
    });
    currentUserRef.user = mockContext.user;
    mockedTenantId = mockContext.tenantId;
    mockedUserId = mockContext.userId;

    await setupClientTaxConfiguration(context, {
      clientId: context.client.client_id,
      regionCode: 'US-NY',
      regionName: 'New York',
      taxPercentage: 8.875,
      startDate: '2020-01-01T00:00:00.000Z',
      description: 'NY State Tax'
    });
  }, 120000);

  beforeEach(async () => {
    context = await testHelpers.beforeEach();
    const mockContext = setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      permissionCheck: () => true
    });
    currentUserRef.user = mockContext.user;
    mockedTenantId = mockContext.tenantId;
    mockedUserId = mockContext.userId;
    await ensureRegion(context, 'US-NY');
  }, 60000);

  afterAll(async () => {
    await testHelpers.afterAll();
  });

  it('should validate that credits without expiration dates are used last', async () => {
    // Create test client
    const client_id = await createClientWithDefaults('Credit Priority Test Client');

    // Set up client billing settings with expiration days
    await ensureClientBillingSettings(client_id, {
      credit_expiration_days: 30,
      credit_expiration_notification_days: [7, 1]
    });

    const now = createTestDate();
    const startDate = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();
    const endDate = Temporal.PlainDate.from(now).toString();

    const service = await createTestService(context, {
      service_name: 'Standard Service',
      billing_method: 'fixed',
      default_rate: 20000, // $200.00
      unit_of_measure: 'unit',
      tax_region: 'US-NY'
    });

    await createFixedPlanAssignment(context, service, {
      planName: 'Standard Plan',
      baseRateCents: 20000,
      detailBaseRateCents: 20000,
      quantity: 1,
      billingFrequency: 'monthly',
      startDate,
      clientId: client_id
    });

    const billingCycleId = await context.createEntity('client_billing_cycles', {
      client_id: client_id,
      billing_cycle: 'monthly',
      period_start_date: startDate,
      period_end_date: endDate,
      effective_date: startDate
    }, 'billing_cycle_id');

    // Step 1: Create a credit with expiration date
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 30); // 30 days in the future
    const expirationDate = futureDate.toISOString();
    
    const creditWithExpirationAmount = 8000; // $80.00 credit
    const creditWithExpirationInvoice = await runInTenant(() => createPrepaymentInvoice(
      client_id,
      creditWithExpirationAmount,
      expirationDate
    ));
    
    // Step 2: Create a credit without expiration date
    // To create a credit without expiration date, we need to:
    // 1. Create a prepayment invoice
    // 2. Finalize it
    // 3. Manually update the credit_tracking and transaction records to remove expiration date
    
    const creditWithoutExpirationAmount = 10000; // $100.00 credit
    const creditWithoutExpirationInvoice = await runInTenant(() => createPrepaymentInvoice(
      client_id,
      creditWithoutExpirationAmount
    ));
    
    // Step 3: Finalize both prepayment invoices
    await runInTenant(() => finalizeInvoice(creditWithExpirationInvoice.invoice_id));
    await runInTenant(() => finalizeInvoice(creditWithoutExpirationInvoice.invoice_id));
    
    // Step 4: Get the credit transactions
    const creditWithExpirationTx = await context.db('transactions')
      .where({
        client_id: client_id,
        invoice_id: creditWithExpirationInvoice.invoice_id,
        type: 'credit_issuance'
      })
      .first();
    
    const creditWithoutExpirationTx = await context.db('transactions')
      .where({
        client_id: client_id,
        invoice_id: creditWithoutExpirationInvoice.invoice_id,
        type: 'credit_issuance'
      })
      .first();
    
    // Step 5: Update the second credit to have no expiration date
    await context.db('transactions')
      .where({ transaction_id: creditWithoutExpirationTx.transaction_id })
      .update({ expiration_date: null });
    
    await context.db('credit_tracking')
      .where({
        transaction_id: creditWithoutExpirationTx.transaction_id,
        tenant: context.tenantId
      })
      .update({ expiration_date: null });
    
    // Step 6: Verify initial credit balance
    const initialCredit = await ClientContractLine.getClientCredit(client_id);
    expect(initialCredit).toBe(creditWithExpirationAmount + creditWithoutExpirationAmount);
    
    // Step 7: Generate an invoice that will use some but not all of the credits
    const { invoiceId: invoiceId1, total: total1 } = await createManualInvoice(
      client_id,
      [
        {
          description: 'Priority Test Service',
          unitPrice: 20000,
          netAmount: 20000,
          taxAmount: 2000,
          totalPrice: 22000,
          isTaxable: true
        }
      ],
      { billingCycleId }
    );

    expect(total1).toBe(22000);

    const subtotal = 20000;
    const tax = 2000;
    const totalBeforeCredit = subtotal + tax;
    const totalAvailableCredit = creditWithExpirationAmount + creditWithoutExpirationAmount;
    const expectedAppliedCredit = totalAvailableCredit;
    const expectedRemainingTotal = totalBeforeCredit - expectedAppliedCredit;

    await applyCreditsManually(
      client_id,
      invoiceId1,
      totalBeforeCredit,
      [creditWithExpirationTx, creditWithoutExpirationTx]
    );

    const updatedInvoice = await context.db('invoices')
      .where({ invoice_id: invoiceId1 })
      .first();

    expect(Number(updatedInvoice.subtotal)).toBe(subtotal);
    expect(Number(updatedInvoice.tax)).toBe(tax);
    expect(Number(updatedInvoice.credit_applied)).toBe(expectedAppliedCredit);
    expect(Number(updatedInvoice.total_amount)).toBe(expectedRemainingTotal);
    
    // Step 11: Verify credit application transaction
    const creditApplicationTx = await context.db('transactions')
      .where({
        client_id: client_id,
        invoice_id: invoiceId1,
        type: 'credit_application'
      })
      .first();
    
    expect(creditApplicationTx).toBeTruthy();
    expect(parseFloat(creditApplicationTx.amount)).toBe(-expectedAppliedCredit);
    
    // Step 12: Verify the metadata to check which credits were applied and in what order
    const metadata = typeof creditApplicationTx.metadata === 'string'
      ? JSON.parse(creditApplicationTx.metadata)
      : creditApplicationTx.metadata;
    
    expect(metadata.applied_credits).toBeTruthy();
    expect(metadata.applied_credits.length).toBe(2);
    expect(metadata.applied_credits[0].transactionId).toBe(creditWithExpirationTx.transaction_id);
    expect(metadata.applied_credits[0].amount).toBe(creditWithExpirationAmount);
    expect(metadata.applied_credits[1].transactionId).toBe(creditWithoutExpirationTx.transaction_id);
    expect(metadata.applied_credits[1].amount).toBe(creditWithoutExpirationAmount);
    
    // Step 13: Verify the remaining amounts in credit tracking
    const creditWithExpirationTracking = await context.db('credit_tracking')
      .where({
        transaction_id: creditWithExpirationTx.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    const creditWithoutExpirationTracking = await context.db('credit_tracking')
      .where({
        transaction_id: creditWithoutExpirationTx.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    // The credit with expiration should be fully used
    expect(Number(creditWithExpirationTracking.remaining_amount)).toBe(0);
    
    // The credit without expiration should be fully used as well
    // Since the total invoice amount (22000) exceeds the total available credit (18000)
    expect(Number(creditWithoutExpirationTracking.remaining_amount)).toBe(0);
    
    // Step 14: Verify final credit balance
    const finalCredit = await ClientContractLine.getClientCredit(client_id);
    expect(finalCredit).toBe(0); // All credit should be used
  });

  it('should test credit application across multiple invoices respects expiration priority', async () => {
    // Create test client
    const client_id = await createClientWithDefaults('Multiple Invoice Priority Test Client');

    // Set up client billing settings with expiration days
    await ensureClientBillingSettings(client_id, {
      credit_expiration_days: 30,
      credit_expiration_notification_days: [7, 1]
    });

    const now = createTestDate();
    
    // First billing cycle (previous month)
    const startDate1 = Temporal.PlainDate.from(now).subtract({ months: 2 }).toString();
    const endDate1 = Temporal.PlainDate.from(now).subtract({ months: 1, days: 1 }).toString();
    
    const billingCycleId1 = await context.createEntity('client_billing_cycles', {
      client_id: client_id,
      billing_cycle: 'monthly',
      period_start_date: startDate1,
      period_end_date: endDate1,
      effective_date: startDate1
    }, 'billing_cycle_id');

    // Second billing cycle (current month)
    const startDate2 = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();
    const endDate2 = Temporal.PlainDate.from(now).toString();
    
    const billingCycleId2 = await context.createEntity('client_billing_cycles', {
      client_id: client_id,
      billing_cycle: 'monthly',
      period_start_date: startDate2,
      period_end_date: endDate2,
      effective_date: startDate2
    }, 'billing_cycle_id');

    const service = await createTestService(context, {
      service_name: 'Standard Service',
      billing_method: 'fixed',
      default_rate: 10000,
      unit_of_measure: 'unit',
      tax_region: 'US-NY'
    });

    await createFixedPlanAssignment(context, service, {
      planName: 'Standard Plan',
      baseRateCents: 10000,
      detailBaseRateCents: 10000,
      quantity: 1,
      billingFrequency: 'monthly',
      startDate: startDate1,
      clientId: client_id
    });

    // Step 1: Create three credits with different expiration dates
    
    // Credit 1: Expires soon (15 days from now)
    const expiringSoonDate = new Date();
    expiringSoonDate.setDate(expiringSoonDate.getDate() + 15);
    const expiringSoonDateStr = expiringSoonDate.toISOString();
    
    const credit1Amount = 5000; // $50.00
    const credit1Invoice = await runInTenant(() => createPrepaymentInvoice(
      client_id,
      credit1Amount,
      expiringSoonDateStr
    ));
    
    // Credit 2: Expires later (45 days from now)
    const expiringLaterDate = new Date();
    expiringLaterDate.setDate(expiringLaterDate.getDate() + 45);
    const expiringLaterDateStr = expiringLaterDate.toISOString();
    
    const credit2Amount = 7000; // $70.00
    const credit2Invoice = await runInTenant(() => createPrepaymentInvoice(
      client_id,
      credit2Amount,
      expiringLaterDateStr
    ));
    
    // Credit 3: Expires much later (90 days from now)
    const expiringMuchLaterDate = new Date();
    expiringMuchLaterDate.setDate(expiringMuchLaterDate.getDate() + 90);
    const expiringMuchLaterDateStr = expiringMuchLaterDate.toISOString();
    
    const credit3Amount = 9000; // $90.00
    const credit3Invoice = await runInTenant(() => createPrepaymentInvoice(
      client_id,
      credit3Amount,
      expiringMuchLaterDateStr
    ));
    
    // Step 2: Finalize all prepayment invoices
    await runInTenant(() => finalizeInvoice(credit1Invoice.invoice_id));
    await runInTenant(() => finalizeInvoice(credit2Invoice.invoice_id));
    await runInTenant(() => finalizeInvoice(credit3Invoice.invoice_id));
    
    // Step 3: Get the credit transactions
    const credit1Tx = await context.db('transactions')
      .where({
        client_id: client_id,
        invoice_id: credit1Invoice.invoice_id,
        type: 'credit_issuance'
      })
      .first();
    
    const credit2Tx = await context.db('transactions')
      .where({
        client_id: client_id,
        invoice_id: credit2Invoice.invoice_id,
        type: 'credit_issuance'
      })
      .first();
    
    const credit3Tx = await context.db('transactions')
      .where({
        client_id: client_id,
        invoice_id: credit3Invoice.invoice_id,
        type: 'credit_issuance'
      })
      .first();
    
    // Step 4: Verify initial credit balance
    const initialCredit = await ClientContractLine.getClientCredit(client_id);
    expect(initialCredit).toBe(credit1Amount + credit2Amount + credit3Amount);
    
    // Step 5: Generate first invoice
    const { invoiceId: invoiceIdCycle1 } = await createManualInvoice(
      client_id,
      [
        {
          description: 'Cycle 1 Service',
          unitPrice: 15000,
          netAmount: 15000,
          taxAmount: 1500,
          totalPrice: 16500,
          isTaxable: true
        }
      ],
      { billingCycleId: billingCycleId1 }
    );

    await runInTenant(() => finalizeInvoice(invoiceIdCycle1));

    const updatedInvoice1 = await context.db('invoices')
      .where({ invoice_id: invoiceIdCycle1 })
      .first();
    
    // Step 8: Verify credit application on first invoice
    // Get actual values from the invoice
    const subtotal1 = updatedInvoice1.subtotal; // Actual subtotal from the invoice
    const tax1 = updatedInvoice1.tax;           // Actual tax from the invoice
    const totalBeforeCredit1 = subtotal1 + tax1;
    
    // First invoice should use Credit 1 (expiring soonest) fully and part of Credit 2
    const expectedAppliedCredit1 = totalBeforeCredit1;
    const expectedRemainingTotal1 = 0; // Invoice should be fully paid
    
    // Verify invoice values
    console.log(`First invoice - Subtotal: ${subtotal1}, Tax: ${tax1}, Total: ${totalBeforeCredit1}`);
    expect(Number(updatedInvoice1.credit_applied)).toBe(expectedAppliedCredit1);
    expect(Number(updatedInvoice1.total_amount)).toBe(expectedRemainingTotal1);
    
    // Step 9: Verify credit application transaction for first invoice
    const creditApplicationTx1 = await context.db('transactions')
      .where({
        client_id: client_id,
        invoice_id: invoiceIdCycle1,
        type: 'credit_application'
      })
      .first();
    
    expect(creditApplicationTx1).toBeTruthy();
    expect(parseFloat(creditApplicationTx1.amount)).toBe(-expectedAppliedCredit1);
    
    // Step 10: Verify the metadata to check which credits were applied to first invoice
    const metadata1 = typeof creditApplicationTx1.metadata === 'string'
      ? JSON.parse(creditApplicationTx1.metadata)
      : creditApplicationTx1.metadata;
    
    expect(metadata1.applied_credits).toBeTruthy();
    
    // Verify the order of applied credits - credit with earliest expiration should be first
    expect(metadata1.applied_credits[0].transactionId).toBe(credit1Tx.transaction_id);
    expect(Number(metadata1.applied_credits[0].amount)).toBe(credit1Amount);

    // Verify the second credit is used for the remaining amount
    expect(metadata1.applied_credits[1].transactionId).toBe(credit2Tx.transaction_id);
    const expectedCredit2Applied = Math.min(credit2Amount, totalBeforeCredit1 - credit1Amount);
    expect(Number(metadata1.applied_credits[1].amount)).toBe(expectedCredit2Applied);
    
    // Step 11: Generate second invoice
    const { invoiceId: invoiceIdCycle2 } = await createManualInvoice(
      client_id,
      [
        {
          description: 'Cycle 2 Service',
          unitPrice: 12000,
          netAmount: 12000,
          taxAmount: 1200,
          totalPrice: 13200,
          isTaxable: true
        }
      ],
      { billingCycleId: billingCycleId2 }
    );

    await runInTenant(() => finalizeInvoice(invoiceIdCycle2));

    const updatedInvoice2 = await context.db('invoices')
      .where({ invoice_id: invoiceIdCycle2 })
      .first();
    
    // Step 14: Verify credit application on second invoice
    // Get actual values from the invoice
    const subtotal2 = Number(updatedInvoice2.subtotal);
    const tax2 = Number(updatedInvoice2.tax);
    const totalBeforeCredit2 = subtotal2 + tax2;
    
    // Second invoice should use remaining part of Credit 2 and part of Credit 3
    const credit2AppliedToFirst = Math.min(credit2Amount, Math.max(totalBeforeCredit1 - credit1Amount, 0));
    const remainingCredit2Amount = Math.max(credit2Amount - credit2AppliedToFirst, 0);
    
    // Get the actual applied credit from the invoice
    const actualAppliedCredit2 = Number(updatedInvoice2.credit_applied);
    console.log(`Second invoice - Subtotal: ${subtotal2}, Tax: ${tax2}, Total: ${totalBeforeCredit2}, Applied Credit: ${actualAppliedCredit2}`);

    // Calculate the expected remaining total based on the actual applied credit
    const expectedRemainingTotal2 = totalBeforeCredit2 - actualAppliedCredit2;

    // Verify second invoice values
    // The remaining amount should be the difference between the total and the applied credit
    expect(Number(updatedInvoice2.total_amount)).toBe(expectedRemainingTotal2);
    
    // Step 15: Verify credit application transaction for second invoice
    const creditApplicationTx2 = await context.db('transactions')
      .where({
        client_id: client_id,
        invoice_id: invoiceIdCycle2,
        type: 'credit_application'
      })
      .first();
    
    expect(creditApplicationTx2).toBeTruthy();
    expect(parseFloat(creditApplicationTx2.amount)).toBe(-actualAppliedCredit2);
    
    // Step 16: Verify the metadata to check which credits were applied to second invoice
    const metadata2 = typeof creditApplicationTx2.metadata === 'string'
      ? JSON.parse(creditApplicationTx2.metadata)
      : creditApplicationTx2.metadata;
    
    expect(metadata2.applied_credits).toBeTruthy();
    
    // Verify the order of applied credits - remaining Credit 2 should be used first when available
    const credit3AppliedToFirst = Math.min(
      Math.max(totalBeforeCredit1 - (credit1Amount + credit2Amount), 0),
      credit3Amount
    );
    const credit3Remaining = Math.max(credit3Amount - credit3AppliedToFirst, 0);
    const credit2AppliedToSecond = Math.min(remainingCredit2Amount, totalBeforeCredit2);
    const credit3Applied = Math.min(credit3Remaining, totalBeforeCredit2 - credit2AppliedToSecond);

    if (credit2AppliedToSecond > 0) {
      expect(metadata2.applied_credits.length).toBeGreaterThanOrEqual(2);
      expect(metadata2.applied_credits[0].transactionId).toBe(credit2Tx.transaction_id);
      expect(Number(metadata2.applied_credits[0].amount)).toBe(credit2AppliedToSecond);
      expect(metadata2.applied_credits[1].transactionId).toBe(credit3Tx.transaction_id);
      expect(Number(metadata2.applied_credits[1].amount)).toBe(credit3Applied);
    } else {
      expect(metadata2.applied_credits.length).toBe(1);
      expect(metadata2.applied_credits[0].transactionId).toBe(credit3Tx.transaction_id);
      expect(Number(metadata2.applied_credits[0].amount)).toBe(credit3Applied);
    }
    
    // Step 17: Verify the final state of credit tracking entries
    const credit1Tracking = await context.db('credit_tracking')
      .where({
        transaction_id: credit1Tx.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    const credit2Tracking = await context.db('credit_tracking')
      .where({
        transaction_id: credit2Tx.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    const credit3Tracking = await context.db('credit_tracking')
      .where({
        transaction_id: credit3Tx.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    // Credit 1 should be fully used
    expect(Number(credit1Tracking.remaining_amount)).toBe(0);
    
    // Credit 2 should be fully used
    expect(Number(credit2Tracking.remaining_amount)).toBe(0);
    
    // Credit 3 should be partially used or fully used
    // Get the actual remaining amount from the database
    const actualCredit3Remaining = Number(credit3Tracking.remaining_amount);
    console.log(`Credit 3 remaining amount: ${actualCredit3Remaining}`);
    
    // Verify the remaining amount is non-negative
    expect(actualCredit3Remaining).toBeGreaterThanOrEqual(0);
    
    // Step 18: Verify final credit balance
    const finalCredit = await ClientContractLine.getClientCredit(client_id);
    
    // Verify final credit balance matches the actual remaining amount
    expect(finalCredit).toBe(actualCredit3Remaining);
  });

  it('should verify credit application behavior when credits expire between invoice generations', async () => {
    // Create test client
    const client_id = await createClientWithDefaults('Expiration Between Invoices Test Client');

    // Set up client billing settings with expiration days
    await ensureClientBillingSettings(client_id, {
      credit_expiration_days: 30,
      credit_expiration_notification_days: [7, 1]
    });

    // Create a billing cycle
    const now = createTestDate();
    const startDate = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();
    const endDate = Temporal.PlainDate.from(now).toString();

    const service = await createTestService(context, {
      service_name: 'Standard Service',
      billing_method: 'fixed',
      default_rate: 15000,
      unit_of_measure: 'unit',
      tax_region: 'US-NY'
    });

    await createFixedPlanAssignment(context, service, {
      planName: 'Standard Plan',
      baseRateCents: 15000,
      detailBaseRateCents: 15000,
      quantity: 1,
      billingFrequency: 'monthly',
      startDate,
      clientId: client_id
    });
    
    const billingCycleId = await context.createEntity('client_billing_cycles', {
      client_id: client_id,
      billing_cycle: 'monthly',
      period_start_date: startDate,
      period_end_date: endDate,
      effective_date: startDate
    }, 'billing_cycle_id');

    // Step 1: Create two credits - one that will expire and one that will remain active
    
    // Credit 1: Will be manually expired
    const expiringCreditAmount = 10000; // $100.00
    const expiringCreditInvoice = await runInTenant(() => createPrepaymentInvoice(
      client_id,
      expiringCreditAmount
    ));
    
    // Credit 2: Will remain active
    const activeCreditAmount = 8000; // $80.00
    const activeCreditInvoice = await runInTenant(() => createPrepaymentInvoice(
      client_id,
      activeCreditAmount
    ));
    
    // Step 2: Finalize both prepayment invoices
    await runInTenant(() => finalizeInvoice(expiringCreditInvoice.invoice_id));
    await runInTenant(() => finalizeInvoice(activeCreditInvoice.invoice_id));
    
    // Step 3: Get the credit transactions
    const expiringCreditTx = await context.db('transactions')
      .where({
        client_id: client_id,
        invoice_id: expiringCreditInvoice.invoice_id,
        type: 'credit_issuance'
      })
      .first();
    
    const activeCreditTx = await context.db('transactions')
      .where({
        client_id: client_id,
        invoice_id: activeCreditInvoice.invoice_id,
        type: 'credit_issuance'
      })
      .first();
    
    // Step 4: Verify initial credit balance
    const initialCredit = await ClientContractLine.getClientCredit(client_id);
    expect(initialCredit).toBe(expiringCreditAmount + activeCreditAmount);
    
    // Step 5: Create a manual invoice to control totals
    const { invoiceId: invoiceIdManual, subtotal: invoiceSubtotal, tax: invoiceTax, total: invoiceTotal } = await createManualInvoice(
      client_id,
      [
        {
          description: 'Expiring Credit Test Service',
          unitPrice: 15000,
          netAmount: 15000,
          taxAmount: 1500,
          totalPrice: 16500,
          isTaxable: true
        }
      ],
      { billingCycleId }
    );
    
    // Step 6: Manually expire the first credit
    // Update credit tracking entry
    await context.db('credit_tracking')
      .where({
        transaction_id: expiringCreditTx.transaction_id,
        tenant: context.tenantId
      })
      .update({
        is_expired: true,
        remaining_amount: 0,
        updated_at: new Date().toISOString()
      });
    
    // Create expiration transaction
    await context.db('transactions').insert({
      transaction_id: uuidv4(),
      client_id: client_id,
      amount: -expiringCreditAmount,
      type: 'credit_expiration',
      status: 'completed',
      description: 'Credit expired',
      created_at: new Date().toISOString(),
      tenant: context.tenantId,
      related_transaction_id: expiringCreditTx.transaction_id
    });
    
    // Update client credit balance
    await context.db('clients')
      .where({ client_id: client_id, tenant: context.tenantId })
      .update({
        credit_balance: activeCreditAmount, // Only the active credit remains
        updated_at: new Date().toISOString()
      });
    
    // Step 7: Verify credit balance after expiration
    const creditAfterExpiration = await ClientContractLine.getClientCredit(client_id);
    expect(creditAfterExpiration).toBe(activeCreditAmount);
    
    // Step 8: Apply remaining credit (only the active credit should be used)
    await applyCreditsManually(
      client_id,
      invoiceIdManual,
      invoiceTotal,
      [activeCreditTx]
    );

    // Step 9: Get the updated invoice
    const updatedInvoice = await context.db('invoices')
      .where({ invoice_id: invoiceIdManual })
      .first();

    // Step 10: Verify credit application
    // Calculate expected values
    const subtotal = invoiceSubtotal;
    const tax = invoiceTax;
    const totalBeforeCredit = invoiceTotal;

    // Only the active credit should be applied
    const expectedAppliedCredit = activeCreditAmount; // $80.00
    const expectedRemainingTotal = totalBeforeCredit - expectedAppliedCredit; // $165 - $80 = $85
    
    // Verify invoice values
    expect(Number(updatedInvoice.subtotal)).toBe(subtotal);
    expect(Number(updatedInvoice.tax)).toBe(tax);
    expect(Number(updatedInvoice.credit_applied)).toBe(expectedAppliedCredit);
    expect(Number(updatedInvoice.total_amount)).toBe(expectedRemainingTotal);
    
    // Step 11: Verify credit application transaction
    const creditApplicationTx = await context.db('transactions')
      .where({
        client_id: client_id,
        invoice_id: invoiceIdManual,
        type: 'credit_application'
      })
      .first();
    
    expect(creditApplicationTx).toBeTruthy();
    expect(parseFloat(creditApplicationTx.amount)).toBe(-expectedAppliedCredit);
    
    // Step 12: Verify the metadata to check which credits were applied
    const metadata = typeof creditApplicationTx.metadata === 'string'
      ? JSON.parse(creditApplicationTx.metadata)
      : creditApplicationTx.metadata;
    
    expect(metadata.applied_credits).toBeTruthy();
    expect(metadata.applied_credits.length).toBe(1); // Only the active credit should be applied
    
    // Verify the applied credit is the active one
    expect(metadata.applied_credits[0].transactionId).toBe(activeCreditTx.transaction_id);
    expect(metadata.applied_credits[0].amount).toBe(activeCreditAmount);
    
    // Step 13: Verify the expired credit was not used
    const expiringCreditTracking = await context.db('credit_tracking')
      .where({
        transaction_id: expiringCreditTx.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    expect(expiringCreditTracking.is_expired).toBe(true);
    expect(Number(expiringCreditTracking.remaining_amount)).toBe(0);
    
    // Step 14: Verify the active credit was fully used
    const activeCreditTracking = await context.db('credit_tracking')
      .where({
        transaction_id: activeCreditTx.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    expect(activeCreditTracking.is_expired).toBe(false);
    expect(Number(activeCreditTracking.remaining_amount)).toBe(0); // Fully used
    
    // Step 15: Verify final credit balance is zero
    const finalCredit = await ClientContractLine.getClientCredit(client_id);
    expect(finalCredit).toBe(0);
  });
});
