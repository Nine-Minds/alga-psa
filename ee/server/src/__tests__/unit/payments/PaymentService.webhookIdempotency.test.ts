/**
 * Stripe emits `payment_intent.succeeded` and `checkout.session.completed` for
 * the same settlement roughly 0.7s apart. Whichever lands second used to find
 * the invoice already flipped to `paid` and be rejected as "Cannot accept
 * payment for invoice with status: paid", which the webhook route reported back
 * to Stripe as `processed:false` — every successful payment looked failed in the
 * MSP's Stripe dashboard (alga-2026-0003329).
 *
 * These tests pin the shared idempotency guard in `recordPaymentFromWebhook`
 * (both orders are a no-op success), that a genuine rejection is still a
 * rejection, and that `processWebhookEvent` now files a rejected event as
 * `failed` with the error instead of `completed`.
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

/**
 * Minimal knex-shaped builder over the in-memory tables: enough for
 * where(obj) / where(col, op, val) / first / insert / returning / update /
 * sum('x as y') / orderBy / select / forUpdate, awaited directly or via first().
 */
function makeBuilder(table: string) {
  const predicates: Array<(row: Row) => boolean> = [];
  let aggregate: { column: string; alias: string } | null = null;
  let pending: (() => any) | null = null;
  let returningColumn: string | null = null;
  let inserted: Row[] = [];

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
    where(a: any, b?: any, c?: any) {
      if (typeof a === 'object' && a !== null) {
        predicates.push((row) => Object.entries(a).every(([key, value]) => row[key] === value));
      } else if (c !== undefined) {
        predicates.push((row) => {
          const left = Number(row[a] ?? 0);
          const right = Number(c);
          if (b === '>') return left > right;
          if (b === '<') return left < right;
          if (b === '>=') return left >= right;
          if (b === '<=') return left <= right;
          return row[a] === c;
        });
      } else {
        predicates.push((row) => row[a] === b);
      }
      return builder;
    },
    whereIn(column: string, values: unknown[]) {
      predicates.push((row) => values.includes(row[column]));
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
      inserted = (Array.isArray(payload) ? payload : [payload]).map((row) => ({
        payment_id: `pay-${++store.seq}`,
        event_id: `evt-row-${store.seq}`,
        ...row,
      }));
      rows(table).push(...inserted);
      pending = () => (returningColumn ? inserted.map((row) => ({ [returningColumn!]: row[returningColumn!] })) : inserted);
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
}));

vi.mock('@alga-psa/db', () => ({
  getConnection: vi.fn(async () => knexStub),
  tenantDb: () => ({ table: (name: string) => makeBuilder(name) }),
}));

const recordExternalPayment = vi.hoisted(() => vi.fn(async (_knex: unknown, _tenant: string, input: any) => {
  const invoice = store.tables.invoices?.find((row) => row.invoice_id === input.invoiceId);
  const existing = input.dedupeByReference
    ? store.tables.invoice_payments?.find((row) => row.invoice_id === input.invoiceId
      && row.payment_method === input.provider
      && row.reference_number === input.referenceNumber)
    : undefined;
  if (existing) {
    return { success: true, paymentRecorded: false, paymentId: existing.payment_id, alreadyRecorded: true };
  }
  const paymentId = `pay-ext-${++store.seq}`;
  rows('invoice_payments').push({
    payment_id: paymentId,
    invoice_id: input.invoiceId,
    amount: input.amount,
    payment_method: input.provider,
    reference_number: input.referenceNumber,
  });
  const totalPaid = rows('invoice_payments')
    .filter((row) => row.invoice_id === input.invoiceId)
    .reduce((sum, row) => sum + Number(row.amount), 0);
  if (invoice) {
    invoice.status = totalPaid >= Number(invoice.total_amount) ? 'paid' : 'partially_applied';
  }
  return { success: true, paymentRecorded: true, paymentId, newStatus: invoice?.status, totalPaid };
}));

vi.mock('@alga-psa/billing/services/accountingSync/recordExternalPayment', () => ({ recordExternalPayment }));
vi.mock('@alga-psa/billing/services/accountingSync/invoiceTerminalStatusHandlers', () => ({
  registerInvoiceTerminalStatusHandler: vi.fn(),
  listActiveInvoicePaymentLinks: vi.fn(async () => []),
  listPendingInvoicePaymentLinks: vi.fn(async () => []),
}));
vi.mock('@alga-psa/billing/services/invoiceBillingRecipientService', () => ({
  resolveInvoiceBillingRecipient: vi.fn(async () => null),
}));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishWorkflowEvent: vi.fn(async () => undefined) }));
vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../../lib/payments/StripePaymentProvider', () => ({ createStripePaymentProvider: vi.fn() }));
vi.mock('../../../lib/payments/SavedPaymentMethodService', () => ({ SavedPaymentMethodService: { create: vi.fn() } }));
vi.mock('../../../lib/payments/AutopayService', () => ({ AutopayService: { create: vi.fn() } }));
vi.mock('../../../lib/temporal/invoiceAutopay', () => ({ signalInvoiceAutopay: vi.fn() }));
vi.mock('server/src/lib/utils/transactionUtils', () => ({ recordTransaction: vi.fn() }));

