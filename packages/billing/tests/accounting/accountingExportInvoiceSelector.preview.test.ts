/**
 * Unit tests for AccountingExportInvoiceSelector (packages/billing/src/services/accountingExportInvoiceSelector.ts).
 *
 * Exercises the pure row-to-preview-line mapping (cents handling, credit/zero
 * detection, service-period aggregation, date normalization) and the selection
 * filter construction (status expansion, pending-external draft inclusion,
 * already-synced exclusion) against a recording fake knex. No database.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => {
    throw new Error('not used in these tests');
  }),
}));

// accountingExportService transitively imports '@alga-psa/integrations/runtime'
// (email adapters etc.) which cannot load in a pure unit-test environment.
// Only createBatchFromFilters touches it, and that path is exercised solely
// for its pure pre-validation here.
vi.mock('../../src/services/accountingExportService', () => ({
  AccountingExportService: {
    createForTenant: vi.fn(async () => {
      throw new Error('not used in these tests');
    }),
  },
}));

import { AccountingExportInvoiceSelector } from '../../src/services/accountingExportInvoiceSelector';
import { AppError } from '@alga-psa/core';

type Op = { method: string; args: any[] };

/**
 * Recording fake knex: every chained call (including calls made inside
 * where-callbacks) is recorded per top-level table invocation; awaiting the
 * builder resolves the configured rows for that table.
 */
function createFakeKnex(rowsByTable: Record<string, any[]>) {
  const invocations: Array<{ table: string; ops: Op[] }> = [];

  const knex: any = (table: string) => {
    const invocation = { table, ops: [] as Op[] };
    invocations.push(invocation);

    const builder: any = {};
    const chainMethods = [
      'join',
      'leftJoin',
      'on',
      'andOn',
      'select',
      'where',
      'andWhere',
      'andWhereRaw',
      'orWhere',
      'whereIn',
      'whereNull',
      'whereNotNull',
      'whereNotExists',
      'orWhereNull',
      'from',
      'orderBy',
      'orderByRaw',
    ];
    for (const method of chainMethods) {
      builder[method] = (...args: any[]) => {
        invocation.ops.push({ method, args });
        for (const arg of args) {
          if (typeof arg === 'function') {
            arg.call(builder, builder);
          }
        }
        return builder;
      };
    }
    builder.then = (onFulfilled: any, onRejected: any) =>
      Promise.resolve(rowsByTable[table] ?? []).then(onFulfilled, onRejected);
    return builder;
  };
  knex.raw = (sql: string, bindings?: any[]) => ({ sql, bindings });
  knex.__invocations = invocations;
  return knex;
}

function findOps(knex: any, table: string): Op[] {
  return knex.__invocations
    .filter((inv: any) => inv.table === table)
    .flatMap((inv: any) => inv.ops);
}

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    invoice_id: 'inv-1',
    invoice_number: 'INV-0001',
    invoice_date: '2025-02-01T00:00:00.000Z',
    invoice_status: 'sent',
    tax_source: 'internal',
    client_id: 'client-1',
    client_name: 'Acme Co',
    currency_code: 'EUR',
    invoice_is_manual: false,
    total_amount: 10000,
    item_id: 'charge-1',
    total_price: 10000,
    charge_is_manual: false,
    detail_service_period_start: null,
    detail_service_period_end: null,
    detail_billing_timing: null,
    ...overrides,
  };
}

function makeSelector(rowsByTable: Record<string, any[]>) {
  const knex = createFakeKnex(rowsByTable);
  const selector = new AccountingExportInvoiceSelector(knex as any, 'tenant-1');
  return { knex, selector };
}

