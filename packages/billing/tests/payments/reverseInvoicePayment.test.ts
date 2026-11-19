/**
 * "Reverse payment" (alga-2026-0003364): a QBO-linked test invoice could not
 * be voided because its payment had come in from QuickBooks, and nothing in
 * the product could take a payment back — the customer's only options were to
 * delete the real QuickBooks payment or void the real QuickBooks invoice.
 *
 * The action must not be a third copy of the offsetting-row + payment_reversal
 * + status-recompute logic, so these tests drive the REAL
 * `reverseExternalPayment` over a mocked knex and assert the records it lands:
 * who may reverse what, which payments are the accounting system's, and what
 * "in AlgaPSA only" leaves behind.
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

/** `metadata->'allocations' @> '[{"invoiceId":...}]'` against an in-memory row. */
function containsAllocation(row: Row, bindings: any[]): boolean {
  let probes: any[];
  try {
    probes = JSON.parse(String(bindings?.[0] ?? '[]'));
  } catch {
    return false;
  }
  const allocations = row.metadata?.allocations;
  if (!Array.isArray(allocations)) return false;
  return probes.every((probe: Row) =>
    allocations.some((allocation: Row) =>
      Object.entries(probe).every(([key, value]) => allocation?.[key] === value)));
}

function makeBuilder(table: string) {
  const predicates: Array<(row: Row) => boolean> = [];
  // `orWhereRaw` widens the group it sits in rather than the whole query.
  let disjunction: Array<(row: Row) => boolean> | null = null;
  let aggregate: { column: string; alias: string } | null = null;
  let pending: (() => any) | null = null;
  let returningColumn: string | null = null;

  const add = (predicate: (row: Row) => boolean) => {
    if (disjunction) disjunction.push(predicate);
    else predicates.push(predicate);
    return builder;
  };

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
      if (typeof a === 'function') {
        // Nested group: collect its clauses, then OR them together.
        const group: Array<(row: Row) => boolean> = [];
        const previous = disjunction;
        disjunction = group;
        a(builder);
        disjunction = previous;
        return add((row) => group.some((p) => p(row)));
      }
      if (typeof a === 'object' && a !== null) {
        return add((row) => Object.entries(a).every(([key, value]) => row[key] === value));
      }
      return add((row) => row[a] === b);
    },
    andWhere(a: any, b?: any) {
      return builder.where(a, b);
    },
    whereIn(column: string, values: any[]) {
      return add((row) => values.includes(row[column]));
    },
    orWhereIn(column: string, values: any[]) {
      return add((row) => values.includes(row[column]));
    },
    whereNull(column: string) {
      return add((row) => row[column] === null || row[column] === undefined);
    },
    whereNotNull(column: string) {
      return add((row) => row[column] !== null && row[column] !== undefined);
    },
    whereRaw(_sql: string, bindings: any[]) {
      return add((row) => containsAllocation(row, bindings));
    },
    orWhereRaw(_sql: string, bindings: any[]) {
      return add((row) => containsAllocation(row, bindings));
    },
    select: () => builder,
    orderBy: () => builder,
    orderByRaw: () => builder,
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
const writeAccountingAudit = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn(actor.user, { tenant: 'tenant-1' }, ...args),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: knexStub, tenant: 'tenant-1' }),
  tenantDb: () => ({ table: (name: string) => makeBuilder(name) }),
  withTransaction: async (_knex: unknown, fn: (trx: any) => Promise<unknown>) => fn(knexStub),
  writeAccountingAudit,
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

import { listInvoicePayments, reverseInvoicePayment } from '../../src/actions/invoicePaymentActions';

const INVOICE = 'inv-1';
const PAYMENT = 'pay-seed';
const invoice = () => store.tables.invoices[0];
const payments = () => store.tables.invoice_payments ?? [];
const mappings = () => store.tables.tenant_external_entity_mappings ?? [];
const operations = () => store.tables.accounting_sync_operations ?? [];

interface SeedOptions {
  invoice?: Row;
  payment?: Row;
  /** A live `invoice_payment` mapping owning the seeded payment. */
  mapping?: Row | null;
  extraPayments?: Row[];
}

function seed(options: SeedOptions = {}) {
  store.tables = {
    invoices: [{
      invoice_id: INVOICE,
      invoice_number: 'INV-003256',
      client_id: 'client-1',
      status: 'paid',
      total_amount: 10000,
      credit_applied: 0,
      currency_code: 'USD',
      finalized_at: '2026-11-01T00:00:00.000Z',
      ...options.invoice,
    }],
    invoice_payments: [
      {
        payment_id: PAYMENT,
        invoice_id: INVOICE,
        amount: 10000,
        payment_method: 'check',
        payment_date: '2026-11-02',
        reference_number: '1042',
        notes: null,
        status: 'completed',
        metadata: null,
        ...options.payment,
      },
      ...(options.extraPayments ?? []),
    ],
    transactions: [],
    tenant_external_entity_mappings: options.mapping === undefined || options.mapping === null
      ? []
      : [{
        id: 'map-pay-1',
        tenant: 'tenant-1',
        integration_type: 'quickbooks_online',
        alga_entity_type: 'invoice_payment',
        alga_entity_id: PAYMENT,
        external_entity_id: '3547',
        external_realm_id: 'realm-1',
        sync_status: 'synced',
        metadata: {},
        deleted_at: null,
        ...options.mapping,
      }],
    accounting_sync_operations: [],
  };
  store.seq = 0;
}