import { PaymentService } from '../../../lib/payments/PaymentService';

const TENANT = 'tenant-jrm360';
const INVOICE = 'inv-000008';
const PAYMENT_INTENT = 'pi_live_1';

function webhookEvent(overrides: Record<string, unknown> = {}) {
  return {
    eventId: 'evt_default',
    eventType: 'payment_intent.succeeded',
    provider: 'stripe',
    payload: {},
    invoiceId: INVOICE,
    amount: 100,
    currency: 'USD',
    status: 'succeeded',
    paymentIntentId: PAYMENT_INTENT,
    ...overrides,
  } as any;
}

const paymentIntentSucceeded = () => webhookEvent({ eventId: 'evt_pi', eventType: 'payment_intent.succeeded' });
const checkoutSessionCompleted = (overrides: Record<string, unknown> = {}) => webhookEvent({
  eventId: 'evt_cs',
  eventType: 'checkout.session.completed',
  externalLinkId: 'cs_live_1',
  ...overrides,
});

const webhookRow = (eventId: string) =>
  store.tables.payment_webhook_events.find((row) => row.external_event_id === eventId);

const paymentRows = () => store.tables.invoice_payments ?? [];

describe('PaymentService webhook idempotency across the Stripe event pair', () => {
  let service: PaymentService;

  beforeEach(async () => {
    store.tables = {
      payment_provider_configs: [],
      payment_webhook_events: [],
      invoice_payments: [],
      invoice_payment_links: [
        { invoice_id: INVOICE, status: 'active', payment_link_id: 'link-1' },
      ],
      invoices: [
        {
          invoice_id: INVOICE,
          invoice_number: 'INV-000008',
          client_id: 'client-1',
          total_amount: 100,
          credit_applied: 0,
          currency_code: 'USD',
          status: 'sent',
        },
      ],
    };
    store.seq = 0;
    recordExternalPayment.mockClear();
    service = await PaymentService.create(TENANT);
  });

  it('records once when payment_intent.succeeded arrives before checkout.session.completed', async () => {
    const first = await service.processWebhookEvent(paymentIntentSucceeded());
    expect(first).toMatchObject({ success: true, paymentRecorded: true });
    expect(store.tables.invoices[0].status).toBe('paid');

    const second = await service.processWebhookEvent(checkoutSessionCompleted());

    expect(second).toMatchObject({ success: true, paymentRecorded: false, invoiceId: INVOICE });
    expect(second.error).toBeUndefined();
    expect(paymentRows()).toHaveLength(1);
    // The duplicate never reaches the AR landing at all.
    expect(recordExternalPayment).toHaveBeenCalledTimes(1);
    expect(webhookRow('evt_cs')).toMatchObject({ processed: true, processing_status: 'completed' });
    // handleCheckoutCompleted still retires the link on the duplicate path.
    expect(store.tables.invoice_payment_links[0].status).toBe('completed');
  });

  it('records once in the reverse order (checkout.session.completed first)', async () => {
    const first = await service.processWebhookEvent(checkoutSessionCompleted());
    expect(first).toMatchObject({ success: true, paymentRecorded: true });

    const second = await service.processWebhookEvent(paymentIntentSucceeded());

    expect(second).toMatchObject({ success: true, paymentRecorded: false, invoiceId: INVOICE });
    expect(paymentRows()).toHaveLength(1);
    expect(recordExternalPayment).toHaveBeenCalledTimes(1);
    expect(webhookRow('evt_pi')).toMatchObject({ processed: true, processing_status: 'completed' });
  });

  it('ignores a same-reference refund row when deciding the payment already landed', async () => {
    // handleChargeRefunded writes a negative invoice_payments row under the same
    // PaymentIntent reference; that must not mask a genuine status rejection.
    store.tables.invoices[0].status = 'cancelled';
    rows('invoice_payments').push({
      payment_id: 'pay-refund',
      invoice_id: INVOICE,
      amount: -100,
      payment_method: 'stripe',
      reference_number: PAYMENT_INTENT,
    });

    const result = await service.processWebhookEvent(checkoutSessionCompleted());

    expect(result).toMatchObject({ success: false });
    expect(result.error).toContain('cancelled');
  });

  it('still rejects an invoice paid by a different payment intent and files the event as failed', async () => {
    store.tables.invoices[0].status = 'paid';
    rows('invoice_payments').push({
      payment_id: 'pay-other',
      invoice_id: INVOICE,
      amount: 100,
      payment_method: 'stripe',
      reference_number: 'pi_some_other_intent',
    });

    const result = await service.processWebhookEvent(checkoutSessionCompleted());

    expect(result).toMatchObject({ success: false });
    expect(result.error).toBe('Cannot accept payment for invoice with status: paid');
    expect(recordExternalPayment).not.toHaveBeenCalled();
    expect(paymentRows()).toHaveLength(1);

    // The stored row must agree with the processed:false answer sent to Stripe.
    expect(webhookRow('evt_cs')).toMatchObject({
      processed: false,
      processing_status: 'failed',
      processing_error: 'Cannot accept payment for invoice with status: paid',
    });
  });
});
