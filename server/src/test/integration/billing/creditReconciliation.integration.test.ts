import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import { TestContext } from '../../../../test-utils/testContext';

const helpers = TestContext.createHelpers();
const runtime = vi.hoisted(() => ({
  db: null as any,
  tenantId: '11111111-1111-1111-1111-111111111111',
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
  withAuth: (fn: (...args: any[]) => any) => fn,
}));

vi.mock('../../../../../packages/billing/src/models/invoice', () => ({
  default: {
    getById: invoiceModelRef.getById,
  },
}));

import { validateCreditTrackingRemainingAmounts } from '../../../../../packages/billing/src/actions/creditReconciliationActions';

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

    await ctx.db('credit_reconciliation_reports').where({ tenant: ctx.tenantId }).del();
    await ctx.db('credit_tracking').where({ tenant: ctx.tenantId }).del();
    await ctx.db('transactions').where({ tenant: ctx.tenantId }).del();
    await ctx.db('invoice_charge_details').where({ tenant: ctx.tenantId }).del();
    await ctx.db('invoice_charges').where({ tenant: ctx.tenantId }).del();
    await ctx.db('invoices').where({ tenant: ctx.tenantId }).del();

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
});
