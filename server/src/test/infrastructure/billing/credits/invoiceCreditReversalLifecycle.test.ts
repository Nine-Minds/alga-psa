import { describe, it, expect, beforeAll, afterEach, beforeEach, afterAll, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { setupCommonMocks } from '../../../../../test-utils/testMocks';
import { tenantDb } from '@alga-psa/db';
import { TestContext } from '../../../../../test-utils/testContext';
import {
  createPrepaymentInvoice,
  applyCreditToInvoice,
} from '@alga-psa/billing/actions/creditActions';
import {
  finalizeInvoice,
  unfinalizeInvoice,
  hardDeleteInvoice,
} from '@alga-psa/billing/actions/invoiceModification';
import { voidInvoice } from '@alga-psa/billing/actions/voidInvoiceActions';
import { createInvoiceFromBillingResult } from '@alga-psa/billing/actions/invoiceGeneration';
import {
  createTestService,
  createFixedPlanAssignment,
  setupClientTaxConfiguration,
  assignServiceTaxRate,
} from '../../../../../test-utils/billingTestHelpers';
import type { IBillingCharge, IBillingResult } from 'server/src/interfaces/billing.interfaces';
import { v4 as uuidv4 } from 'uuid';
import { Temporal } from '@js-temporal/polyfill';
import { createTestDate } from '../../../test-utils/dateUtils';
import { createClient } from '../../../../../test-utils/testDataFactory';

let mockedTenantId = '11111111-1111-1111-1111-111111111111';
let mockedUserId = 'mock-user-id';

process.env.DB_PORT = process.env.DB_PORT === '6432' ? '5432' : process.env.DB_PORT;
process.env.DB_HOST = process.env.DB_HOST === 'pgbouncer' ? 'localhost' : process.env.DB_HOST;

vi.mock('server/src/lib/analytics/posthog', () => ({
  analytics: {
    capture: vi.fn(),
    identify: vi.fn(),
    trackPerformance: vi.fn(),
    getClient: () => null,
  },
}));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    withTransaction: vi.fn(async (knex, callback) => callback(knex)),
    withAdminTransaction: vi.fn(async (callback, existingConnection) => callback(existingConnection as any)),
  };
});

vi.mock('@alga-psa/core/logger', () => {
  const noop = vi.fn();
  const logger = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    child: vi.fn(() => logger),
  };
  return { default: logger };
});

vi.mock('@alga-psa/users/actions', () => ({
  getCurrentUser: vi.fn(() =>
    Promise.resolve({
      user_id: mockedUserId,
      tenant: mockedTenantId,
      username: 'mock-user',
      first_name: 'Mock',
      last_name: 'User',
      email: 'mock.user@example.com',
      user_type: 'internal',
      roles: [],
    })
  ),
}));

vi.mock('@alga-psa/auth', async () => {
  const { createAuthModuleMock } = await import('../../../../../test-utils/authModuleMock');
  return createAuthModuleMock();
});

vi.mock('server/src/lib/auth/rbac', () => ({
  hasPermission: vi.fn(() => Promise.resolve(true)),
}));

const {
  beforeAll: setupContext,
  beforeEach: resetContext,
  afterEach: rollbackContext,
  afterAll: cleanupContext,
} = TestContext.createHelpers();

let context: TestContext;

function tenantTable<Row extends object = Record<string, unknown>>(
  context: TestContext,
  tableExpression: string
) {
  return tenantDb(context.db, context.tenantId).table<Row>(tableExpression);
}

async function ensureClientBillingSettings(
  clientId: string,
  overrides: Record<string, unknown> = {}
) {
  await tenantTable(context, 'client_billing_settings')
    .where({ client_id: clientId, tenant: context.tenantId })
    .del();

  const now = new Date().toISOString();
  await tenantTable(context, 'client_billing_settings').insert({
    client_id: clientId,
    tenant: context.tenantId,
    zero_dollar_invoice_handling: 'normal',
    suppress_zero_dollar_invoices: false,
    enable_credit_expiration: false,
    created_at: now,
    updated_at: now,
    ...overrides,
  });
}

