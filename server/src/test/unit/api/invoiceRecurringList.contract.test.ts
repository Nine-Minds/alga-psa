import { describe, expect, it } from 'vitest';

import {
  invoiceFilterSchema,
  invoiceListResponseSchema,
  singleInvoiceResponseSchema,
} from '../../../lib/api/schemas/invoiceSchemas';
import { InvoiceService } from '../../../lib/api/services/InvoiceService';

function createFilterRecorder() {
  const operations: Array<{ type: string; args?: unknown[]; nested?: Array<{ type: string; args?: unknown[] }> }> = [];

  const builder: any = {};
  builder.where = (arg1: unknown, arg2?: unknown, arg3?: unknown) => {
    if (typeof arg1 === 'function') {
      const nestedOps: Array<{ type: string; args?: unknown[] }> = [];
      const nestedBuilder = {
        where: (column: unknown, value?: unknown) => {
          nestedOps.push({ type: 'where', args: [column, value] });
          return nestedBuilder;
        },
        orWhereNotNull: (column: unknown) => {
          nestedOps.push({ type: 'orWhereNotNull', args: [column] });
          return nestedBuilder;
        },
      };
      (arg1 as (this: typeof nestedBuilder) => void).call(nestedBuilder);
      operations.push({ type: 'whereGroup', nested: nestedOps });
      return builder;
    }

    operations.push({ type: 'where', args: [arg1, arg2, arg3] });
    return builder;
  };
  builder.whereNotNull = (column: unknown) => {
    operations.push({ type: 'whereNotNull', args: [column] });
    return builder;
  };
  builder.whereNull = (column: unknown) => {
    operations.push({ type: 'whereNull', args: [column] });
    return builder;
  };
  builder.whereIn = (column: unknown, value: unknown) => {
    operations.push({ type: 'whereIn', args: [column, value] });
    return builder;
  };
  builder.whereILike = (column: unknown, value: unknown) => {
    operations.push({ type: 'whereILike', args: [column, value] });
    return builder;
  };

  return { builder, operations };
}