describe('AccountingExportInvoiceSelector.previewInvoiceLines', () => {
  it('maps amounts, currency and flags for an ordinary charge', async () => {
    const { selector } = makeSelector({
      'invoices as inv': [makeRow()],
      transactions: [{ invoice_id: 'inv-1', transaction_id: 'txn-1' }],
    });

    const lines = await selector.previewInvoiceLines({});

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      invoiceId: 'inv-1',
      invoiceNumber: 'INV-0001',
      chargeId: 'charge-1',
      amountCents: 10000,
      currencyCode: 'EUR',
      isCredit: false,
      isZeroAmount: false,
      isManualInvoice: false,
      isManualCharge: false,
      servicePeriodSource: 'financial_document_fallback',
      servicePeriodStart: null,
      servicePeriodEnd: null,
      transactionIds: ['txn-1'],
    });
  });

  it('rounds numeric-string amounts from pg to integer cents and defaults missing currency to USD', async () => {
    const { selector } = makeSelector({
      'invoices as inv': [
        makeRow({ total_price: '1050.4', total_amount: '1050.4', currency_code: null }),
      ],
    });

    const [line] = await selector.previewInvoiceLines({});

    expect(line.amountCents).toBe(1050);
    expect(line.currencyCode).toBe('USD');
  });

  it('treats unparseable or missing amounts as zero cents', async () => {
    const { selector } = makeSelector({
      'invoices as inv': [makeRow({ total_price: 'garbage', total_amount: null })],
    });

    const [line] = await selector.previewInvoiceLines({});

    expect(line.amountCents).toBe(0);
    expect(line.isZeroAmount).toBe(true);
  });

  it('marks credits when either the charge or the invoice total is negative', async () => {
    const { selector } = makeSelector({
      'invoices as inv': [
        makeRow({ item_id: 'charge-neg', total_price: -2500, total_amount: 10000 }),
        makeRow({ item_id: 'charge-pos', total_price: 2500, total_amount: -10000 }),
      ],
    });

    const lines = await selector.previewInvoiceLines({});

    expect(lines.map((l) => [l.chargeId, l.isCredit])).toEqual([
      ['charge-neg', true],
      ['charge-pos', true],
    ]);
  });

  it('aggregates multi-period charge details: sorted, deduplicated, first-start/last-end summary', async () => {
    const { selector } = makeSelector({
      'invoices as inv': [
        // Deliberately out of order + one duplicate detail row.
        makeRow({
          detail_service_period_start: '2025-02-01',
          detail_service_period_end: '2025-03-01',
          detail_billing_timing: 'arrears',
        }),
        makeRow({
          detail_service_period_start: '2025-01-01',
          detail_service_period_end: '2025-02-01',
          detail_billing_timing: 'arrears',
        }),
        makeRow({
          detail_service_period_start: '2025-02-01',
          detail_service_period_end: '2025-03-01',
          detail_billing_timing: 'arrears',
        }),
      ],
    });

    const lines = await selector.previewInvoiceLines({});

    expect(lines).toHaveLength(1);
    const [line] = lines;
    expect(line.recurringDetailPeriods).toEqual([
      {
        service_period_start: '2025-01-01T00:00:00.000Z',
        service_period_end: '2025-02-01T00:00:00.000Z',
        billing_timing: 'arrears',
      },
      {
        service_period_start: '2025-02-01T00:00:00.000Z',
        service_period_end: '2025-03-01T00:00:00.000Z',
        billing_timing: 'arrears',
      },
    ]);
    expect(line.servicePeriodStart).toBe('2025-01-01T00:00:00.000Z');
    expect(line.servicePeriodEnd).toBe('2025-03-01T00:00:00.000Z');
    expect(line.servicePeriodSource).toBe('canonical_detail_periods');
    expect(line.isMultiPeriod).toBe(true);
  });

  it('normalizes date-only strings and local-midnight Date objects to UTC-midnight ISO strings', async () => {
    const { selector } = makeSelector({
      'invoices as inv': [
        makeRow({
          // Local-midnight Date: must keep the calendar day, not shift by timezone.
          detail_service_period_start: new Date(2025, 0, 1),
          detail_service_period_end: '2025-02-01',
          detail_billing_timing: 'advance',
        }),
      ],
    });

    const [line] = await selector.previewInvoiceLines({});

    expect(line.recurringDetailPeriods).toEqual([
      {
        service_period_start: '2025-01-01T00:00:00.000Z',
        service_period_end: '2025-02-01T00:00:00.000Z',
        billing_timing: 'advance',
      },
    ]);
  });

  it('groups transaction ids per invoice', async () => {
    const { selector } = makeSelector({
      'invoices as inv': [
        makeRow({ invoice_id: 'inv-1', item_id: 'charge-1' }),
        makeRow({ invoice_id: 'inv-2', item_id: 'charge-2', invoice_number: 'INV-0002' }),
      ],
      transactions: [
        { invoice_id: 'inv-1', transaction_id: 'txn-a' },
        { invoice_id: 'inv-1', transaction_id: 'txn-b' },
      ],
    });

    const lines = await selector.previewInvoiceLines({});

    expect(lines.find((l) => l.invoiceId === 'inv-1')?.transactionIds).toEqual(['txn-a', 'txn-b']);
    expect(lines.find((l) => l.invoiceId === 'inv-2')?.transactionIds).toEqual([]);
  });

  describe('selection filters', () => {
    it('expands canonical status keys to include legacy Title Case statuses', async () => {
      const { knex, selector } = makeSelector({ 'invoices as inv': [] });

      await selector.previewInvoiceLines({ invoiceStatuses: ['sent', 'paid'] });

      const whereInOp = findOps(knex, 'invoices as inv').find(
        (op) => op.method === 'whereIn' && op.args[0] === 'inv.status'
      );
      expect(whereInOp).toBeDefined();
      const statuses = whereInOp!.args[1] as string[];
      expect(statuses).toEqual(expect.arrayContaining(['sent', 'paid', 'Unpaid', 'Paid']));
    });

    it('includes pending-external draft invoices for tax-delegating adapters when drafts are not requested', async () => {
      const { knex, selector } = makeSelector({ 'invoices as inv': [] });

      await selector.previewInvoiceLines({ adapterType: 'xero', invoiceStatuses: ['sent'] });

      const ops = findOps(knex, 'invoices as inv');
      expect(ops).toContainEqual({ method: 'where', args: ['inv.status', 'draft'] });
      expect(ops).toContainEqual({ method: 'andWhere', args: ['inv.tax_source', 'pending_external'] });
    });

    it('does not add the pending-external branch when drafts are explicitly selected', async () => {
      const { knex, selector } = makeSelector({ 'invoices as inv': [] });

      await selector.previewInvoiceLines({ adapterType: 'xero', invoiceStatuses: ['draft'] });

      const ops = findOps(knex, 'invoices as inv');
      expect(ops).not.toContainEqual({ method: 'andWhere', args: ['inv.tax_source', 'pending_external'] });
    });

    it('does not add the pending-external branch for adapters without tax delegation', async () => {
      const { knex, selector } = makeSelector({ 'invoices as inv': [] });

      await selector.previewInvoiceLines({ adapterType: 'custom_csv', invoiceStatuses: ['sent'] });

      const ops = findOps(knex, 'invoices as inv');
      expect(ops).not.toContainEqual({ method: 'andWhere', args: ['inv.tax_source', 'pending_external'] });
    });

    it('excludes already-synced invoices only when an adapter type is provided', async () => {
      const synced = makeSelector({ 'invoices as inv': [] });
      await synced.selector.previewInvoiceLines({ adapterType: 'quickbooks_online' });
      expect(
        findOps(synced.knex, 'invoices as inv').some((op) => op.method === 'whereNotExists')
      ).toBe(true);

      const unsynced = makeSelector({ 'invoices as inv': [] });
      await unsynced.selector.previewInvoiceLines({});
      expect(
        findOps(unsynced.knex, 'invoices as inv').some((op) => op.method === 'whereNotExists')
      ).toBe(false);
    });
  });
});

describe('AccountingExportInvoiceSelector.createBatchFromFilters', () => {
  it('raises ACCOUNTING_EXPORT_EMPTY_BATCH when no invoices match the filters', async () => {
    const { selector } = makeSelector({ 'invoices as inv': [] });

    await expect(
      selector.createBatchFromFilters({
        adapterType: 'quickbooks_online',
        targetRealm: 'realm-1',
        filters: { invoiceStatuses: ['sent'] },
      })
    ).rejects.toMatchObject({
      constructor: AppError,
      code: 'ACCOUNTING_EXPORT_EMPTY_BATCH',
    });
  });
});