async function createBillingCycle(
  clientId: string,
  startDate: string,
  endDate: string
): Promise<string> {
  return context.createEntity(
    'client_billing_cycles',
    {
      client_id: clientId,
      billing_cycle: 'monthly',
      period_start_date: startDate,
      period_end_date: endDate,
      effective_date: startDate,
    },
    'billing_cycle_id'
  );
}

async function generateInvoiceFromChargesForClient(
  clientId: string,
  billingCycleId: string,
  charges: IBillingCharge[]
) {
  const cycleRecord = await tenantTable(context, 'client_billing_cycles')
    .where({ billing_cycle_id: billingCycleId, tenant: context.tenantId })
    .first();

  if (!cycleRecord) {
    throw new Error(`Billing cycle ${billingCycleId} not found`);
  }

  for (const charge of charges) {
    if (!(charge as { config_id?: string }).config_id) {
      (charge as { config_id?: string }).config_id = uuidv4();
    }
    const usageId = (charge as { usageId?: string }).usageId;
    if (charge.type === 'usage' && usageId) {
      await tenantTable(context, 'usage_tracking')
        .insert({
          tenant: context.tenantId,
          usage_id: usageId,
          service_id: (charge as { serviceId?: string }).serviceId,
          client_id: clientId,
          usage_date: (charge as { servicePeriodStart?: string }).servicePeriodStart ?? cycleRecord.period_start_date,
          quantity: (charge as { quantity?: number }).quantity ?? 1,
          invoiced: false,
        })
        .onConflict(['tenant', 'usage_id'])
        .ignore();
    }
  }

  const totalAmount = charges.reduce((sum, charge) => sum + Number(charge.total ?? 0), 0);

  const billingResult: IBillingResult = {
    tenant: context.tenantId,
    charges,
    discounts: [],
    adjustments: [],
    totalAmount,
    finalAmount: totalAmount,
  };

  const createdInvoice = await createInvoiceFromBillingResult(
    billingResult,
    clientId,
    cycleRecord.period_start_date ?? cycleRecord.effective_date,
    cycleRecord.period_end_date ?? cycleRecord.effective_date,
    billingCycleId,
    context.userId
  );

  return createdInvoice.invoice_id as string;
}

async function setupDefaultTax(clientId?: string) {
  await setupClientTaxConfiguration(context, {
    clientId,
    regionCode: 'US-NY',
    regionName: 'New York',
    description: 'NY State Tax',
    startDate: '2020-01-01T00:00:00.000Z',
    taxPercentage: 10.0,
  });
  await assignServiceTaxRate(context, '*', 'US-NY', { onlyUnset: true });
}

function makeCharge(
  serviceId: string,
  serviceName: string,
  total: number,
  periodStart: string,
  periodEnd: string
): IBillingCharge {
  return {
    tenant: context.tenantId,
    type: 'usage',
    serviceId,
    serviceName,
    quantity: 1,
    rate: total,
    total,
    tax_amount: 0,
    tax_rate: 0,
    tax_region: 'US-NY',
    is_taxable: false,
    usageId: uuidv4(),
    servicePeriodStart: periodStart,
    servicePeriodEnd: periodEnd,
    billingTiming: 'arrears',
  };
}

