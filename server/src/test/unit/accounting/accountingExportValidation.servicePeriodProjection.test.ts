import { describe, expect, it, vi } from 'vitest';

import * as dbModule from '@alga-psa/db';
import {
  AccountingExportRepository,
  AccountingExportValidation,
} from '@alga-psa/billing/services';
import { AccountingMappingResolver } from '../../../../../packages/billing/src/services/accountingMappingResolver';

function buildThenableQuery(result: any[]) {
  const builder: any = {};
  builder.select = vi.fn(() => builder);
  builder.whereIn = vi.fn(() => builder);
  builder.andWhere = vi.fn(() => builder);
  builder.orderBy = vi.fn(() => builder);
  builder.where = vi.fn(() => builder);
  builder.orderByRaw = vi.fn(() => builder);
  builder.whereNull = vi.fn(() => builder);
  builder.then = (onFulfilled: any, onRejected: any) => Promise.resolve(result).then(onFulfilled, onRejected);
  builder.catch = (onRejected: any) => Promise.resolve(result).catch(onRejected);
  builder.finally = (handler: any) => Promise.resolve(result).finally(handler);
  return builder;
}

describe('AccountingExportValidation service-period projection', () => {
  it('T270: validation catches header-versus-detail recurring period drift before it leaks into downstream readers or exports', async () => {
    const batch = {
      batch_id: 'batch-1',
      tenant: 'tenant-1',
      adapter_type: 'xero',
      target_realm: null,
      status: 'pending',
    };
    const lines = [
      {
        line_id: 'line-1',
        batch_id: 'batch-1',
        tenant: 'tenant-1',
        invoice_id: 'invoice-1',
        invoice_charge_id: 'charge-1',
        client_id: 'client-1',
        amount_cents: 10000,
        currency_code: 'USD',
        service_period_start: '2026-03-01T00:00:00.000Z',
        service_period_end: '2026-04-01T00:00:00.000Z',
        payload: {
          service_period_source: 'canonical_detail_periods',
          recurring_detail_periods: [
            {
              service_period_start: '2026-03-01T00:00:00.000Z',
              service_period_end: '2026-04-01T00:00:00.000Z',
              billing_timing: 'advance',
            },
          ],
        },
        resolution_state: 'open',
      },
    ];

    const persistedErrors: Array<Record<string, unknown>> = [];
    const clearOpenErrors = vi.fn().mockResolvedValue(0);
    const updateBatchStatus = vi.fn(async (_batchId: string, updates: { status: string }) => {
      batch.status = updates.status;
    });

    const knex: any = vi.fn((table: string) => {
      if (table === 'accounting_export_errors') {
        return {
          where: vi.fn(() => ({
            update: clearOpenErrors,
          })),
        };
      }
      if (table === 'invoice_charges') {
        return buildThenableQuery([
          {
            item_id: 'charge-1',
            invoice_id: 'invoice-1',
            service_id: 'service-1',
            tax_region: null,
          },
        ]);
      }
      if (table === 'invoice_charge_details') {
        return buildThenableQuery([
          {
            item_id: 'charge-1',
            service_period_start: '2026-01-01T00:00:00.000Z',
            service_period_end: '2026-02-01T00:00:00.000Z',
            billing_timing: 'advance',
          },
          {
            item_id: 'charge-1',
            service_period_start: '2026-02-01T00:00:00.000Z',
            service_period_end: '2026-03-01T00:00:00.000Z',
            billing_timing: 'advance',
          },
        ]);
      }
      if (table === 'invoices') {
        return buildThenableQuery([
          {
            invoice_id: 'invoice-1',
            client_id: 'client-1',
            tax_source: 'internal',
          },
        ]);
      }
      if (table === 'service_catalog') {
        return buildThenableQuery([
          {
            service_id: 'service-1',
            service_name: 'Managed Endpoint',
          },
        ]);
      }

      throw new Error(`Unexpected table ${table}`);
    });

    vi.spyOn(dbModule, 'createTenantKnex').mockResolvedValue({
      knex,
      tenant: 'tenant-1',
    } as Awaited<ReturnType<typeof dbModule.createTenantKnex>>);

    vi.spyOn(AccountingExportRepository, 'create').mockResolvedValue({
      getBatch: vi.fn(async () => batch),
      listLines: vi.fn(async () => lines),
      addError: vi.fn(async (input: Record<string, unknown>) => {
        persistedErrors.push({
          error_id: `error-${persistedErrors.length + 1}`,
          resolution_state: 'open',
          ...input,
        });
      }),
      listErrors: vi.fn(async () => persistedErrors),
      updateBatchStatus,
    } as unknown as AccountingExportRepository);

    const resolver = {
      resolveServiceMapping: vi.fn(),
      resolveTaxCodeMapping: vi.fn(),
      resolvePaymentTermMapping: vi.fn(),
      resolveClientMapping: vi.fn(),
    };
    vi.spyOn(AccountingMappingResolver, 'create').mockResolvedValue(
      resolver as unknown as AccountingMappingResolver
    );

    await AccountingExportValidation.ensureMappingsForBatch('batch-1');

    expect(clearOpenErrors).toHaveBeenCalledOnce();
    expect(persistedErrors).toHaveLength(1);
    expect(persistedErrors[0]).toMatchObject({
      batch_id: 'batch-1',
      line_id: 'line-1',
      code: 'service_period_projection_mismatch',
      message: 'Export line service periods do not match canonical invoice charge details',
      metadata: {
        invoice_charge_id: 'charge-1',
        expected_summary: {
          service_period_start: '2026-01-01T00:00:00.000Z',
          service_period_end: '2026-03-01T00:00:00.000Z',
        },
        actual_summary: {
          service_period_start: '2026-03-01T00:00:00.000Z',
          service_period_end: '2026-04-01T00:00:00.000Z',
        },
        expected_source: 'canonical_detail_periods',
        actual_source: 'canonical_detail_periods',
      },
    });
    expect(updateBatchStatus).toHaveBeenCalledWith('batch-1', { status: 'needs_attention' });
    expect(batch.status).toBe('needs_attention');
    expect(resolver.resolveServiceMapping).not.toHaveBeenCalled();
  });
});
