import { describe, expect, it, vi } from 'vitest';

import * as dbModule from '@alga-psa/db';
import {
  AccountingExportRepository,
  AccountingExportValidation,
} from '@alga-psa/billing/services';
import * as chargeExpansion from '../../../../../packages/billing/src/services/accountingExportChargeExpansion';
import { AccountingMappingResolver } from '../../../../../packages/billing/src/services/accountingMappingResolver';

// Default to the real expansion; individual tests override it once.
vi.mock('../../../../../packages/billing/src/services/accountingExportChargeExpansion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../packages/billing/src/services/accountingExportChargeExpansion')>();
  return { ...actual, expandAccountingExportCharges: vi.fn(actual.expandAccountingExportCharges) };
});

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
        document_id: 'invoice-1',
        document_line_id: 'charge-1',
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
      {
        line_id: 'line-2',
        batch_id: 'batch-1',
        tenant: 'tenant-1',
        document_id: 'invoice-2',
        document_line_id: 'charge-2',
        client_id: 'client-1',
        amount_cents: 5000,
        currency_code: 'USD',
        service_period_start: '2026-05-01T00:00:00.000Z',
        service_period_end: '2026-06-01T00:00:00.000Z',
        payload: {
          service_period_source: 'canonical_detail_periods',
          recurring_detail_periods: [
            {
              service_period_start: '2026-05-01T00:00:00.000Z',
              service_period_end: '2026-06-01T00:00:00.000Z',
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
        const errorsBuilder: any = {};
        errorsBuilder.where = vi.fn(() => errorsBuilder);
        errorsBuilder.update = clearOpenErrors;
        return errorsBuilder;
      }
      if (table === 'invoice_charges') {
        return buildThenableQuery([
          {
            item_id: 'charge-1',
            invoice_id: 'invoice-1',
            service_id: 'service-1',
            tax_region: null,
            net_amount: 10000,
          },
          {
            item_id: 'charge-2',
            invoice_id: 'invoice-2',
            service_id: 'service-1',
            tax_region: null,
            net_amount: 5000,
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
          {
            item_id: 'charge-2',
            service_period_start: new Date('2026-05-01T04:00:00.000Z'),
            service_period_end: new Date('2026-06-01T04:00:00.000Z'),
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
          {
            invoice_id: 'invoice-2',
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
    // Charge expansion probes for the mid-period adjustments table before it
    // projects contract-change descriptions; this batch carries none.
    knex.schema = { hasTable: async () => false };

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
      resolveServiceMapping: vi.fn().mockResolvedValue({ externalEntityId: 'ITEM-1' }),
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
    expect(resolver.resolveServiceMapping).toHaveBeenCalledOnce();
    expect(persistedErrors).not.toContainEqual(expect.objectContaining({ line_id: 'line-2' }));
  });

  async function validateFixedParentWithTwoServices(payloadPeriodEnd: string) {
    const batch = { batch_id: 'batch-1', tenant: 'tenant-1', adapter_type: 'xero', target_realm: null, status: 'pending' };
    const period = {
      service_period_start: '2026-03-01T00:00:00.000Z',
      service_period_end: '2026-04-01T00:00:00.000Z',
      billing_timing: 'advance',
    };
    const parentLine = {
      line_id: 'line-1', batch_id: 'batch-1', tenant: 'tenant-1', document_id: 'invoice-1',
      document_line_id: 'charge-1', client_id: 'client-1', amount_cents: 20000, currency_code: 'USD',
      service_period_start: period.service_period_start, service_period_end: payloadPeriodEnd,
      payload: {
        service_period_source: 'canonical_detail_periods',
        recurring_detail_periods: [{ ...period, service_period_end: payloadPeriodEnd }],
      },
      resolution_state: 'open',
    };
    const parentCharge = {
      item_id: 'charge-1', invoice_id: 'invoice-1', service_id: null, is_manual: false,
      tax_region: null, net_amount: 20000, tax_amount: 0,
    };
    const childCharges = ['detail-1', 'detail-2'].map((detailId, index) => ({
      ...parentCharge, item_id: detailId, service_id: `service-${index + 1}`, net_amount: 10000,
    }));
    // Mirrors expandAccountingExportCharges: children keep the parent's line identity and payload.
    const childLines = childCharges.map((child) => ({
      ...parentLine, document_line_id: child.item_id, amount_cents: 10000,
    }));
    vi.mocked(chargeExpansion.expandAccountingExportCharges).mockResolvedValueOnce({
      charges: new Map([[parentCharge.item_id, parentCharge], ...childCharges.map((c) => [c.item_id, c] as const)]),
      lines: childLines,
    } as any);

    const persistedErrors: Array<Record<string, unknown>> = [];
    const knex: any = vi.fn((table: string) => {
      if (table === 'accounting_export_errors') {
        const b: any = {};
        b.where = vi.fn(() => b);
        b.update = vi.fn().mockResolvedValue(0);
        return b;
      }
      if (table === 'invoice_charges') return buildThenableQuery([parentCharge]);
      if (table === 'invoice_charge_details') {
        // Two service allocations sharing one period: two identical detail rows.
        return buildThenableQuery([
          { item_id: 'charge-1', ...period },
          { item_id: 'charge-1', ...period },
        ]);
      }
      if (table === 'invoices') {
        return buildThenableQuery([{ invoice_id: 'invoice-1', client_id: 'client-1', tax_source: 'internal' }]);
      }
      if (table === 'service_catalog') {
        return buildThenableQuery([
          { service_id: 'service-1', service_name: 'One' },
          { service_id: 'service-2', service_name: 'Two' },
        ]);
      }
      throw new Error(`Unexpected table ${table}`);
    });
    knex.schema = { hasTable: async () => false };
    vi.spyOn(dbModule, 'createTenantKnex').mockResolvedValue({ knex, tenant: 'tenant-1' } as any);
    vi.spyOn(AccountingExportRepository, 'create').mockResolvedValue({
      getBatch: vi.fn(async () => batch),
      listLines: vi.fn(async () => [parentLine]),
      addError: vi.fn(async (input: Record<string, unknown>) => { persistedErrors.push(input); }),
      listErrors: vi.fn(async () => persistedErrors),
      updateBatchStatus: vi.fn(async (_id: string, updates: { status: string }) => { batch.status = updates.status; }),
    } as unknown as AccountingExportRepository);
    vi.spyOn(AccountingMappingResolver, 'create').mockResolvedValue({
      resolveServiceMapping: vi.fn().mockResolvedValue({ externalEntityId: 'ITEM-1' }),
      resolveTaxCodeMapping: vi.fn(),
      resolvePaymentTermMapping: vi.fn(),
      resolveClientMapping: vi.fn(),
    } as unknown as AccountingMappingResolver);

    await AccountingExportValidation.ensureMappingsForBatch('batch-1');
    return { persistedErrors, batch };
  }

  it('T002: a fixed parent with two services sharing one period, expanded into two lines, has no projection mismatch', async () => {
    const { persistedErrors, batch } = await validateFixedParentWithTwoServices('2026-04-01T00:00:00.000Z');
    expect(persistedErrors.filter((e) => e.code === 'service_period_projection_mismatch')).toHaveLength(0);
    expect(batch.status).toBe('ready');
  });

  it('T002: a drifted payload period on expanded fixed lines still reports service_period_projection_mismatch', async () => {
    const { persistedErrors } = await validateFixedParentWithTwoServices('2026-05-01T00:00:00.000Z');
    const mismatches = persistedErrors.filter((e) => e.code === 'service_period_projection_mismatch');
    expect(mismatches.length).toBeGreaterThan(0);
  });
});