/** Full drawdown scaffold: client + service + billing cycle + one invoice. */
async function setupCreditedClientInvoice(options: {
  clientName: string;
  invoiceTotal: number;
  prepayments: number[];
  autoApply?: boolean;
}) {
  const clientId = await createClient(context.db, context.tenantId, options.clientName, {
    billing_cycle: 'monthly',
    region_code: 'US-NY',
    is_tax_exempt: false,
  });

  await setupDefaultTax(clientId);
  await ensureClientBillingSettings(clientId, {
    credit_auto_apply_enabled: options.autoApply ?? true,
  });

  const now = createTestDate();
  const periodStart = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();
  const periodEnd = Temporal.PlainDate.from(now).toString();

  const anchorServiceId = await createTestService(context, {
    service_name: 'Contract Line Anchor Service',
  });
  await createFixedPlanAssignment(context, anchorServiceId, {
    clientId,
    startDate: periodStart,
    planName: 'Credit Reversal Test Plan',
  });

  const serviceId = await createTestService(context, {
    service_name: 'Standard Service',
    billing_method: 'fixed',
    default_rate: options.invoiceTotal,
    tax_region: 'US-NY',
  });

  const billingCycleId = await createBillingCycle(clientId, periodStart, periodEnd);

  for (const amount of options.prepayments) {
    const prepaymentInvoice = await createPrepaymentInvoice(clientId, amount);
    await finalizeInvoice(prepaymentInvoice.invoice_id);
  }

  const invoiceId = await generateInvoiceFromChargesForClient(clientId, billingCycleId, [
    makeCharge(serviceId, 'Standard Service', options.invoiceTotal, periodStart, periodEnd),
  ]);

  return { clientId, invoiceId };
}

async function creditTrackingRows(clientId: string) {
  return tenantTable(context, 'credit_tracking')
    .where({ client_id: clientId, tenant: context.tenantId })
    .orderBy('created_at', 'asc')
    .select('credit_id', 'amount', 'remaining_amount');
}

async function invoiceRow(invoiceId: string) {
  return tenantTable(context, 'invoices')
    .where({ invoice_id: invoiceId, tenant: context.tenantId })
    .first();
}

async function transactionsOfType(invoiceId: string, type: string) {
  return tenantTable(context, 'transactions')
    .where({ invoice_id: invoiceId, type, tenant: context.tenantId })
    .orderBy('created_at', 'asc')
    .select('*');
}

