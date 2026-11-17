/**
 * The MSP's manual "Record payment" action (alga-2026-0003329): the invoicing
 * surface had no way to record a cheque or bank transfer at all, so a paid
 * invoice could only ever be marked paid by a payment provider.
 *
 * The action must not be a third copy of the insert + status flip + transaction
 * + PAYMENT_RECORDED logic, so these tests drive the REAL
 * `recordExternalPayment` over a mocked knex and assert the records it lands:
 * a partial amount leaves the invoice `partially_applied`, the balance leaves
 * it `paid`, and cancelled/unauthorized callers write nothing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;

const store = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  seq: 0,
}));

function rows(table: string): Row[] {
  store.tables[table] = store.tables[table] ?? [];
  return store.tables[table];
}

function makeBuilder(table: string) {
  const predicates: Array<(row: Row) => boolean> = [];
  let aggregate: { column: string; alias: string } | null = null;
  let pending: (() => any) | null = null;
  let returningColumn: string | null = null;

  const matched = () => rows(table).filter((row) => predicates.every((p) => p(row)));

  const execute = () => {
    if (pending) return pending();
    if (aggregate) {
      const total = matched().reduce((sum, row) => sum + Number(row[aggregate!.column] ?? 0), 0);
      return [{ [aggregate.alias]: String(total) }];
    }
    return matched();
  };

  const builder: any = {
    where(a: any, b?: any) {
      if (typeof a === 'object' && a !== null) {
        predicates.push((row) => Object.entries(a).every(([key, value]) => row[key] === value));
      } else {
        predicates.push((row) => row[a] === b);
      }
      return builder;
    },
    select: () => builder,
    orderBy: () => builder,
    forUpdate: () => builder,
    sum(expression: string) {
      const [column, alias] = expression.split(' as ');
      aggregate = { column: column.trim(), alias: (alias ?? column).trim() };
      return builder;
    },
    insert(payload: Row | Row[]) {
      const inserted = (Array.isArray(payload) ? payload : [payload]).map((row) => ({
        payment_id: `pay-${++store.seq}`,
        ...row,
      }));
      rows(table).push(...inserted);
      pending = () => (returningColumn
        ? inserted.map((row) => ({ [returningColumn!]: row[returningColumn!] }))
        : inserted);
      return builder;
    },
    returning(column: string) {
      returningColumn = column;
      return builder;
    },
    update(patch: Row) {
      const targets = matched();
      for (const row of targets) {
        for (const [key, value] of Object.entries(patch)) {
          if (value === undefined) continue;
          row[key] = value;
        }
      }
      pending = () => targets.length;
      return builder;
    },
    async first() {
      const result = await execute();
      return Array.isArray(result) ? result[0] : result;
    },
    then(resolve: (value: any) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve(execute()).then(resolve, reject);
    },
  };

  return builder;
}

const knexStub = vi.hoisted(() => ({
  fn: { now: () => 'now()' },
  transaction: async (fn: (trx: any) => Promise<unknown>) => fn(knexStub),
}));

const hasPermission = vi.hoisted(() => vi.fn(async () => true));
const actor = vi.hoisted(() => ({ user: { user_id: 'user-1', user_type: 'internal' } as any }));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn(actor.user, { tenant: 'tenant-1' }, ...args),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: knexStub, tenant: 'tenant-1' }),
  tenantDb: () => ({ table: (name: string) => makeBuilder(name) }),
}));
const publishWorkflowEvent = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishWorkflowEvent }));
vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../src/services/accountingSync/syncProducers', () => ({ enqueueExternalPaymentPush: vi.fn() }));
vi.mock('../../src/services/accountingSync/invoiceTerminalStatusHandlers', () => ({
  notifyInvoiceTerminalStatus: vi.fn(),
}));
vi.mock('../../src/services/prepaidReplenishmentSettlement', () => ({
  settlePrepaidReplenishmentInvoice: vi.fn(),
}));

import {
  getInvoicePaymentSummary,
  recordManualInvoicePayment,
} from '../../src/actions/invoicePaymentActions';

const INVOICE = 'inv-1';
const invoice = () => store.tables.invoices[0];
const payments = () => store.tables.invoice_payments ?? [];

function seed(overrides: Row = {}) {
  store.tables = {
    invoices: [{
      invoice_id: INVOICE,
      invoice_number: 'INV-000008',
      client_id: 'client-1',
      status: 'sent',
      total_amount: 10000,
      credit_applied: 0,
      currency_code: 'USD',
      finalized_at: '2026-11-01T00:00:00.000Z',
      ...overrides,
    }],
    invoice_payments: [],
    transactions: [],
  };
  store.seq = 0;
}

describe('recordManualInvoicePayment', () => {
  beforeEach(() => {
    seed();
    hasPermission.mockClear();
    hasPermission.mockResolvedValue(true);
    publishWorkflowEvent.mockClear();
    actor.user = { user_id: 'user-1', user_type: 'internal' };
  });

  it('refuses a caller without invoice:payment and writes nothing', async () => {
    hasPermission.mockResolvedValue(false);

    const result: any = await recordManualInvoicePayment({
      invoiceId: INVOICE, amount: 10000, method: 'check',
    });

    expect(result.permissionError).toBeDefined();
    expect(hasPermission).toHaveBeenCalledWith(actor.user, 'invoice', 'payment');
    expect(payments()).toHaveLength(0);
    expect(invoice().status).toBe('sent');
  });

  it('refuses a client-portal caller outright', async () => {
    actor.user = { user_id: 'portal-1', user_type: 'client' };

    const result: any = await recordManualInvoicePayment({
      invoiceId: INVOICE, amount: 10000, method: 'check',
    });

    expect(result.permissionError).toBeDefined();
    expect(payments()).toHaveLength(0);
  });

  it('leaves the invoice partially_applied for a partial amount', async () => {
    const result: any = await recordManualInvoicePayment({
      invoiceId: INVOICE,
      amount: 4000,
      method: 'check',
      referenceNumber: ' 1042 ',
      notes: 'Mailed cheque',
    });

    expect(result.success).toBe(true);
    expect(result.newStatus).toBe('partially_applied');
    expect(result.balanceDue).toBe(6000);
    expect(invoice().status).toBe('partially_applied');
    expect(payments()).toHaveLength(1);
    expect(payments()[0]).toMatchObject({
      invoice_id: INVOICE,
      amount: 4000,
      payment_method: 'check',
      reference_number: '1042',
      notes: 'Mailed cheque',
    });
    // The shared AR landing, not a private copy: a 'payment' transaction too.
    expect(store.tables.transactions).toHaveLength(1);
    expect(store.tables.transactions[0]).toMatchObject({ type: 'payment', amount: 4000 });
  });

  it('flips the invoice to paid when the full balance is recorded, with USER attribution', async () => {
    const result: any = await recordManualInvoicePayment({
      invoiceId: INVOICE, amount: 10000, method: 'bank_transfer',
    });

    expect(result).toMatchObject({ success: true, newStatus: 'paid', balanceDue: 0 });
    expect(invoice().status).toBe('paid');

    const recorded = publishWorkflowEvent.mock.calls
      .map((call) => call[0] as any)
      .find((event) => event.eventType === 'PAYMENT_RECORDED');
    expect(recorded).toMatchObject({
      ctx: { actor: { actorType: 'USER', actorUserId: 'user-1' } },
      payload: { source: 'manual', method: 'bank_transfer', receivedByUserId: 'user-1' },
    });
  });

  it('records a cash payment with no reference', async () => {
    const result: any = await recordManualInvoicePayment({
      invoiceId: INVOICE, amount: 10000, method: 'cash', referenceNumber: '   ',
    });

    expect(result.success).toBe(true);
    expect(payments()[0].reference_number).toBeNull();
  });

  it('rejects a cancelled invoice and writes nothing', async () => {
    seed({ status: 'cancelled' });

    const result: any = await recordManualInvoicePayment({
      invoiceId: INVOICE, amount: 10000, method: 'check',
    });

    expect(result.actionError).toBeDefined();
    expect(result.messageKey).toBe('msp/invoicing:errors.recordPayment.statusNotPayable');
    expect(payments()).toHaveLength(0);
  });

  it('rejects a draft invoice and a non-positive amount', async () => {
    seed({ status: 'draft', finalized_at: null });
    const draft: any = await recordManualInvoicePayment({
      invoiceId: INVOICE, amount: 1000, method: 'check',
    });
    expect(draft.actionError).toBeDefined();

    seed();
    const zero: any = await recordManualInvoicePayment({
      invoiceId: INVOICE, amount: 0, method: 'check',
    });
    expect(zero.messageKey).toBe('msp/invoicing:errors.recordPayment.amountPositive');
    expect(payments()).toHaveLength(0);
  });

  it('rejects an invoice that is already settled', async () => {
    seed({ status: 'paid' });
    rows('invoice_payments').push({ payment_id: 'pay-old', invoice_id: INVOICE, amount: 10000 });

    const result: any = await recordManualInvoicePayment({
      invoiceId: INVOICE, amount: 500, method: 'check',
    });

    expect(result.messageKey).toBe('msp/invoicing:errors.recordPayment.noBalanceDue');
    expect(payments()).toHaveLength(1);
  });
});

describe('getInvoicePaymentSummary', () => {
  beforeEach(() => {
    seed();
    hasPermission.mockResolvedValue(true);
    actor.user = { user_id: 'user-1', user_type: 'internal' };
  });

  it('reports the balance due net of credits and prior payments', async () => {
    seed({ credit_applied: 1500 });
    rows('invoice_payments').push({ payment_id: 'pay-old', invoice_id: INVOICE, amount: 2500 });

    const summary: any = await getInvoicePaymentSummary(INVOICE);

    expect(summary).toMatchObject({
      invoiceNumber: 'INV-000008',
      currencyCode: 'USD',
      totalPaid: 2500,
      balanceDue: 6000,
      canRecordPayment: true,
    });
  });

  it('reports a settled invoice as not recordable', async () => {
    seed({ status: 'paid' });
    rows('invoice_payments').push({ payment_id: 'pay-old', invoice_id: INVOICE, amount: 10000 });

    const summary: any = await getInvoicePaymentSummary(INVOICE);

    expect(summary.balanceDue).toBe(0);
    expect(summary.canRecordPayment).toBe(false);
  });
});
