import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import { TestContext } from '../../../../test-utils/testContext';

const helpers = TestContext.createHelpers();
const runtime = vi.hoisted(() => ({
  db: null as any,
  tenantId: '11111111-1111-1111-1111-111111111111',
  user: {
    user_id: '22222222-2222-2222-2222-222222222222',
    tenant: '11111111-1111-1111-1111-111111111111',
    username: 'recon-test-user',
    roles: [],
  } as any,
}));
const invoiceModelRef = vi.hoisted(() => ({
  getById: vi.fn(),
}));

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: runtime.db, tenant: runtime.tenantId })),
    getTenantContext: vi.fn(() => runtime.tenantId),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn()),
    withTransaction: vi.fn(async (_knex: unknown, fn: (trx: any) => Promise<any>) => fn(runtime.db)),
    auditLog: vi.fn(async () => undefined),
  };
});

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: (...args: any[]) => any) => async (...args: any[]) =>
    fn(runtime.user, { tenant: runtime.tenantId }, ...args),
  getCurrentUser: vi.fn(async () => runtime.user),
}));

vi.mock('@alga-psa/auth/getCurrentUser', () => ({
  getCurrentUser: vi.fn(async () => runtime.user),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

vi.mock('../../../../../packages/billing/src/models/invoice', () => ({
  default: {
    getById: invoiceModelRef.getById,
  },
}));

import {
  validateCreditBalanceWithoutCorrection,
  validateCreditTrackingEntries,
  validateCreditTrackingRemainingAmounts,
  runScheduledCreditBalanceValidation,
} from '../../../../../packages/billing/src/actions/creditReconciliationActions';
import {
  createMissingCreditTrackingEntry,
  updateCreditTrackingRemainingAmount,
  applyCustomCreditAdjustment,
  markReportAsResolvedNoAction,
} from '../../../../../packages/billing/src/actions/creditReconciliationFixActions';

describe('Credit reconciliation integration', () => {
  const HOOK_TIMEOUT = 240_000;
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await helpers.beforeAll({
      cleanupTables: [
        'credit_reconciliation_reports',
        'credit_tracking',
        'transactions',
        'invoice_charge_details',
        'invoice_charges',
        'invoices',
      ],
    });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await helpers.afterAll();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    ctx = await helpers.beforeEach();
    runtime.db = ctx.db;
    runtime.tenantId = ctx.tenantId;
    runtime.user = {
      user_id: ctx.userId,
      tenant: ctx.tenantId,
      username: 'recon-test-user',
      roles: [],
    };

    await ctx.db('credit_reconciliation_reports').where({ tenant: ctx.tenantId }).del();
    await ctx.db('credit_tracking').where({ tenant: ctx.tenantId }).del();
    await ctx.db('transactions').where({ tenant: ctx.tenantId }).del();
    await ctx.db('invoice_charge_details').where({ tenant: ctx.tenantId }).del();
    await ctx.db('invoice_charges').where({ tenant: ctx.tenantId }).del();
    await ctx.db('invoices').where({ tenant: ctx.tenantId }).del();
    // Start every test from a coherent state: no credit ledger entries and no balances.
    await ctx.db('clients').where({ tenant: ctx.tenantId }).update({ credit_balance: 0 });

    invoiceModelRef.getById.mockReset();
    invoiceModelRef.getById.mockImplementation(async (_trx: unknown, tenant: string, invoiceId: string) => {
      const invoice = await ctx.db('invoices')
        .where({ tenant, invoice_id: invoiceId })
        .first();

      if (!invoice) {
        return null;
      }

      const invoiceCharges = await ctx.db('invoice_charges')
        .where({ tenant, invoice_id: invoiceId })
        .orderBy('created_at', 'asc');

      const enrichedCharges = await Promise.all(
        invoiceCharges.map(async (charge) => {
          const detailRows = await ctx.db('invoice_charge_details')
            .where({ tenant, item_id: charge.item_id })
            .orderBy('created_at', 'asc');

          const servicePeriodStarts = detailRows
            .map((detail) => detail.service_period_start)
            .filter((value): value is string => typeof value === 'string' && value.length > 0)
            .sort();
          const servicePeriodEnds = detailRows
            .map((detail) => detail.service_period_end)
            .filter((value): value is string => typeof value === 'string' && value.length > 0)
            .sort();

          return {
            ...charge,
            service_period_start: servicePeriodStarts[0] ?? null,
            service_period_end: servicePeriodEnds[servicePeriodEnds.length - 1] ?? null,
            charge_details: detailRows,
          };
        })
      );

      return {
        ...invoice,
        invoice_charges: enrichedCharges,
      };
    });
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    vi.clearAllMocks();
    await helpers.afterEach();
  }, HOOK_TIMEOUT);

  it('T177: DB-backed sanity: credits and negative invoices still reconcile correctly after recurring service-period-first cutover', async () => {
    const negativeInvoiceId = uuidv4();
    const positiveInvoiceId = uuidv4();
    const negativeChargeId = uuidv4();
    const positiveChargeId = uuidv4();
    const negativeChargeDetailId = uuidv4();
    const positiveChargeDetailId = uuidv4();
    const creditTransactionId = uuidv4();
    const applicationTransactionId = uuidv4();
    const negativeConfigId = uuidv4();
    const positiveConfigId = uuidv4();
    const createdAt = '2025-02-15T12:00:00.000Z';
    const appliedAt = '2025-03-15T12:00:00.000Z';
    const seededService = await ctx.db('service_catalog')
      .where({ tenant: ctx.tenantId })
      .first<{ service_id: string }>('service_id');

    expect(seededService?.service_id).toBeTruthy();
    const serviceId = seededService!.service_id;

    await ctx.db('invoices').insert([
      {
        invoice_id: negativeInvoiceId,
        tenant: ctx.tenantId,
        client_id: ctx.clientId,
        invoice_number: 'INV-NEG-001',
        invoice_date: '2025-02-15',
        due_date: '2025-02-15',
        subtotal: -12500,
        tax: 0,
        total_amount: -12500,
        status: 'sent',
        currency_code: 'USD',
        is_manual: false,
        billing_period_start: '2025-01-01',
        billing_period_end: '2025-02-01',
        created_at: createdAt,
        updated_at: createdAt,
      },
      {
        invoice_id: positiveInvoiceId,
        tenant: ctx.tenantId,
        client_id: ctx.clientId,
        invoice_number: 'INV-POS-001',
        invoice_date: '2025-03-15',
        due_date: '2025-03-15',
        subtotal: 10000,
        tax: 1000,
        total_amount: 0,
        credit_applied: 11000,
        status: 'sent',
        currency_code: 'USD',
        is_manual: false,
        billing_period_start: '2025-02-01',
        billing_period_end: '2025-03-01',
        created_at: appliedAt,
        updated_at: appliedAt,
      },
    ]);

    await ctx.db('invoice_charges').insert([
      {
        item_id: negativeChargeId,
        tenant: ctx.tenantId,
        invoice_id: negativeInvoiceId,
        service_id: serviceId,
        description: 'Negative recurring service',
        quantity: 1,
        unit_price: -125,
        total_price: -125,
        net_amount: -125,
        tax_amount: 0,
        is_manual: false,
        created_at: createdAt,
        updated_at: createdAt,
      },
      {
        item_id: positiveChargeId,
        tenant: ctx.tenantId,
        invoice_id: positiveInvoiceId,
        service_id: serviceId,
        description: 'Positive recurring service',
        quantity: 1,
        unit_price: 100,
        total_price: 100,
        net_amount: 100,
        tax_amount: 10,
        is_manual: false,
        created_at: appliedAt,
        updated_at: appliedAt,
      },
    ]);

    await ctx.db('invoice_charge_details').insert([
      {
        item_detail_id: negativeChargeDetailId,
        item_id: negativeChargeId,
        tenant: ctx.tenantId,
        service_id: serviceId,
        config_id: negativeConfigId,
        quantity: 1,
        rate: -125,
        service_period_start: '2025-01-01',
        service_period_end: '2025-02-01',
        billing_timing: 'arrears',
        created_at: createdAt,
        updated_at: createdAt,
      },
      {
        item_detail_id: positiveChargeDetailId,
        item_id: positiveChargeId,
        tenant: ctx.tenantId,
        service_id: serviceId,
        config_id: positiveConfigId,
        quantity: 1,
        rate: 100,
        service_period_start: '2025-02-01',
        service_period_end: '2025-03-01',
        billing_timing: 'arrears',
        created_at: appliedAt,
        updated_at: appliedAt,
      },
    ]);

    await ctx.db('transactions').insert([
      {
        transaction_id: creditTransactionId,
        tenant: ctx.tenantId,
        client_id: ctx.clientId,
        invoice_id: negativeInvoiceId,
        amount: 12500,
        type: 'credit_issuance_from_negative_invoice',
        status: 'completed',
        description: 'Credit issued from negative invoice INV-NEG-001',
        created_at: createdAt,
      },
      {
        transaction_id: applicationTransactionId,
        tenant: ctx.tenantId,
        client_id: ctx.clientId,
        invoice_id: positiveInvoiceId,
        amount: -11000,
        type: 'credit_application',
        status: 'completed',
        description: 'Credit applied to invoice INV-POS-001',
        related_transaction_id: creditTransactionId,
        created_at: appliedAt,
      },
    ]);

    await ctx.db('credit_tracking').insert({
      credit_id: uuidv4(),
      tenant: ctx.tenantId,
      client_id: ctx.clientId,
      transaction_id: creditTransactionId,
      amount: 12500,
      remaining_amount: 1500,
      is_expired: false,
      expiration_date: null,
      created_at: createdAt,
      updated_at: appliedAt,
      currency_code: 'USD',
    });

    const result = await validateCreditTrackingRemainingAmounts(ctx.clientId, ctx.db as any);

    expect(result).toEqual({
      isValid: true,
      inconsistentEntries: 0,
      reportIds: [],
    });
    expect(invoiceModelRef.getById).toHaveBeenCalledWith(expect.anything(), ctx.tenantId, negativeInvoiceId);
    expect(invoiceModelRef.getById).toHaveBeenCalledWith(expect.anything(), ctx.tenantId, positiveInvoiceId);
  }, HOOK_TIMEOUT);

  // ---------------------------------------------------------------------------
  // Seed helpers (amounts are integer cents)
  // ---------------------------------------------------------------------------

  async function setClientBalance(clientId: string, balanceCents: number): Promise<void> {
    await ctx.db('clients')
      .where({ tenant: ctx.tenantId, client_id: clientId })
      .update({ credit_balance: balanceCents });
  }

  async function insertTransaction(overrides: Record<string, unknown>): Promise<string> {
    const transactionId = (overrides.transaction_id as string) ?? uuidv4();
    await ctx.db('transactions').insert({
      transaction_id: transactionId,
      tenant: ctx.tenantId,
      client_id: ctx.clientId,
      status: 'completed',
      created_at: '2025-04-01T00:00:00.000Z',
      ...overrides,
    });
    return transactionId;
  }

  async function insertCreditTracking(overrides: Record<string, unknown>): Promise<string> {
    const creditId = (overrides.credit_id as string) ?? uuidv4();
    await ctx.db('credit_tracking').insert({
      credit_id: creditId,
      tenant: ctx.tenantId,
      client_id: ctx.clientId,
      is_expired: false,
      expiration_date: null,
      created_at: '2025-04-01T00:00:00.000Z',
      updated_at: '2025-04-01T00:00:00.000Z',
      ...overrides,
    });
    return creditId;
  }

  /** Ledger says 10000, stored balance says 5000. Tracking is coherent. */
  async function seedBalanceDrift(clientId: string): Promise<{ issuanceId: string }> {
    const issuanceId = await insertTransaction({
      client_id: clientId,
      amount: 10000,
      type: 'credit_issuance',
      description: 'Prepayment credit',
    });
    await insertCreditTracking({
      client_id: clientId,
      transaction_id: issuanceId,
      amount: 10000,
      remaining_amount: 10000,
    });
    await setClientBalance(clientId, 5000);
    return { issuanceId };
  }

  /** Issuance transaction with no credit_tracking row. Balance coherent with ledger. */
  async function seedMissingTracking(clientId: string): Promise<{ issuanceId: string }> {
    const issuanceId = await insertTransaction({
      client_id: clientId,
      amount: 10000,
      type: 'credit_issuance',
      description: 'Prepayment credit without tracking',
    });
    await setClientBalance(clientId, 10000);
    return { issuanceId };
  }

  /** Tracking remaining_amount (8000) disagrees with issuance minus applications (5000). */
  async function seedInconsistentRemaining(clientId: string): Promise<{ issuanceId: string; creditId: string }> {
    const issuanceId = await insertTransaction({
      client_id: clientId,
      amount: 10000,
      type: 'credit_issuance',
      description: 'Prepayment credit',
      created_at: '2025-04-01T00:00:00.000Z',
    });
    await insertTransaction({
      client_id: clientId,
      amount: -5000,
      type: 'credit_application',
      description: 'Credit applied to invoice',
      related_transaction_id: issuanceId,
      created_at: '2025-04-02T00:00:00.000Z',
    });
    const creditId = await insertCreditTracking({
      client_id: clientId,
      transaction_id: issuanceId,
      amount: 10000,
      remaining_amount: 8000, // should be 5000
    });
    await setClientBalance(clientId, 5000); // ledger: 10000 - 5000 => balance check stays clean
    return { issuanceId, creditId };
  }

  /** Fully coherent credit state: issuance, application, tracking, balance all agree. */
  async function seedClean(clientId: string): Promise<void> {
    const issuanceId = await insertTransaction({
      client_id: clientId,
      amount: 10000,
      type: 'credit_issuance',
      description: 'Prepayment credit',
      created_at: '2025-04-01T00:00:00.000Z',
    });
    await insertTransaction({
      client_id: clientId,
      amount: -5000,
      type: 'credit_application',
      description: 'Credit applied to invoice',
      related_transaction_id: issuanceId,
      created_at: '2025-04-02T00:00:00.000Z',
    });
    await insertCreditTracking({
      client_id: clientId,
      transaction_id: issuanceId,
      amount: 10000,
      remaining_amount: 5000,
    });
    await setClientBalance(clientId, 5000);
  }

  function openReportsQuery(clientId: string) {
    return ctx.db('credit_reconciliation_reports')
      .where({ tenant: ctx.tenantId, client_id: clientId, status: 'open' });
  }

  function expectSuccess<T extends object>(result: T | { actionError?: string; permissionError?: string }): T {
    expect((result as any)?.actionError).toBeUndefined();
    expect((result as any)?.permissionError).toBeUndefined();
    return result as T;
  }

  // ---------------------------------------------------------------------------
  // Detection
  // ---------------------------------------------------------------------------

  describe('detection', () => {
    it('flags a client credit_balance that diverges from the transaction ledger', async () => {
      const { issuanceId } = await seedBalanceDrift(ctx.clientId);

      const result = await validateCreditBalanceWithoutCorrection(ctx.clientId);

      expect(result.isValid).toBe(false);
      expect(result.expectedBalance).toBe(10000);
      expect(result.actualBalance).toBe(5000);
      expect(result.difference).toBe(5000);
      expect(result.reportId).toBeTruthy();

      const report = await ctx.db('credit_reconciliation_reports')
        .where({ tenant: ctx.tenantId, report_id: result.reportId })
        .first();
      expect(report).toBeDefined();
      expect(report.status).toBe('open');
      expect(report.client_id).toBe(ctx.clientId);
      expect(Number(report.expected_balance)).toBe(10000);
      expect(Number(report.actual_balance)).toBe(5000);
      expect(Number(report.difference)).toBe(5000);
      expect(report.metadata.last_transaction_id).toBe(issuanceId);
      expect(report.metadata.last_transaction_type).toBe('credit_issuance');
    }, HOOK_TIMEOUT);

    // Detectors upsert into an existing open report for the same client/issue
    // instead of duplicating it on every re-run.
    it('does not duplicate an open balance-drift report on re-run', async () => {
      await seedBalanceDrift(ctx.clientId);

      await validateCreditBalanceWithoutCorrection(ctx.clientId);
      await validateCreditBalanceWithoutCorrection(ctx.clientId);

      const openReports = await openReportsQuery(ctx.clientId);
      expect(openReports.length).toBe(1);
    }, HOOK_TIMEOUT);

    it('flags a credit_issuance transaction that has no credit_tracking row', async () => {
      const { issuanceId } = await seedMissingTracking(ctx.clientId);

      const result = await validateCreditTrackingEntries(ctx.clientId);

      expect(result.isValid).toBe(false);
      expect(result.missingEntries).toBe(1);
      expect(result.reportIds).toHaveLength(1);

      const report = await ctx.db('credit_reconciliation_reports')
        .where({ tenant: ctx.tenantId, report_id: result.reportIds[0] })
        .first();
      expect(report.status).toBe('open');
      expect(report.client_id).toBe(ctx.clientId);
      expect(report.metadata.issue_type).toBe('missing_credit_tracking_entry');
      expect(report.metadata.transaction_id).toBe(issuanceId);
      expect(report.metadata.transaction_type).toBe('credit_issuance');
      expect(Number(report.metadata.transaction_amount)).toBe(10000);
    }, HOOK_TIMEOUT);

    it('does not duplicate an open missing-tracking report on re-run', async () => {
      await seedMissingTracking(ctx.clientId);

      await validateCreditTrackingEntries(ctx.clientId);
      await validateCreditTrackingEntries(ctx.clientId);

      const openReports = await openReportsQuery(ctx.clientId);
      expect(openReports.length).toBe(1);
    }, HOOK_TIMEOUT);

    it('flags a credit_tracking remaining_amount inconsistent with its applications', async () => {
      const { issuanceId, creditId } = await seedInconsistentRemaining(ctx.clientId);

      const result = await validateCreditTrackingRemainingAmounts(ctx.clientId);

      expect(result.isValid).toBe(false);
      expect(result.inconsistentEntries).toBe(1);
      expect(result.reportIds).toHaveLength(1);

      const report = await ctx.db('credit_reconciliation_reports')
        .where({ tenant: ctx.tenantId, report_id: result.reportIds[0] })
        .first();
      expect(report.status).toBe('open');
      expect(Number(report.expected_balance)).toBe(5000);
      expect(Number(report.actual_balance)).toBe(8000);
      expect(Number(report.difference)).toBe(-3000);
      expect(report.metadata.issue_type).toBe('inconsistent_credit_remaining_amount');
      expect(report.metadata.credit_id).toBe(creditId);
      expect(report.metadata.transaction_id).toBe(issuanceId);
      expect(report.metadata.applications).toHaveLength(1);
      expect(Number(report.metadata.applications[0].amount)).toBe(-5000);
    }, HOOK_TIMEOUT);

    it('does not duplicate an open inconsistent-remaining report on re-run', async () => {
      await seedInconsistentRemaining(ctx.clientId);

      await validateCreditTrackingRemainingAmounts(ctx.clientId);
      await validateCreditTrackingRemainingAmounts(ctx.clientId);

      const openReports = await openReportsQuery(ctx.clientId);
      expect(openReports.length).toBe(1);
    }, HOOK_TIMEOUT);

    it('creates no reports for a client with a single coherent credit', async () => {
      const issuanceId = await insertTransaction({
        amount: 10000,
        type: 'credit_issuance',
        description: 'Prepayment credit',
      });
      await insertCreditTracking({
        transaction_id: issuanceId,
        amount: 10000,
        remaining_amount: 10000,
      });
      await setClientBalance(ctx.clientId, 10000);

      const balanceResult = await validateCreditBalanceWithoutCorrection(ctx.clientId);
      const trackingResult = await validateCreditTrackingEntries(ctx.clientId);
      const remainingResult = await validateCreditTrackingRemainingAmounts(ctx.clientId);

      expect(balanceResult.isValid).toBe(true);
      expect(balanceResult.reportId).toBeUndefined();
      expect(trackingResult).toEqual({ isValid: true, missingEntries: 0, reportIds: [] });
      expect(remainingResult).toEqual({ isValid: true, inconsistentEntries: 0, reportIds: [] });

      const reports = await ctx.db('credit_reconciliation_reports')
        .where({ tenant: ctx.tenantId, client_id: ctx.clientId });
      expect(reports.length).toBe(0);
    }, HOOK_TIMEOUT);

    // Guards against the pg bigint-as-string concatenation regression in
    // validateCreditBalanceWithoutCorrection's ledger summation.
    it('creates no reports for a client with coherent multi-transaction credit data', async () => {
      await seedClean(ctx.clientId);

      const balanceResult = await validateCreditBalanceWithoutCorrection(ctx.clientId);
      const trackingResult = await validateCreditTrackingEntries(ctx.clientId);
      const remainingResult = await validateCreditTrackingRemainingAmounts(ctx.clientId);

      expect(balanceResult.isValid).toBe(true);
      expect(balanceResult.reportId).toBeUndefined();
      expect(trackingResult).toEqual({ isValid: true, missingEntries: 0, reportIds: [] });
      expect(remainingResult).toEqual({ isValid: true, inconsistentEntries: 0, reportIds: [] });

      const reports = await ctx.db('credit_reconciliation_reports')
        .where({ tenant: ctx.tenantId, client_id: ctx.clientId });
      expect(reports.length).toBe(0);
    }, HOOK_TIMEOUT);
  });

  // ---------------------------------------------------------------------------
  // Fix actions
  // ---------------------------------------------------------------------------

  describe('fix actions', () => {
    it('createMissingCreditTrackingEntry creates the tracking row and resolves the report', async () => {
      const { issuanceId } = await seedMissingTracking(ctx.clientId);
      const detection = await validateCreditTrackingEntries(ctx.clientId);
      const reportId = detection.reportIds[0];

      const resolved = expectSuccess(await createMissingCreditTrackingEntry(reportId, 'backfill tracking'));
      expect(resolved.status).toBe('resolved');
      expect(resolved.resolution_user).toBe(ctx.userId);
      expect(resolved.resolution_notes).toBe('backfill tracking');

      const tracking = await ctx.db('credit_tracking')
        .where({ tenant: ctx.tenantId, transaction_id: issuanceId })
        .first();
      expect(tracking).toBeDefined();
      expect(Number(tracking.amount)).toBe(10000);
      expect(Number(tracking.remaining_amount)).toBe(10000);

      const rerun = await validateCreditTrackingEntries(ctx.clientId);
      expect(rerun).toEqual({ isValid: true, missingEntries: 0, reportIds: [] });
    }, HOOK_TIMEOUT);

    it('updateCreditTrackingRemainingAmount corrects the tracking row and resolves the report', async () => {
      const { creditId } = await seedInconsistentRemaining(ctx.clientId);
      const detection = await validateCreditTrackingRemainingAmounts(ctx.clientId);
      const reportId = detection.reportIds[0];

      const resolved = expectSuccess(await updateCreditTrackingRemainingAmount(reportId, 'recompute remaining'));
      expect(resolved.status).toBe('resolved');
      expect(resolved.resolution_user).toBe(ctx.userId);

      const tracking = await ctx.db('credit_tracking')
        .where({ tenant: ctx.tenantId, credit_id: creditId })
        .first();
      expect(Number(tracking.remaining_amount)).toBe(5000);

      const rerun = await validateCreditTrackingRemainingAmounts(ctx.clientId);
      expect(rerun).toEqual({ isValid: true, inconsistentEntries: 0, reportIds: [] });
    }, HOOK_TIMEOUT);

    it('applyCustomCreditAdjustment writes the adjustment transaction, updates the balance, and resolves the report', async () => {
      await seedBalanceDrift(ctx.clientId);
      const detection = await validateCreditBalanceWithoutCorrection(ctx.clientId);
      const reportId = detection.reportId!;

      const resolved = expectSuccess(await applyCustomCreditAdjustment(reportId, 'apply the ledger difference'));
      expect(resolved.status).toBe('resolved');
      expect(resolved.resolution_transaction_id).toBeTruthy();

      const adjustment = await ctx.db('transactions')
        .where({ tenant: ctx.tenantId, transaction_id: resolved.resolution_transaction_id })
        .first();
      expect(adjustment).toBeDefined();
      expect(adjustment.type).toBe('credit_adjustment');
      expect(Number(adjustment.amount)).toBe(5000);
      expect(adjustment.client_id).toBe(ctx.clientId);
    }, HOOK_TIMEOUT);

    // Guards against report.difference (pg bigint string) concatenating with
    // the numeric balance instead of adding.
    it('applyCustomCreditAdjustment sets the client balance to the expected balance', async () => {
      await seedBalanceDrift(ctx.clientId);
      const detection = await validateCreditBalanceWithoutCorrection(ctx.clientId);
      expectSuccess(await applyCustomCreditAdjustment(detection.reportId!, 'apply the ledger difference'));

      const client = await ctx.db('clients')
        .where({ tenant: ctx.tenantId, client_id: ctx.clientId })
        .first();
      expect(Number(client.credit_balance)).toBe(10000);
    }, HOOK_TIMEOUT);

    // Balance corrections write an audit-marker credit_adjustment (flagged
    // reconciliation_balance_correction) that the detector excludes from the
    // ledger sum, so a resolved fix stays resolved on re-run.
    it('a resolved balance-drift fix leaves nothing for the detector to find on re-run', async () => {
      await seedBalanceDrift(ctx.clientId);
      const detection = await validateCreditBalanceWithoutCorrection(ctx.clientId);
      expectSuccess(await applyCustomCreditAdjustment(detection.reportId!, 'apply the ledger difference'));

      const rerun = await validateCreditBalanceWithoutCorrection(ctx.clientId);
      expect(rerun.isValid).toBe(true);
      expect(rerun.reportId).toBeUndefined();
    }, HOOK_TIMEOUT);

    it('markReportAsResolvedNoAction resolves the report without mutating credit data', async () => {
      await seedBalanceDrift(ctx.clientId);
      const detection = await validateCreditBalanceWithoutCorrection(ctx.clientId);
      const reportId = detection.reportId!;
      const transactionCountBefore = await ctx.db('transactions')
        .where({ tenant: ctx.tenantId, client_id: ctx.clientId })
        .count('transaction_id as count')
        .first();

      const resolved = expectSuccess(await markReportAsResolvedNoAction(reportId, 'accepted as-is'));
      expect(resolved.status).toBe('resolved');
      expect(resolved.resolution_transaction_id).toBeNull();
      expect(resolved.resolution_notes).toBe('accepted as-is');
      expect(resolved.resolution_user).toBe(ctx.userId);

      const transactionCountAfter = await ctx.db('transactions')
        .where({ tenant: ctx.tenantId, client_id: ctx.clientId })
        .count('transaction_id as count')
        .first();
      expect(Number(transactionCountAfter?.count)).toBe(Number(transactionCountBefore?.count));

      const client = await ctx.db('clients')
        .where({ tenant: ctx.tenantId, client_id: ctx.clientId })
        .first();
      expect(Number(client.credit_balance)).toBe(5000);

      const openReports = await openReportsQuery(ctx.clientId);
      expect(openReports.length).toBe(0);
    }, HOOK_TIMEOUT);
  });

  // ---------------------------------------------------------------------------
  // Scheduled validation
  // ---------------------------------------------------------------------------

  describe('runScheduledCreditBalanceValidation', () => {
    it('returns correct counts over a tenant with mixed clean and dirty clients (single-transaction ledgers)', async () => {
      const { createClient } = await import('../../../../test-utils/testDataFactory');

      // ctx client: balance drift (single issuance, wrong stored balance)
      await seedBalanceDrift(ctx.clientId);

      // second client: issuance without a credit_tracking row, balance coherent
      const missingTrackingClient = await createClient(ctx.db, ctx.tenantId, `Missing Tracking ${uuidv4().slice(0, 6)}`);
      await seedMissingTracking(missingTrackingClient);

      // third client: fully coherent single credit
      const cleanClient = await createClient(ctx.db, ctx.tenantId, `Clean ${uuidv4().slice(0, 6)}`);
      const cleanIssuanceId = await insertTransaction({
        client_id: cleanClient,
        amount: 10000,
        type: 'credit_issuance',
        description: 'Prepayment credit',
      });
      await insertCreditTracking({
        client_id: cleanClient,
        transaction_id: cleanIssuanceId,
        amount: 10000,
        remaining_amount: 10000,
      });
      await setClientBalance(cleanClient, 10000);

      const totalClientRow = await ctx.db('clients')
        .where({ tenant: ctx.tenantId })
        .count('client_id as count')
        .first();
      const totalClients = Number(totalClientRow?.count);

      const summary = await runScheduledCreditBalanceValidation(undefined, ctx.userId);

      expect(summary.totalClients).toBe(totalClients);
      expect(summary.balanceDiscrepancyCount).toBe(1);
      expect(summary.balanceValidCount).toBe(totalClients - 1);
      expect(summary.missingTrackingCount).toBe(1);
      expect(summary.inconsistentTrackingCount).toBe(0);
      expect(summary.errorCount).toBe(0);
    }, HOOK_TIMEOUT);

    it('returns correct counts over a tenant with mixed clean and dirty clients', async () => {
      const { createClient } = await import('../../../../test-utils/testDataFactory');

      const dirtyBalanceClient = ctx.clientId;
      await seedBalanceDrift(dirtyBalanceClient);

      const missingTrackingClient = await createClient(ctx.db, ctx.tenantId, `Missing Tracking ${uuidv4().slice(0, 6)}`);
      await seedMissingTracking(missingTrackingClient);

      const inconsistentClient = await createClient(ctx.db, ctx.tenantId, `Inconsistent ${uuidv4().slice(0, 6)}`);
      await seedInconsistentRemaining(inconsistentClient);

      const cleanClient = await createClient(ctx.db, ctx.tenantId, `Clean ${uuidv4().slice(0, 6)}`);
      await seedClean(cleanClient);

      const totalClientRow = await ctx.db('clients')
        .where({ tenant: ctx.tenantId })
        .count('client_id as count')
        .first();
      const totalClients = Number(totalClientRow?.count);

      const summary = await runScheduledCreditBalanceValidation(undefined, ctx.userId);

      expect(summary.totalClients).toBe(totalClients);
      expect(summary.balanceDiscrepancyCount).toBe(1);
      expect(summary.balanceValidCount).toBe(totalClients - 1);
      expect(summary.missingTrackingCount).toBe(1);
      expect(summary.inconsistentTrackingCount).toBe(1);
      expect(summary.errorCount).toBe(0);
    }, HOOK_TIMEOUT);
  });
});