describe('Unified invoice credit reversal (void / unfinalize / hard-delete)', () => {
  beforeAll(async () => {
    context = await setupContext({
      runSeeds: true,
      cleanupTables: [
        'invoice_charges',
        'invoices',
        'transactions',
        'credit_tracking',
        'credit_allocations',
        'client_billing_cycles',
        'client_contract_lines',
        'service_catalog',
        'service_types',
        'contract_lines',
        'tax_rates',
        'tax_regions',
        'client_tax_settings',
        'client_tax_rates',
        'client_billing_settings',
        'default_billing_settings',
      ],
      clientName: 'Credit Reversal Client',
      userType: 'internal',
    });

    const mockContext = setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      permissionCheck: () => true,
    });

    mockedTenantId = mockContext.tenantId;
    mockedUserId = mockContext.userId;
  }, 120000);

  beforeEach(async () => {
    context = await resetContext();

    const mockContext = setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      permissionCheck: () => true,
    });

    mockedTenantId = mockContext.tenantId;
    mockedUserId = mockContext.userId;
  }, 30000);

  afterEach(async () => {
    await rollbackContext();
  }, 30000);

  afterAll(async () => {
    await cleanupContext();
  }, 30000);

  it('unfinalize reverses applied credit: draft carries credit_applied = 0 and the pool is restored', async () => {
    const { clientId, invoiceId } = await setupCreditedClientInvoice({
      clientName: 'Unfinalize Reversal Client',
      invoiceTotal: 10000,
      prepayments: [5000],
    });

    await finalizeInvoice(invoiceId);

    const afterFinalize = await invoiceRow(invoiceId);
    expect(Number(afterFinalize.credit_applied)).toBe(5000);
    let credits = await creditTrackingRows(clientId);
    expect(Number(credits[0].remaining_amount)).toBe(0);

    const result = await unfinalizeInvoice(invoiceId);
    expect(result).toEqual({ success: true });

    const afterUnfinalize = await invoiceRow(invoiceId);
    expect(afterUnfinalize.status).toBe('draft');
    expect(afterUnfinalize.finalized_at).toBeNull();
    expect(Number(afterUnfinalize.credit_applied)).toBe(0);

    credits = await creditTrackingRows(clientId);
    expect(Number(credits[0].remaining_amount)).toBe(5000);

    // One linked, auditable reversal per application.
    const applications = await transactionsOfType(invoiceId, 'credit_application');
    expect(applications).toHaveLength(1);
    const adjustments = await transactionsOfType(invoiceId, 'credit_adjustment');
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0].metadata.reversal_of).toBe(applications[0].transaction_id);
    expect(adjustments[0].metadata.reason).toBe('invoice_unfinalized');

    // Historical ledger evidence survives the reversal.
    const allocations = await tenantTable(context, 'credit_allocations')
      .where({ invoice_id: invoiceId, tenant: context.tenantId })
      .select('allocation_id');
    expect(allocations).toHaveLength(1);
  });

  it('unfinalize → re-finalize → unfinalize cycle is repeat-safe: no application restores twice', async () => {
    const { clientId, invoiceId } = await setupCreditedClientInvoice({
      clientName: 'Cycle Repeat-Safe Client',
      invoiceTotal: 10000,
      prepayments: [5000],
    });

    await finalizeInvoice(invoiceId);
    expect(Number((await invoiceRow(invoiceId)).credit_applied)).toBe(5000);

    await unfinalizeInvoice(invoiceId);
    expect(Number((await creditTrackingRows(clientId))[0].remaining_amount)).toBe(5000);

    // Re-finalize: credit re-applies under the current policy (auto-apply on).
    await finalizeInvoice(invoiceId);
    const afterRefinalize = await invoiceRow(invoiceId);
    expect(Number(afterRefinalize.credit_applied)).toBe(5000);
    expect(Number((await creditTrackingRows(clientId))[0].remaining_amount)).toBe(0);

    await unfinalizeInvoice(invoiceId);

    // The first (already reversed) application must not restore again: the
    // pool ends exactly at its original amount, never above it.
    const credits = await creditTrackingRows(clientId);
    expect(Number(credits[0].remaining_amount)).toBe(5000);
    expect(Number(credits[0].remaining_amount)).toBeLessThanOrEqual(Number(credits[0].amount));
    expect(Number((await invoiceRow(invoiceId)).credit_applied)).toBe(0);

    // Two applications, each reversed exactly once.
    const applications = await transactionsOfType(invoiceId, 'credit_application');
    expect(applications).toHaveLength(2);
    const adjustments = await transactionsOfType(invoiceId, 'credit_adjustment');
    expect(adjustments).toHaveLength(2);
    const reversedIds = adjustments.map((adj: any) => adj.metadata.reversal_of).sort();
    expect(reversedIds).toEqual(applications.map((app: any) => app.transaction_id).sort());
  });

  it('hard delete restores every application across multiple credits without credit_tracking_usage', async () => {
    const { clientId, invoiceId } = await setupCreditedClientInvoice({
      clientName: 'Hard Delete Restore Client',
      invoiceTotal: 10000,
      prepayments: [3000, 4000],
      autoApply: false,
    });

    await finalizeInvoice(invoiceId);
    expect(Number((await invoiceRow(invoiceId)).credit_applied)).toBe(0);

    // Two separate manual applications → two application transactions; the
    // second draws across the remaining pool.
    await applyCreditToInvoice(clientId, invoiceId, 2000);
    await applyCreditToInvoice(clientId, invoiceId, 4000);
    expect(Number((await invoiceRow(invoiceId)).credit_applied)).toBe(6000);

    const applications = await transactionsOfType(invoiceId, 'credit_application');
    expect(applications).toHaveLength(2);
    const drainedCredits = await creditTrackingRows(clientId);
    const drainedTotal = drainedCredits.reduce((sum: number, row: any) => sum + Number(row.remaining_amount), 0);
    expect(drainedTotal).toBe(1000);

    // The invoice generator records canonical recurring detail periods for the
    // usage charges; a real hard-delete candidate (manual/non-recurring) has
    // none, and the recurring guard is out of scope here — neutralize it.
    await tenantTable(context, 'invoice_charge_details')
      .whereIn(
        'item_id',
        tenantTable(context, 'invoice_charges').select('item_id').where({ invoice_id: invoiceId, tenant: context.tenantId })
      )
      .update({ service_period_start: null, service_period_end: null });

    const result = await hardDeleteInvoice(invoiceId);
    expect(result).toEqual({ success: true });

    // Every application restored — full pool back.
    const restoredCredits = await creditTrackingRows(clientId);
    for (const row of restoredCredits) {
      expect(Number(row.remaining_amount)).toBe(Number(row.amount));
    }

    // Invoice and its ledger rows are gone.
    expect(await invoiceRow(invoiceId)).toBeUndefined();
    const remainingTxns = await tenantTable(context, 'transactions')
      .where({ invoice_id: invoiceId, tenant: context.tenantId })
      .select('transaction_id');
    expect(remainingTxns).toHaveLength(0);
    const allocations = await tenantTable(context, 'credit_allocations')
      .where({ invoice_id: invoiceId, tenant: context.tenantId })
      .select('allocation_id');
    expect(allocations).toHaveLength(0);
  });

  it('void reverses all applications and a repeated void cannot duplicate the restoration', async () => {
    const { clientId, invoiceId } = await setupCreditedClientInvoice({
      clientName: 'Void Regression Client',
      invoiceTotal: 10000,
      prepayments: [3000, 4000],
      autoApply: false,
    });

    await finalizeInvoice(invoiceId);
    await applyCreditToInvoice(clientId, invoiceId, 2000);
    await applyCreditToInvoice(clientId, invoiceId, 4000);
    expect(Number((await invoiceRow(invoiceId)).credit_applied)).toBe(6000);

    const voidResult = await voidInvoice(invoiceId, 'billing error');
    expect(voidResult).toEqual({ success: true });

    const afterVoid = await invoiceRow(invoiceId);
    expect(afterVoid.status).toBe('cancelled');
    expect(Number(afterVoid.credit_applied)).toBe(0);
    const restoredCredits = await creditTrackingRows(clientId);
    for (const row of restoredCredits) {
      expect(Number(row.remaining_amount)).toBe(Number(row.amount));
    }
    const adjustments = await transactionsOfType(invoiceId, 'credit_adjustment');
    expect(adjustments).toHaveLength(2);

    // Second invocation: blocked by the cancelled guard, nothing restored twice.
    const secondVoid = await voidInvoice(invoiceId, 'again');
    expect(secondVoid).toEqual({ success: false, error: 'Invoice is already voided.' });
    const creditsAfterSecond = await creditTrackingRows(clientId);
    for (const row of creditsAfterSecond) {
      expect(Number(row.remaining_amount)).toBe(Number(row.amount));
    }
    expect(await transactionsOfType(invoiceId, 'credit_adjustment')).toHaveLength(2);
  });

  it('malformed application provenance fails the unfinalize and leaves state untouched', async () => {
    const { clientId, invoiceId } = await setupCreditedClientInvoice({
      clientName: 'Malformed Provenance Client',
      invoiceTotal: 10000,
      prepayments: [5000],
    });

    await finalizeInvoice(invoiceId);
    const applications = await transactionsOfType(invoiceId, 'credit_application');
    expect(applications).toHaveLength(1);

    // Corrupt the provenance the reversal depends on.
    await tenantTable(context, 'transactions')
      .where({ transaction_id: applications[0].transaction_id, tenant: context.tenantId })
      .update({ metadata: JSON.stringify({}) });

    const result = await unfinalizeInvoice(invoiceId);
    expect(result).toEqual({ actionError: expect.any(String) });

    // Validation precedes mutation: lifecycle and balances unchanged.
    const invoice = await invoiceRow(invoiceId);
    expect(invoice.status).not.toBe('draft');
    expect(Number(invoice.credit_applied)).toBe(5000);
    expect(Number((await creditTrackingRows(clientId))[0].remaining_amount)).toBe(0);
    expect(await transactionsOfType(invoiceId, 'credit_adjustment')).toHaveLength(0);
  });
});
