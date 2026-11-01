import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@alga-psa/db', () => ({
  withTransaction: vi.fn(async (knex: any, fn: any) => fn(knex)),
  // Facade passthrough: the fake below dispatches by table name.
  tenantDb: (conn: any, _tenant: string) => ({ table: (name: string) => conn(name) })
}));

vi.mock('./invoiceTerminalStatusHandlers', () => ({
  notifyInvoiceTerminalStatus: vi.fn(async () => undefined)
}));

vi.mock('./invoiceExportGuards', () => ({
  findInvoiceExportInProgress: vi.fn(async () => null)
}));

vi.mock('../autopayBridge', () => ({
  signalAutopayInvoiceSettled: vi.fn(async () => undefined)
}));

vi.mock('../prepaidBlockLifecycleService', () => ({
  voidHourBlocksForVoidedInvoice: vi.fn(async () => ({ ok: true }))
}));

vi.mock('../../lib/prepaidAutoReplenishment', () => ({
  suppressPrepaidReplenishmentForVoidedInvoice: vi.fn(async () => undefined)
}));

import { applyExternalVoidToInvoice } from './externalVoidApplier';
import { notifyInvoiceTerminalStatus } from './invoiceTerminalStatusHandlers';
import { findInvoiceExportInProgress } from './invoiceExportGuards';
import { voidHourBlocksForVoidedInvoice } from '../prepaidBlockLifecycleService';

interface HarnessOptions {
  status?: string;
  finalizedAt?: string | null;
  paymentTotal?: number;
  creditApplied?: number;
}

/**
 * Fake knex for the external-void applier: a standard finalized invoice with
 * no credit applications, configurable status and recorded payments.
 */
function makeHarness(options: HarnessOptions = {}) {
  const log: Array<{ table: string; op: string; args: any }> = [];
  const invoiceRow = {
    invoice_id: 'inv-1',
    tenant: 'tenant-1',
    finalized_at: options.finalizedAt === undefined ? '2026-10-01T00:00:00.000Z' : options.finalizedAt,
    status: options.status ?? 'sent',
    invoice_type: 'standard',
    total_amount: 12500,
    client_id: 'client-1',
    is_prepayment: false,
    credit_applied: options.creditApplied ?? 0
  };

  const knex: any = vi.fn((tableName: string) => {
    const builder: any = {};
    const chain = () => vi.fn(() => builder);
    builder.where = chain();
    builder.whereIn = chain();
    builder.orderBy = chain();
    builder.forUpdate = chain();
    builder.sum = chain();
    builder.increment = chain();
    builder.select = vi.fn(async () => []);
    builder.first = vi.fn(async () => {
      if (tableName === 'invoices') return invoiceRow;
      if (tableName === 'invoice_payments') return { total: options.paymentTotal ?? 0 };
      return undefined;
    });
    builder.insert = vi.fn(async (row: any) => { log.push({ table: tableName, op: 'insert', args: row }); });
    builder.update = vi.fn(async (row: any) => { log.push({ table: tableName, op: 'update', args: row }); return 1; });
    return builder;
  });
  knex.raw = vi.fn((sql: string) => sql);

  return { knex, log };
}

const params = (knex: any) => ({
  knex,
  tenantId: 'tenant-1',
  invoiceId: 'inv-1',
  adapterType: 'quickbooks_online',
  targetRealm: 'realm-1'
});

describe('applyExternalVoidToInvoice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findInvoiceExportInProgress).mockResolvedValue(null as any);
    vi.mocked(voidHourBlocksForVoidedInvoice).mockResolvedValue({ ok: true } as any);
  });

  it('voids a clean finalized invoice: status cancelled, provenance transaction, payment links retired', async () => {
    const { knex, log } = makeHarness();

    const outcome = await applyExternalVoidToInvoice(params(knex));

    expect(outcome).toEqual({ status: 'applied' });

    const statusUpdate = log.find((e) => e.table === 'invoices' && e.op === 'update');
    expect(statusUpdate?.args.status).toBe('cancelled');

    const cancelled = log.find((e) => e.table === 'transactions' && e.op === 'insert' && e.args.type === 'invoice_cancelled');
    expect(cancelled).toBeDefined();
    expect(cancelled?.args.amount).toBe(-12500);
    expect(cancelled?.args.description).toBe('Invoice voided: Voided in QuickBooks');
    expect(cancelled?.args.metadata).toMatchObject({
      voided_by: null,
      source: 'accounting_sync_external_void',
      provider: 'quickbooks',
      realm: 'realm-1'
    });

    expect(notifyInvoiceTerminalStatus).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', invoiceId: 'inv-1', newStatus: 'cancelled' })
    );
  });

  it('names Xero in the reason for a Xero adapter', async () => {
    const { knex, log } = makeHarness();

    await applyExternalVoidToInvoice({ ...params(knex), adapterType: 'xero' });

    const cancelled = log.find((e) => e.table === 'transactions' && e.op === 'insert' && e.args.type === 'invoice_cancelled');
    expect(cancelled?.args.description).toBe('Invoice voided: Voided in Xero');
    expect(cancelled?.args.metadata.provider).toBe('xero');
  });

  it('already-cancelled invoice is applied without writing anything', async () => {
    const { knex, log } = makeHarness({ status: 'cancelled' });

    const outcome = await applyExternalVoidToInvoice(params(knex));

    expect(outcome).toEqual({ status: 'applied' });
    expect(log).toHaveLength(0);
    expect(notifyInvoiceTerminalStatus).not.toHaveBeenCalled();
  });

  it('recorded payments block the void with the shared reason', async () => {
    const { knex, log } = makeHarness({ paymentTotal: 2500 });

    const outcome = await applyExternalVoidToInvoice(params(knex));

    expect(outcome).toEqual({ status: 'blocked', reason: 'Unwind payments before voiding.' });
    expect(log).toHaveLength(0);
  });

  it('a draft is never voided', async () => {
    const { knex, log } = makeHarness({ finalizedAt: null });

    const outcome = await applyExternalVoidToInvoice(params(knex));

    expect(outcome.status).toBe('blocked');
    expect(log).toHaveLength(0);
  });

  it('an export in flight blocks the void and commits nothing', async () => {
    vi.mocked(findInvoiceExportInProgress).mockResolvedValue({ batch_id: 'b1' } as any);
    const { knex, log } = makeHarness();

    const outcome = await applyExternalVoidToInvoice(params(knex));

    expect(outcome.status).toBe('blocked');
    expect(log).toHaveLength(0);
  });

  it('a used hour block refuses the void with its own reason', async () => {
    vi.mocked(voidHourBlocksForVoidedInvoice).mockResolvedValue({ ok: false, error: 'Block already used.' } as any);
    const { knex, log } = makeHarness();

    const outcome = await applyExternalVoidToInvoice(params(knex));

    expect(outcome).toEqual({ status: 'blocked', reason: 'Block already used.' });
    expect(log.some((e) => e.table === 'invoices' && e.op === 'update')).toBe(false);
  });
});
