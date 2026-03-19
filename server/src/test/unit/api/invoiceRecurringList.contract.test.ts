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
  it('T066/T068: invoice list and single-item response contracts accept recurring execution metadata with nullable billing_cycle_id', () => {
    const recurringInvoice = {
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

    const listParsed = invoiceListResponseSchema.safeParse({
      data: [recurringInvoice],
      pagination: {
        page: 1,
        limit: 25,
        total: 1,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      },
    });
    const singleParsed = singleInvoiceResponseSchema.safeParse({
      data: recurringInvoice,
    });

    expect(listParsed.success).toBe(true);
    expect(singleParsed.success).toBe(true);
  });

  it('T092: invoice list and detail readers still select recurring service-period summary fields after the service-driven cutover', () => {
    const summaryBuilder: any = {
      where: () => summaryBuilder,
      whereNotNull: () => summaryBuilder,
      select: () => summaryBuilder,
      min: () => summaryBuilder,
      max: () => summaryBuilder,
      groupBy: () => summaryBuilder,
      as: () => 'recurring_invoice_summary',
    };

    const operations: Array<{ type: string; args: unknown[] }> = [];
    const invoiceBuilder: any = {
      where: (...args: unknown[]) => {
        operations.push({ type: 'where', args });
        return invoiceBuilder;
      },
      leftJoin: (...args: unknown[]) => {
        operations.push({ type: 'leftJoin', args });
        return invoiceBuilder;
      },
      select: (...args: unknown[]) => {
        operations.push({ type: 'select', args });
        return invoiceBuilder;
      },
    };

    const trx: any = ((tableName: string) => {
      if (tableName === 'recurring_service_periods as rsp') {
        return summaryBuilder;
      }
      if (tableName === 'invoices') {
        return invoiceBuilder;
      }
      throw new Error(`Unexpected table ${tableName}`);
    }) as any;
    trx.raw = (sql: string) => sql;

    const service = new InvoiceService();
    (service as any).buildBaseQuery(trx, { tenant: 'tenant-1', userId: 'user-1' });

    expect(operations).toEqual(
      expect.arrayContaining([
        {
          type: 'leftJoin',
          args: ['recurring_invoice_summary', 'recurring_invoice_summary.invoice_id', 'invoices.invoice_id'],
        },
      ]),
    );

    const selectOperation = operations.find((operation) => operation.type === 'select');
    expect(selectOperation?.args).toEqual(
      expect.arrayContaining([
        'recurring_invoice_summary.recurring_service_period_start',
        'recurring_invoice_summary.recurring_service_period_end',
        'recurring_invoice_summary.recurring_invoice_window_start',
        'recurring_invoice_summary.recurring_invoice_window_end',
      ]),
    );
  });

  it('T067: invoice list filter can query recurring invoices by execution-window kind or cadence source when provided', () => {
    const parsedFilter = invoiceFilterSchema.parse({
      execution_window_kind: 'contract_cadence_window',
      cadence_source: 'contract_anniversary',
    });
    const service = new InvoiceService();
    const { builder, operations } = createFilterRecorder();

    (service as any).applyInvoiceFilters(builder, parsedFilter);

    expect(operations).toEqual(
      expect.arrayContaining([
        {
          type: 'where',
          args: ['recurring_invoice_summary.recurring_cadence_owner', 'contract', undefined],
        },
        {
          type: 'where',
          args: ['recurring_invoice_summary.recurring_cadence_owner', 'contract', undefined],
        },
      ]),
    );
  });
});