/** A queued push for the seeded payment, as the exporter would have left it. */
function seedPendingPush(status = 'pending') {
  rows('accounting_sync_operations').push({
    id: 'op-1',
    tenant: 'tenant-1',
    adapter_type: 'quickbooks_online',
    operation: 'record_payment',
    alga_entity_type: 'invoice_payment',
    alga_entity_id: PAYMENT,
    status,
    last_error: null,
  });
}

describe('reverseInvoicePayment', () => {
  beforeEach(() => {
    seed();
    hasPermission.mockClear();
    hasPermission.mockResolvedValue(true);
    publishWorkflowEvent.mockClear();
    writeAccountingAudit.mockClear();
    actor.user = { user_id: 'user-1', user_type: 'internal' };
  });

  it('refuses a caller without invoice:payment and writes nothing', async () => {
    hasPermission.mockResolvedValue(false);

    const result: any = await reverseInvoicePayment({ paymentId: PAYMENT, reason: 'Keyed twice' });

    expect(result.permissionError).toBeDefined();
    expect(hasPermission).toHaveBeenCalledWith(actor.user, 'invoice', 'payment');
    expect(payments()).toHaveLength(1);
    expect(invoice().status).toBe('paid');
  });

  it('refuses a client-portal caller outright', async () => {
    actor.user = { user_id: 'portal-1', user_type: 'client' };

    const result: any = await reverseInvoicePayment({ paymentId: PAYMENT, reason: 'Keyed twice' });

    expect(result.permissionError).toBeDefined();
    expect(payments()).toHaveLength(1);
  });

  it('requires a reason', async () => {
    const result: any = await reverseInvoicePayment({ paymentId: PAYMENT, reason: '   ' });

    expect(result.messageKey).toBe('msp/invoicing:errors.reversePayment.reasonRequired');
    expect(payments()).toHaveLength(1);
  });

  it('reverses a manual payment and puts the invoice back to sent', async () => {
    const result: any = await reverseInvoicePayment({ paymentId: PAYMENT, reason: 'Keyed twice' });

    expect(result).toMatchObject({ success: true, newStatus: 'sent', balanceDue: 10000, unlinked: false });
    expect(invoice().status).toBe('sent');

    // The shared AR landing, not a private copy: an offsetting row linked to
    // what it offsets, plus a payment_reversal transaction.
    expect(payments()).toHaveLength(2);
    expect(payments()[1]).toMatchObject({
      invoice_id: INVOICE,
      amount: -10000,
      status: 'reversed',
      reference_number: `reversal:${PAYMENT}`,
      notes: 'Keyed twice',
      metadata: { reversed_payment_id: PAYMENT },
    });
    expect(store.tables.transactions).toHaveLength(1);
    expect(store.tables.transactions[0]).toMatchObject({ type: 'payment_reversal', amount: -10000 });
  });

  it('leaves a partly paid invoice partially_applied when one of two payments goes', async () => {
    seed({
      invoice: { status: 'paid' },
      payment: { amount: 6000 },
      extraPayments: [{
        payment_id: 'pay-other',
        invoice_id: INVOICE,
        amount: 4000,
        payment_method: 'cash',
        payment_date: '2026-11-03',
        reference_number: null,
        notes: null,
        status: 'completed',
        metadata: null,
      }],
    });

    const result: any = await reverseInvoicePayment({ paymentId: PAYMENT, reason: 'Cheque bounced' });

    expect(result).toMatchObject({ success: true, newStatus: 'partially_applied', balanceDue: 6000 });
    expect(invoice().status).toBe('partially_applied');
  });

  it('announces PAYMENT_REVERSED with USER attribution', async () => {
    await reverseInvoicePayment({ paymentId: PAYMENT, reason: 'Keyed twice' });

    const event = publishWorkflowEvent.mock.calls
      .map((call) => call[0] as any)
      .find((published) => published.eventType === 'PAYMENT_REVERSED');
    expect(event).toMatchObject({
      ctx: { actor: { actorType: 'USER', actorUserId: 'user-1' } },
      payload: { paymentId: PAYMENT, invoiceId: INVOICE, reason: 'Keyed twice' },
    });
  });

  it('refuses a second reversal of the same payment', async () => {
    const first: any = await reverseInvoicePayment({ paymentId: PAYMENT, reason: 'Keyed twice' });
    expect(first.success).toBe(true);

    const second: any = await reverseInvoicePayment({ paymentId: PAYMENT, reason: 'Keyed twice' });

    expect(second.messageKey).toBe('msp/invoicing:errors.reversePayment.alreadyReversed');
    // No second offsetting row: the invoice is not credited twice.
    expect(payments()).toHaveLength(2);
    expect(invoice().status).toBe('sent');
  });

  it('refuses the reversal row itself', async () => {
    await reverseInvoicePayment({ paymentId: PAYMENT, reason: 'Keyed twice' });
    const reversalRow = payments()[1];

    const result: any = await reverseInvoicePayment({
      paymentId: reversalRow.payment_id,
      reason: 'Undo the undo',
    });

    expect(result.messageKey).toBe('msp/invoicing:errors.reversePayment.notReversible');
    expect(payments()).toHaveLength(2);
  });

  it('sends a Stripe payment to the refund flow', async () => {
    seed({ payment: { payment_method: 'stripe', reference_number: 'pi_123' } });

    const result: any = await reverseInvoicePayment({ paymentId: PAYMENT, reason: 'Wrong invoice' });

    expect(result.messageKey).toBe('msp/invoicing:errors.reversePayment.gatewayRefundRequired');
    expect(payments()).toHaveLength(1);
  });

  // Every gateway, not just the one named 'stripe': the alternative-payments
  // webhook lands its money under its own method and only it can refund.
  it('sends a payment landed by another gateway to the refund flow too', async () => {
    seed({ payment: { payment_method: 'alternative_payments', reference_number: 'evt_9' } });

    const result: any = await reverseInvoicePayment({ paymentId: PAYMENT, reason: 'Wrong invoice' });

    expect(result.messageKey).toBe('msp/invoicing:errors.reversePayment.gatewayRefundRequired');
    expect(result.messageParams).toEqual({ method: 'alternative_payments' });
    expect(payments()).toHaveLength(1);
  });

  /**
   * The sync's own reversal keys its row on the EXTERNAL payment and leaves
   * the original row untouched, so reading only the row would miss it — and
   * the operator who followed our advice ("delete it in QuickBooks") would be
   * offered the reversal a second time, crediting the invoice twice.
   */
  it('refuses a payment the accounting sync has already reversed', async () => {
    seed({
      payment: { payment_method: 'quickbooks', reference_number: '3547' },
      mapping: {},
      extraPayments: [{
        payment_id: 'pay-sync-reversal',
        invoice_id: INVOICE,
        amount: -10000,
        payment_method: 'quickbooks',
        payment_date: '2026-11-18',
        reference_number: 'reversal:3547',
        notes: 'Payment deleted in QuickBooks',
        status: 'reversed',
        metadata: null,
      }],
    });
    // What the sync's reverseExternalPayment leaves behind: the offset row
    // above plus a payment_reversal transaction naming the row it offset.
    rows('transactions').push({
      transaction_id: 'txn-sync-reversal',
      invoice_id: INVOICE,
      type: 'payment_reversal',
      amount: -10000,
      metadata: { external_payment_id: '3547', reversed_payment_row: PAYMENT, realm: 'realm-1' },
    });

    const listed: any = await listInvoicePayments(INVOICE);
    expect(listed[0]).toMatchObject({
      paymentId: PAYMENT,
      reversed: true,
      canReverse: false,
      blockedReason: 'already_reversed',
      requiresAlgaOnly: false,
    });

    const result: any = await reverseInvoicePayment({
      paymentId: PAYMENT, reason: 'Deleted in QuickBooks', algaOnly: true,
    });

    expect(result.messageKey).toBe('msp/invoicing:errors.reversePayment.alreadyReversed');
    // No second offsetting row, and the mapping is left for the sync to own.
    expect(payments()).toHaveLength(2);
    expect(mappings()[0].deleted_at).toBeNull();
  });

  describe('a payment that came from the accounting system', () => {
    beforeEach(() => {
      seed({ payment: { payment_method: 'quickbooks' }, mapping: {} });
    });

    it('is refused by default, naming the QuickBooks payment to fix there', async () => {
      const result: any = await reverseInvoicePayment({ paymentId: PAYMENT, reason: 'Test invoice' });

      expect(result.messageKey).toBe('msp/invoicing:errors.reversePayment.integrationOwned');
      expect(result.messageParams).toEqual({ provider: 'QuickBooks', reference: '3547' });
      expect(result.actionError).toContain('QuickBooks payment 3547');
      expect(payments()).toHaveLength(1);
      expect(mappings()[0].deleted_at).toBeNull();
    });

    it('refuses the AlgaPSA-only reversal without accounting remote-mutate', async () => {
      hasPermission.mockImplementation(async (_user: any, resource: string) => resource === 'invoice');

      const result: any = await reverseInvoicePayment({
        paymentId: PAYMENT, reason: 'Test invoice', algaOnly: true,
      });

      expect(result.permissionError).toBeDefined();
      expect(result.messageKey).toBe('msp/invoicing:errors.reversePayment.remoteMutateRequired');
      expect(payments()).toHaveLength(1);
      expect(mappings()[0].deleted_at).toBeNull();
      expect(writeAccountingAudit).not.toHaveBeenCalled();
    });

    it('reverses in AlgaPSA only, unlinking the payment and retiring its queued push', async () => {
      seedPendingPush();

      const result: any = await reverseInvoicePayment({
        paymentId: PAYMENT, reason: 'Linked to the wrong QuickBooks invoice', algaOnly: true,
      });

      expect(result).toMatchObject({ success: true, newStatus: 'sent', unlinked: true });
      expect(payments()).toHaveLength(2);

      // Unlinked, not deleted: the row stays as evidence of what was linked.
      const mapping = mappings()[0];
      expect(mapping.deleted_at).toBeTruthy();
      expect(mapping.sync_status).toBe('reversed');
      expect(mapping.metadata).toMatchObject({
        locally_reversed: true,
        locally_reversed_by: 'user-1',
        locally_reversed_reason: 'Linked to the wrong QuickBooks invoice',
      });

      // Nothing queued may still reach QuickBooks for a payment that is gone.
      expect(operations()[0]).toMatchObject({ status: 'skipped' });
      expect(operations()[0].last_error).toContain('Linked to the wrong QuickBooks invoice');

      // The audit record exists to say the remote record was left alone.
      expect(writeAccountingAudit).toHaveBeenCalledWith(
        expect.anything(),
        'tenant-1',
        'accounting_local_payment_reversal',
        expect.objectContaining({
          userId: 'user-1',
          recordId: '3547',
          details: expect.objectContaining({
            operation: 'reverse_payment_alga_only',
            remoteRecordUntouched: true,
          }),
        }),
      );
    });

    it('treats an already-tombstoned mapping as a local payment again', async () => {
      seed({
        payment: { payment_method: 'quickbooks' },
        mapping: { deleted_at: '2026-11-18T00:00:00.000Z', sync_status: 'reversed' },
      });

      const result: any = await reverseInvoicePayment({ paymentId: PAYMENT, reason: 'Cleanup' });

      expect(result).toMatchObject({ success: true, unlinked: false });
      expect(writeAccountingAudit).not.toHaveBeenCalled();
    });
  });
});