describe('invoice recurring list contract', () => {
  it('T040/T041: invoice list and single-item response contracts keep recurring bridge metadata optional while accepting canonical execution metadata', () => {
    const contractRecurringInvoice = {
      invoice_id: '11111111-1111-4111-8111-111111111111',
      client_id: '22222222-2222-4222-8222-222222222222',
      invoice_date: '2026-03-18',
      due_date: '2026-04-17',
      subtotal: 1200,
      tax: 0,
      total_amount: 1200,
      status: 'draft',
      invoice_number: 'INV-3001',
      credit_applied: 0,
      billing_cycle_id: null,
      is_manual: false,
      is_prepayment: false,
      recurring_execution_window_kind: 'contract_cadence_window',
      recurring_cadence_source: 'contract_anniversary',
      recurring_service_period_start: '2025-02-08T00:00:00.000Z',
      recurring_service_period_end: '2025-03-08T00:00:00.000Z',
      recurring_invoice_window_start: '2025-02-08T00:00:00.000Z',
      recurring_invoice_window_end: '2025-03-08T00:00:00.000Z',
      created_at: '2026-03-18T00:00:00.000Z',
      updated_at: '2026-03-18T00:00:00.000Z',
      tenant: '33333333-3333-4333-8333-333333333333',
    };
    const bridgeFreeRecurringInvoice = { ...contractRecurringInvoice };
    delete (bridgeFreeRecurringInvoice as any).billing_cycle_id;
    const clientRecurringInvoice = {
      ...contractRecurringInvoice,
      invoice_id: '44444444-4444-4444-8444-444444444444',
      billing_cycle_id: '55555555-5555-4555-8555-555555555555',
      recurring_execution_window_kind: 'client_cadence_window',
      recurring_cadence_source: 'client_schedule',
    };

    const listParsed = invoiceListResponseSchema.safeParse({
      data: [bridgeFreeRecurringInvoice, clientRecurringInvoice],
      pagination: {
        page: 1,
        limit: 25,
        total: 2,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      },
    });
    const singleParsed = singleInvoiceResponseSchema.safeParse({
      data: clientRecurringInvoice,
    });

    expect(listParsed.success).toBe(true);
    expect(singleParsed.success).toBe(true);
  });

  it('T092: invoice list and detail readers still project recurring service-period summary fields after the service-driven cutover (separate tenant query, merged in JS)', async () => {
    const summaryRows = [
      {
        tenant: 'tenant-1',
        invoice_id: 'inv-contract',
        recurring_service_period_start: '2025-02-08',
        recurring_service_period_end: '2025-03-08',
        recurring_invoice_window_start: '2025-02-08',
        recurring_invoice_window_end: '2025-03-08',
        recurring_cadence_owner: 'contract',
      },
      {
        tenant: 'tenant-1',
        invoice_id: 'inv-client',
        recurring_service_period_start: '2025-03-01',
        recurring_service_period_end: '2025-04-01',
        recurring_invoice_window_start: '2025-03-01',
        recurring_invoice_window_end: '2025-04-01',
        recurring_cadence_owner: 'client',
      },
      {
        tenant: 'tenant-1',
        invoice_id: 'inv-other',
        recurring_service_period_start: '2025-05-01',
        recurring_service_period_end: '2025-06-01',
        recurring_invoice_window_start: '2025-05-01',
        recurring_invoice_window_end: '2025-06-01',
        recurring_cadence_owner: 'something-else',
      },
    ];
    const whereInArgs: unknown[][] = [];
    const summaryBuilder: any = {
      where: () => summaryBuilder,
      whereNotNull: () => summaryBuilder,
      whereIn: (...args: unknown[]) => { whereInArgs.push(args); return summaryBuilder; },
      select: () => summaryBuilder,
      min: () => summaryBuilder,
      max: () => summaryBuilder,
      groupBy: () => summaryBuilder,
      then: (resolve: (rows: unknown[]) => unknown) => resolve(summaryRows),
    };
    const tables: string[] = [];
    const trx: any = (tableName: string) => {
      tables.push(tableName);
      return summaryBuilder;
    };

    const service = new InvoiceService();
    const merged = await (service as any).mergeRecurringSummary(trx, { tenant: 'tenant-1', userId: 'user-1' }, [
      { invoice_id: 'inv-contract', total_amount: 1 },
      { invoice_id: 'inv-client', total_amount: 2 },
      { invoice_id: 'inv-other', total_amount: 3 },
      { invoice_id: 'inv-none', total_amount: 4 },
    ]);

    expect(tables).toEqual(['recurring_service_periods as rsp']);
    expect(whereInArgs[0]?.[0]).toBe('rsp.invoice_id');
    expect(whereInArgs[0]?.[1]).toEqual(['inv-contract', 'inv-client', 'inv-other', 'inv-none']);

    expect(merged[0]).toMatchObject({
      total_amount: 1,
      recurring_service_period_start: '2025-02-08',
      recurring_service_period_end: '2025-03-08',
      recurring_invoice_window_start: '2025-02-08',
      recurring_invoice_window_end: '2025-03-08',
      recurring_execution_window_kind: 'contract_cadence_window',
      recurring_cadence_source: 'contract_anniversary',
    });
    expect(merged[1]).toMatchObject({
      recurring_execution_window_kind: 'client_cadence_window',
      recurring_cadence_source: 'client_schedule',
    });
    // Unknown owner: dates kept, kind/source null (old CASE ... ELSE NULL).
    expect(merged[2]).toMatchObject({
      recurring_service_period_start: '2025-05-01',
      recurring_execution_window_kind: null,
      recurring_cadence_source: null,
    });
    // No rsp rows: all six fields null (old LEFT JOIN behaviour).
    expect(merged[3]).toEqual({
      invoice_id: 'inv-none',
      total_amount: 4,
      recurring_service_period_start: null,
      recurring_service_period_end: null,
      recurring_invoice_window_start: null,
      recurring_invoice_window_end: null,
      recurring_execution_window_kind: null,
      recurring_cadence_source: null,
    });
  });

  it('T092b: mergeRecurringSummary skips the rsp query when there are no invoice ids', async () => {
    const trx: any = () => { throw new Error('rsp must not be queried for an empty page'); };
    const service = new InvoiceService();
    await expect((service as any).mergeRecurringSummary(trx, { tenant: 'tenant-1' }, [])).resolves.toEqual([]);
  });

  it('T067: invoice list filter can query recurring invoices by execution-window kind or cadence source when provided (pre-resolved ids, no rsp reference in the invoice filters)', async () => {
    const parsedFilter = invoiceFilterSchema.parse({
      execution_window_kind: 'client_cadence_window',
      cadence_source: 'client_schedule',
    });
    const service = new InvoiceService();

    // Resolution: both filters agree on 'client' -> one standalone rsp query on max(cadence_owner).
    const having: unknown[][] = [];
    const rspBuilder: any = {
      where: () => rspBuilder,
      whereNotNull: () => rspBuilder,
      select: () => rspBuilder,
      groupBy: () => rspBuilder,
      havingRaw: (...args: unknown[]) => { having.push(args); return rspBuilder; },
      then: (resolve: (rows: unknown[]) => unknown) => resolve([{ invoice_id: 'a' }, { invoice_id: 'b' }]),
    };
    const trx: any = (tableName: string) => {
      expect(tableName).toBe('recurring_service_periods as rsp');
      return rspBuilder;
    };
    const ids = await (service as any).resolveCadenceFilterInvoiceIds(trx, { tenant: 'tenant-1' }, parsedFilter);
    expect(ids).toEqual(['a', 'b']);
    expect(having).toEqual([['max(rsp.cadence_owner) = ?', ['client']]]);

    // Conflicting owners can never match; unrecognised values are no-ops.
    await expect((service as any).resolveCadenceFilterInvoiceIds(
      trx, { tenant: 'tenant-1' },
      { execution_window_kind: 'contract_cadence_window', cadence_source: 'client_schedule' },
    )).resolves.toEqual([]);
    await expect((service as any).resolveCadenceFilterInvoiceIds(
      trx, { tenant: 'tenant-1' }, { execution_window_kind: 'bogus', cadence_source: 'nope' },
    )).resolves.toBeNull();

    // Application: ids are applied as whereIn on invoices.invoice_id; null is a no-op.
    const { builder, operations } = createFilterRecorder();
    (service as any).applyInvoiceFilters(builder, parsedFilter, ['a', 'b']);
    expect(operations).toEqual([{ type: 'whereIn', args: ['invoices.invoice_id', ['a', 'b']] }]);

    const noop = createFilterRecorder();
    (service as any).applyInvoiceFilters(noop.builder, parsedFilter, null);
    expect(noop.operations).toEqual([]);
    expect(operations.some((operation) => operation.type === 'whereGroup')).toBe(false);
  });
});
