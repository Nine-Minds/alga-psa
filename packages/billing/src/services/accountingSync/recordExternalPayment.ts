import { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { v4 as uuidv4 } from 'uuid';
import { enqueueExternalPaymentPush } from './syncProducers';

/**
 * Provider-agnostic landing for payments observed in an external system
 * (Stripe webhooks, QuickBooks change polling, ...). One implementation so
 * every provider produces identical AR records: an invoice_payments row, a
 * 'payment' transaction, and a status flip driven by computeBalanceDue.
 *
 * Note: invoice_payments is created by an EE migration; all callers are
 * EE-gated (Stripe payments, accounting sync).
 */

export interface InvoiceBalanceInputs {
  /** Invoice total in cents */
  totalAmount: number;
  /** Credit applied to the invoice in cents */
  creditApplied: number;
  /** Net payments recorded against the invoice in cents */
  totalPaid: number;
}

/**
 * Amount still owed on an invoice, in cents. Invoice totals are immutable
 * (credit reshape): the document total stays gross and what is owed is
 * derived from credits applied plus net payments.
 */
export function computeBalanceDue(inputs: InvoiceBalanceInputs): number {
  return Math.round(inputs.totalAmount) - Math.round(inputs.creditApplied) - Math.round(inputs.totalPaid);
}

export interface ExternalPaymentInput {
  invoiceId: string;
  /** Amount in cents (positive) */
  amount: number;
  /** Payment provider identifier, stored as invoice_payments.payment_method (e.g. 'stripe', 'quickbooks') */
  provider: string;
  referenceNumber: string;
  currency?: string;
  paymentDate?: Date;
  notes?: string;
  /** Extra metadata merged into the transaction record */
  transactionMetadata?: Record<string, unknown>;
  transactionDescription?: string;
}

export interface ExternalPaymentResult {
  success: boolean;
  paymentRecorded: boolean;
  paymentId?: string;
  newStatus?: string;
  totalPaid?: number;
  clientId?: string;
  error?: string;
}

type InvoiceRow = {
  invoice_id: string;
  client_id: string;
  status: string;
  total_amount: number;
  credit_applied: number | null;
  currency_code: string | null;
};

export const NON_PAYABLE_INVOICE_STATUSES = ['cancelled', 'draft', 'void'] as const;

export function isNonPayableInvoiceStatus(status: string | null | undefined): boolean {
  return NON_PAYABLE_INVOICE_STATUSES.includes(status as (typeof NON_PAYABLE_INVOICE_STATUSES)[number]);
}

async function getInvoice(knex: Knex, tenantId: string, invoiceId: string): Promise<InvoiceRow | undefined> {
  return tenantDb(knex, tenantId).table('invoices')
    .where({ invoice_id: invoiceId })
    .select('invoice_id', 'client_id', 'status', 'total_amount', 'credit_applied', 'currency_code')
    .first<InvoiceRow | undefined>();
}

async function sumPayments(trx: Knex, tenantId: string, invoiceId: string): Promise<number> {
  const totalPayments = await tenantDb(trx, tenantId).table('invoice_payments')
    .where({ invoice_id: invoiceId })
    .sum('amount as total')
    .first();
  return parseInt(String(totalPayments?.total ?? '0'), 10) || 0;
}

function resolveStatus(invoice: InvoiceRow, totalPaid: number): string {
  const balanceDue = computeBalanceDue({
    totalAmount: Number(invoice.total_amount),
    creditApplied: Number(invoice.credit_applied ?? 0),
    totalPaid
  });

  if (totalPaid > 0 && balanceDue <= 0) {
    return 'paid';
  }
  if (totalPaid > 0) {
    return 'partially_applied';
  }
  // Net payments gone (full reversal) — back to sent.
  return invoice.status === 'paid' || invoice.status === 'partially_applied' ? 'sent' : invoice.status;
}

async function applyStatus(trx: Knex, tenantId: string, invoice: InvoiceRow, totalPaid: number): Promise<string> {
  const newStatus = resolveStatus(invoice, totalPaid);
  if (newStatus !== invoice.status) {
    await tenantDb(trx, tenantId).table('invoices')
      .where({ invoice_id: invoice.invoice_id })
      .update({ status: newStatus, updated_at: trx.fn.now() });
  }
  return newStatus;
}

async function insertTransaction(
  trx: Knex,
  tenantId: string,
  params: {
    clientId: string;
    invoiceId: string;
    amount: number;
    type: string;
    description: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await tenantDb(trx, tenantId).table('transactions').insert({
    transaction_id: uuidv4(),
    client_id: params.clientId,
    invoice_id: params.invoiceId,
    amount: params.amount,
    type: params.type,
    status: 'completed',
    description: params.description,
    created_at: new Date().toISOString(),
    metadata: params.metadata ?? {},
    tenant: tenantId
  });
}

export async function recordExternalPayment(
  knex: Knex,
  tenantId: string,
  input: ExternalPaymentInput
): Promise<ExternalPaymentResult> {
  const invoice = await getInvoice(knex, tenantId, input.invoiceId);
  if (!invoice) {
    return { success: false, paymentRecorded: false, error: `Invoice not found: ${input.invoiceId}` };
  }

  if (isNonPayableInvoiceStatus(invoice.status)) {
    return {
      success: false,
      paymentRecorded: false,
      error: `Cannot accept payment for invoice with status: ${invoice.status}`
    };
  }

  const invoiceCurrency = (invoice.currency_code || 'USD').toUpperCase();
  const paymentCurrency = (input.currency || invoiceCurrency).toUpperCase();
  if (invoiceCurrency !== paymentCurrency) {
    return {
      success: false,
      paymentRecorded: false,
      error: `Currency mismatch: invoice is ${invoiceCurrency}, payment is ${paymentCurrency}`
    };
  }

  const { paymentId, newStatus, totalPaid } = await knex.transaction(async (trx) => {
    // Row lock so concurrent providers can't race the status computation.
    await tenantDb(trx, tenantId).table('invoices')
      .where({ invoice_id: input.invoiceId })
      .forUpdate()
      .first();

    const [payment] = await tenantDb(trx, tenantId).table('invoice_payments')
      .insert({
        tenant: tenantId,
        invoice_id: input.invoiceId,
        amount: input.amount,
        payment_method: input.provider,
        payment_date: input.paymentDate ?? new Date(),
        reference_number: input.referenceNumber,
        notes: input.notes ?? null
      })
      .returning('payment_id');

    const paid = await sumPayments(trx, tenantId, input.invoiceId);
    const status = await applyStatus(trx, tenantId, invoice, paid);

    await insertTransaction(trx, tenantId, {
      clientId: invoice.client_id,
      invoiceId: input.invoiceId,
      amount: input.amount,
      type: 'payment',
      description:
        input.transactionDescription ?? `Payment received via ${input.provider} - ${input.referenceNumber}`,
      metadata: {
        payment_provider: input.provider,
        reference_number: input.referenceNumber,
        currency: paymentCurrency,
        ...(input.transactionMetadata ?? {})
      }
    });

    return { paymentId: payment.payment_id as string, newStatus: status, totalPaid: paid };
  });

  // Fire-and-forget: push the payment to QBO on the next sync cycle.
  // Must never throw — a producer failure must not fail the payment action.
  void enqueueExternalPaymentPush(knex, tenantId, {
    invoiceId: input.invoiceId,
    paymentId,
    amountCents: input.amount,
    provider: input.provider,
    referenceNumber: input.referenceNumber
  });

  return {
    success: true,
    paymentRecorded: true,
    paymentId,
    newStatus,
    totalPaid,
    clientId: invoice.client_id
  };
}

export interface ExternalPaymentReversalInput {
  invoiceId: string;
  /** Amount being reversed, in cents (positive; stored negated) */
  amount: number;
  provider: string;
  referenceNumber: string;
  notes?: string;
  transactionMetadata?: Record<string, unknown>;
  transactionDescription?: string;
}

/**
 * Reverse a previously recorded external payment (edited or deleted in the
 * external system). Mirrors the refund pattern: an offsetting negative
 * invoice_payments row (audit trail preserved), a payment_reversal
 * transaction, and a status recompute.
 */
export async function reverseExternalPayment(
  knex: Knex,
  tenantId: string,
  input: ExternalPaymentReversalInput
): Promise<ExternalPaymentResult> {
  const invoice = await getInvoice(knex, tenantId, input.invoiceId);
  if (!invoice) {
    return { success: false, paymentRecorded: false, error: `Invoice not found: ${input.invoiceId}` };
  }

  const { paymentId, newStatus, totalPaid } = await knex.transaction(async (trx) => {
    await tenantDb(trx, tenantId).table('invoices')
      .where({ invoice_id: input.invoiceId })
      .forUpdate()
      .first();

    const [payment] = await tenantDb(trx, tenantId).table('invoice_payments')
      .insert({
        tenant: tenantId,
        invoice_id: input.invoiceId,
        amount: -Math.abs(input.amount),
        payment_method: input.provider,
        // Deliberately "now", not the original TxnDate: a reversal is a new
        // bookkeeping event recognized when the sync observes it; backdating
        // it would rewrite a period that may already be reconciled.
        payment_date: new Date(),
        reference_number: input.referenceNumber,
        notes: input.notes ?? null,
        status: 'reversed'
      })
      .returning('payment_id');

    const paid = await sumPayments(trx, tenantId, input.invoiceId);
    const status = await applyStatus(trx, tenantId, invoice, paid);

    await insertTransaction(trx, tenantId, {
      clientId: invoice.client_id,
      invoiceId: input.invoiceId,
      amount: -Math.abs(input.amount),
      type: 'payment_reversal',
      description:
        input.transactionDescription ?? `Payment reversed via ${input.provider} - ${input.referenceNumber}`,
      metadata: {
        payment_provider: input.provider,
        reference_number: input.referenceNumber,
        ...(input.transactionMetadata ?? {})
      }
    });

    return { paymentId: payment.payment_id as string, newStatus: status, totalPaid: paid };
  });

  return {
    success: true,
    paymentRecorded: true,
    paymentId,
    newStatus,
    totalPaid,
    clientId: invoice.client_id
  };
}