describe('listInvoicePayments', () => {
  beforeEach(() => {
    seed();
    hasPermission.mockClear();
    hasPermission.mockResolvedValue(true);
    actor.user = { user_id: 'user-1', user_type: 'internal' };
  });

  it('classifies a manual payment as reversible here', async () => {
    const result: any = await listInvoicePayments(INVOICE);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      paymentId: PAYMENT,
      amount: 10000,
      source: 'manual',
      canReverse: true,
      requiresAlgaOnly: false,
      reversed: false,
    });
  });

  it('marks an integration-owned payment as needing the AlgaPSA-only choice', async () => {
    seed({ payment: { payment_method: 'quickbooks' }, mapping: {} });

    const result: any = await listInvoicePayments(INVOICE);

    expect(result[0]).toMatchObject({
      source: 'quickbooks',
      externalReference: '3547',
      canReverse: true,
      requiresAlgaOnly: true,
    });
  });

  it('marks a reversed payment and its offsetting row as spent', async () => {
    await reverseInvoicePayment({ paymentId: PAYMENT, reason: 'Keyed twice' });

    const result: any = await listInvoicePayments(INVOICE);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ reversed: true, canReverse: false, blockedReason: 'already_reversed' });
    expect(result[1]).toMatchObject({ amount: -10000, canReverse: false, blockedReason: 'not_reversible' });
  });

  it('points gateway money at the refund flow', async () => {
    seed({ payment: { payment_method: 'stripe' } });

    const result: any = await listInvoicePayments(INVOICE);

    expect(result[0]).toMatchObject({ source: 'gateway', canReverse: false, blockedReason: 'gateway_refund_required' });
  });

  it('reports the payment date as the calendar day it is booked on', async () => {
    seed({ payment: { payment_date: new Date('2026-11-19T00:00:00.000Z') } });

    const result: any = await listInvoicePayments(INVOICE);

    expect(result[0].paymentDate).toBe('2026-11-19');
  });

  it('refuses a caller without invoice:payment', async () => {
    hasPermission.mockResolvedValue(false);

    const result: any = await listInvoicePayments(INVOICE);

    expect(result.permissionError).toBeDefined();
  });
});
