'use server';

/**
 * Manual payment entry for the MSP invoicing surface.
 *
 * Provider-agnostic on purpose (paymentActions.ts is the Stripe/EE half): the
 * MSP records a cheque, a bank transfer or cash that never passed through a
 * gateway. It is NOT a third copy of the insert + status flip + transaction +
 * PAYMENT_RECORDED logic — it validates, then delegates to the same shared AR
 * landing (`recordExternalPayment`) that the Stripe webhook and the accounting
 * sync use, so a manually recorded payment produces identical records and the
 * same paid / partially_applied flip.
 */

import type { Knex } from 'knex';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, tenantDb, withTransaction, writeAccountingAudit } from '@alga-psa/db';
import { actionError, permissionError } from '@alga-psa/ui/lib/errorHandling';
import type { ActionMessageError, ActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import logger from '@alga-psa/core/logger';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { computeBalanceDue } from '../lib/balanceDue';
import {
  buildExternalPaymentAppliedPayload,
  buildExternalPaymentReversedPayload,
} from '../lib/paymentRecordedEvent';
// The method list lives outside this file on purpose: a 'use server' module may
// only export async functions, and the dialog needs the real array.
import { isManualPaymentMethod, type ManualPaymentMethod } from '../lib/payments/manualPaymentMethods';
import {
  isNonPayableInvoiceStatus,
  recordExternalPayment,
  reverseExternalPayment,
  reversalReferenceFor,
} from '../services/accountingSync/recordExternalPayment';
import { SyncMappingLedger } from '../services/accountingSync/syncMappingLedger';
import { SyncOperationsRepository } from '../services/accountingSync/syncOperationsRepository';
import {
  describePaymentSource,
  loadInvoicePaymentMappings,
  providerLabelForSource,
  type InvoicePaymentRow,
  type PaymentMappingRef,
  type PaymentSourceKind,
} from '../lib/payments/paymentSources';

/**
 * Why an invoice cannot take a payment right now. The dialog must always be
 * able to say so: a form that silently refuses every input is a dead end.
 */
export type InvoicePaymentBlockedReason = 'status_not_payable' | 'no_balance_due';

export interface InvoicePaymentSummary {
  invoiceId: string;
  invoiceNumber: string;
  status: string;
  currencyCode: string;
  /** All amounts are minor units (cents). */
  totalAmount: number;
  creditApplied: number;
  totalPaid: number;
  balanceDue: number;
  /** False when the invoice cannot take a payment (draft/void/cancelled/settled). */
  canRecordPayment: boolean;
  /** Set exactly when `canRecordPayment` is false. */
  blockedReason: InvoicePaymentBlockedReason | null;
}

export interface RecordManualInvoicePaymentInput {
  invoiceId: string;
  /** Amount in minor units (cents), greater than zero. */
  amount: number;
  method: ManualPaymentMethod;
  /** Calendar date (yyyy-mm-dd); defaults to today. */
  paymentDate?: string;
  referenceNumber?: string;
  notes?: string;
  /**
   * Acknowledgement that the amount exceeds the balance due. Without it an
   * over-balance amount is refused, because it is far more often a typo than a
   * real overpayment and nothing downstream backs it out.
   */
  allowOverpayment?: boolean;
}

export interface RecordManualInvoicePaymentSuccess {
  success: true;
  paymentId: string;
  newStatus: string;
  balanceDue: number;
}

type InvoiceRow = {
  invoice_id: string;
  invoice_number: string;
  status: string;
  total_amount: number;
  credit_applied: number | null;
  currency_code: string | null;
};

const KEY_PREFIX = 'msp/invoicing:errors.recordPayment';

async function loadInvoiceSummary(
  knex: Knex,
  tenant: string,
  invoiceId: string,
): Promise<InvoicePaymentSummary | null> {
  const invoice = await tenantDb(knex, tenant).table('invoices')
    .where({ invoice_id: invoiceId })
    .first<InvoiceRow | undefined>(
      'invoice_id',
      'invoice_number',
      'status',
      'total_amount',
      'credit_applied',
      'currency_code',
    );
  if (!invoice) return null;

  const paidRow = await tenantDb(knex, tenant).table('invoice_payments')
    .where({ invoice_id: invoiceId })
    .sum('amount as total')
    .first();
  const totalPaid = parseInt(String(paidRow?.total ?? '0'), 10) || 0;
  const balanceDue = computeBalanceDue({
    totalAmount: Number(invoice.total_amount),
    creditApplied: Number(invoice.credit_applied ?? 0),
    totalPaid,
  });

  // Status and balance only — deliberately NOT `finalized_at`. The Finalized
  // tab lists every invoice that is finalized OR simply not a draft, and the
  // REST recordPayment endpoint refuses nothing but cancelled, so demanding a
  // finalization timestamp made the dialog refuse rows the tab had offered.
  const blockedReason: InvoicePaymentBlockedReason | null = isNonPayableInvoiceStatus(invoice.status)
    ? 'status_not_payable'
    : balanceDue > 0 ? null : 'no_balance_due';

  return {
    invoiceId: invoice.invoice_id,
    invoiceNumber: invoice.invoice_number,
    status: invoice.status,
    currencyCode: invoice.currency_code || 'USD',
    totalAmount: Number(invoice.total_amount),
    creditApplied: Number(invoice.credit_applied ?? 0),
    totalPaid,
    balanceDue,
    canRecordPayment: blockedReason === null,
    blockedReason,
  };
}

/**
 * Announces that the recorded payment was applied to this invoice, with USER
 * attribution. Never throws: a publish failure must not fail a payment that is
 * already committed.
 */
async function publishPaymentApplied(params: {
  tenant: string;
  invoiceId: string;
  paymentId: string;
  amount: number;
  actorUserId: string;
}): Promise<void> {
  const occurredAt = new Date().toISOString();
  try {
    await publishWorkflowEvent({
      eventType: 'PAYMENT_APPLIED',
      payload: buildExternalPaymentAppliedPayload({
        paymentId: params.paymentId,
        appliedAt: occurredAt,
        appliedByUserId: params.actorUserId,
        applications: [{ invoiceId: params.invoiceId, amountApplied: params.amount }],
      }),
      ctx: {
        tenantId: params.tenant,
        occurredAt,
        actor: { actorType: 'USER', actorUserId: params.actorUserId },
      },
      idempotencyKey: `payment_applied:${params.paymentId}:${params.invoiceId}`,
    });
  } catch (error) {
    logger.error('[recordManualInvoicePayment] Failed to publish PAYMENT_APPLIED', {
      tenant: params.tenant,
      paymentId: params.paymentId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Balance-due read for the Record Payment dialog's amount default.
 * Gated on the same capability as recording, so it leaks nothing extra.
 */
export const getInvoicePaymentSummary = withAuth(async (
  user,
  { tenant },
  invoiceId: string,
): Promise<InvoicePaymentSummary | ActionPermissionError | ActionMessageError> => {
  if (user.user_type === 'client') {
    return permissionError(
      'Permission denied: operation not available in client portal',
      'msp/billing:errors.permissions.clientPortalUnavailable',
    );
  }
  if (!await hasPermission(user, 'invoice', 'payment')) {
    return permissionError('Permission denied: invoice payment required', `${KEY_PREFIX}.permissionDenied`);
  }

  const { knex } = await createTenantKnex();
  const summary = await loadInvoiceSummary(knex, tenant, invoiceId);
  if (!summary) {
    return actionError('Invoice not found', `${KEY_PREFIX}.invoiceNotFound`);
  }
  return summary;
});

/**
 * Records a payment the MSP took outside any payment provider.
 *
 * Draft, void and cancelled invoices are refused (as is an invoice with
 * nothing left to pay); partial amounts are allowed and leave the invoice
 * `partially_applied`, exactly as the Stripe path does.
 */
export const recordManualInvoicePayment = withAuth(async (
  user,
  { tenant },
  input: RecordManualInvoicePaymentInput,
): Promise<RecordManualInvoicePaymentSuccess | ActionPermissionError | ActionMessageError> => {
  if (user.user_type === 'client') {
    return permissionError(
      'Permission denied: operation not available in client portal',
      'msp/billing:errors.permissions.clientPortalUnavailable',
    );
  }
  if (!await hasPermission(user, 'invoice', 'payment')) {
    return permissionError('Permission denied: invoice payment required', `${KEY_PREFIX}.permissionDenied`);
  }

  const amount = Math.round(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) {
    return actionError('Enter a payment amount greater than zero.', `${KEY_PREFIX}.amountPositive`);
  }
  if (!isManualPaymentMethod(input.method)) {
    return actionError('Choose a payment method.', `${KEY_PREFIX}.methodRequired`);
  }

  const { knex } = await createTenantKnex();
  const summary = await loadInvoiceSummary(knex, tenant, input.invoiceId);
  if (!summary) {
    return actionError('Invoice not found', `${KEY_PREFIX}.invoiceNotFound`);
  }
  // Drafts have no amount owed yet; recordExternalPayment refuses void/cancelled
  // too, but refusing here keeps the message specific and skips the write path.
  // The dialog reads the same `blockedReason` from the summary, so what it shows
  // and what this refuses can never disagree.
  if (summary.blockedReason === 'no_balance_due') {
    return actionError('This invoice has no balance due.', `${KEY_PREFIX}.noBalanceDue`);
  }
  if (summary.blockedReason === 'status_not_payable') {
    return actionError(
      `Cannot record a payment for an invoice with status: ${summary.status}`,
      `${KEY_PREFIX}.statusNotPayable`,
      { status: summary.status },
    );
  }

  // An amount above the balance due is usually a slip (an extra digit, or a
  // payment someone already recorded), and nothing downstream reverses it: the
  // surplus simply sits on a `paid` invoice as money the client never owed.
  // It is still allowed — clients do overpay — but only on an explicit
  // acknowledgement from the dialog, never by default.
  const overpayment = amount - summary.balanceDue;
  if (overpayment > 0 && !input.allowOverpayment) {
    return actionError(
      'This payment is more than the balance due. Confirm the overpayment to record it.',
      `${KEY_PREFIX}.overpaymentNotConfirmed`,
    );
  }

  const paymentDate = input.paymentDate ? new Date(`${input.paymentDate}T00:00:00Z`) : new Date();
  if (Number.isNaN(paymentDate.getTime())) {
    return actionError('Enter a valid payment date.', `${KEY_PREFIX}.invalidDate`);
  }

  const reference = input.referenceNumber?.trim() || undefined;
  // The AR landing also queues the payment for the tenant's connected
  // accounting realm (EE + a mapped invoice only). That is deliberate: Alga is
  // the AR system of record here, so a cheque entered in this dialog reaches
  // QBO/Xero the same way a Stripe settlement does.
  const result = await recordExternalPayment(knex, tenant, {
    invoiceId: input.invoiceId,
    amount,
    // Stored as invoice_payments.payment_method, matching the manual methods
    // the REST recordPayment endpoint already accepts.
    provider: input.method,
    referenceNumber: reference,
    paymentDate,
    notes: input.notes?.trim() || undefined,
    currency: summary.currencyCode,
    source: 'manual',
    actorUserId: user.user_id,
    transactionDescription: reference
      ? `Payment recorded manually (${input.method}) - ${reference}`
      : `Payment recorded manually (${input.method})`,
    transactionMetadata: {
      recorded_by_user_id: user.user_id,
      entry_method: 'manual',
      // Kept on the ledger entry so a surplus is auditable as a deliberate
      // choice rather than something to be puzzled over later.
      ...(overpayment > 0 ? { overpayment_amount: overpayment } : {}),
    },
  });

  if (!result.success || !result.paymentId) {
    logger.warn('[recordManualInvoicePayment] AR landing refused the payment', {
      tenant,
      invoiceId: input.invoiceId,
      error: result.error,
    });
    return actionError(result.error ?? 'Failed to record the payment.', `${KEY_PREFIX}.recordFailed`);
  }

  if (overpayment > 0) {
    logger.warn('[recordManualInvoicePayment] Recorded a confirmed overpayment', {
      tenant,
      invoiceId: input.invoiceId,
      paymentId: result.paymentId,
      amount,
      balanceDue: summary.balanceDue,
      overpayment,
    });
  }

  // recordExternalPayment publishes PAYMENT_RECORDED; the application of that
  // payment to this invoice is a second event both other recording paths emit
  // (PaymentService for Stripe, InvoiceService.recordPayment for REST), so the
  // manual entry must not be the odd one out in the event stream.
  await publishPaymentApplied({
    tenant,
    invoiceId: input.invoiceId,
    paymentId: result.paymentId,
    amount,
    actorUserId: user.user_id,
  });

  return {
    success: true,
    paymentId: result.paymentId,
    newStatus: result.newStatus ?? summary.status,
    balanceDue: computeBalanceDue({
      totalAmount: summary.totalAmount,
      creditApplied: summary.creditApplied,
      totalPaid: result.totalPaid ?? summary.totalPaid + amount,
    }),
  };
});

const REVERSE_KEY_PREFIX = 'msp/invoicing:errors.reversePayment';

/** Why a payment row cannot be reversed from here. */
export type PaymentReversalBlockedReason =
  | 'not_reversible'
  | 'already_reversed'
  | 'stripe_refund_required'
  | 'integration_owned';

export interface InvoicePaymentListRow {
  paymentId: string;
  invoiceId: string;
  /** Minor units; negative on the offsetting rows a reversal writes. */
  amount: number;
  method: string | null;
  referenceNumber: string | null;
  paymentDate: string | null;
  notes: string | null;
  status: string | null;
  /** Where the money came from: decides what reversing it means. */
  source: PaymentSourceKind;
  /** Provider-side payment id, for an integration-owned payment. */
  externalReference: string | null;
  /** True once an offsetting reversal row exists for this payment. */
  reversed: boolean;
  /** True when "Reverse payment" may be offered at all. */
  canReverse: boolean;
  /** Set exactly when `canReverse` is false. */
  blockedReason: PaymentReversalBlockedReason | null;
  /**
   * True when reversing requires the explicit "in AlgaPSA only" choice (and
   * the accounting remote-mutate capability): the payment belongs to the
   * accounting system, so the two sides will disagree afterwards.
   */
  requiresAlgaOnly: boolean;
}

export interface ReverseInvoicePaymentInput {
  paymentId: string;
  /** Required; stored on the reversal row and the ledger entry. */
  reason: string;
  /**
   * Reverse an integration-owned payment in AlgaPSA only, unlinking it from
   * the accounting system instead of waiting for the provider to reverse it.
   */
  algaOnly?: boolean;
}

export interface ReverseInvoicePaymentSuccess {
  success: true;
  /** The offsetting row that was written. */
  reversalPaymentId: string;
  invoiceId: string;
  newStatus: string;
  balanceDue: number;
  /** True when the payment's provider mapping was tombstoned. */
  unlinked: boolean;
}

type PaymentRowWithInvoice = InvoicePaymentRow & { invoice_id: string };

async function loadPaymentRows(
  knex: Knex,
  tenant: string,
  invoiceId: string,
): Promise<PaymentRowWithInvoice[]> {
  return tenantDb(knex, tenant).table('invoice_payments')
    .where({ invoice_id: invoiceId })
    .orderBy('payment_date', 'asc')
    .select<PaymentRowWithInvoice[]>(
      'payment_id',
      'invoice_id',
      'amount',
      'payment_method',
      'payment_date',
      'reference_number',
      'notes',
      'status',
      'metadata',
    );
}

/**
 * Decides what a row offers. A reversal row (negative, status 'reversed') is
 * history, never reversible; an already-offset payment is done; Stripe money
 * can only go back through the gateway; an integration-owned payment is the
 * accounting system's until the operator unlinks it deliberately.
 */
function describeListRow(
  row: PaymentRowWithInvoice,
  mapping: PaymentMappingRef | undefined,
  reversedPaymentIds: Set<string>,
): InvoicePaymentListRow {
  const descriptor = describePaymentSource(row, mapping);
  const amount = Number(row.amount ?? 0);
  const reversed = reversedPaymentIds.has(row.payment_id);

  const blockedReason: PaymentReversalBlockedReason | null =
    amount <= 0 || row.status === 'reversed'
      ? 'not_reversible'
      : reversed
        ? 'already_reversed'
        : descriptor.source === 'stripe'
          ? 'stripe_refund_required'
          : null;

  return {
    paymentId: row.payment_id,
    invoiceId: row.invoice_id,
    amount,
    method: row.payment_method ?? null,
    referenceNumber: row.reference_number ?? null,
    paymentDate: row.payment_date ? String(row.payment_date) : null,
    notes: row.notes ?? null,
    status: row.status ?? null,
    source: descriptor.source,
    externalReference: mapping?.externalEntityId ?? null,
    reversed,
    canReverse: blockedReason === null,
    blockedReason,
    requiresAlgaOnly: blockedReason === null && Boolean(mapping),
  };
}

/** Payment ids that already carry an offsetting reversal row. */
function reversedPaymentIdsFrom(rows: PaymentRowWithInvoice[]): Set<string> {
  const reversed = new Set<string>();
  for (const row of rows) {
    const reference = row.reference_number ?? '';
    if (reference.startsWith('reversal:')) {
      reversed.add(reference.slice('reversal:'.length));
    }
    const reversedId = (row as { metadata?: { reversed_payment_id?: string } }).metadata?.reversed_payment_id;
    if (reversedId) {
      reversed.add(String(reversedId));
    }
  }
  return reversed;
}

/**
 * Every payment row on an invoice, classified by where it came from and
 * whether it can be reversed from here. Same capability as recording, so it
 * leaks nothing extra.
 */
export const listInvoicePayments = withAuth(async (
  user,
  { tenant },
  invoiceId: string,
): Promise<InvoicePaymentListRow[] | ActionPermissionError | ActionMessageError> => {
  if (user.user_type === 'client') {
    return permissionError(
      'Permission denied: operation not available in client portal',
      'msp/billing:errors.permissions.clientPortalUnavailable',
    );
  }
  if (!await hasPermission(user, 'invoice', 'payment')) {
    return permissionError('Permission denied: invoice payment required', `${KEY_PREFIX}.permissionDenied`);
  }

  const { knex } = await createTenantKnex();
  const rows = await loadPaymentRows(knex, tenant, invoiceId);
  if (rows.length === 0) {
    return [];
  }

  const mappings = await loadInvoicePaymentMappings(
    knex,
    tenant,
    invoiceId,
    rows.map((row) => row.payment_id),
  );
  const reversedIds = reversedPaymentIdsFrom(rows);

  return rows.map((row) => describeListRow(row, mappings.get(row.payment_id), reversedIds));
});

/**
 * Announces a reversed payment with USER attribution. Never throws: a publish
 * failure must not fail a reversal that is already committed.
 */
async function publishPaymentReversed(params: {
  tenant: string;
  invoiceId: string;
  paymentId: string;
  amount: number;
  currency: string;
  reason: string;
  actorUserId: string;
  unlinked: boolean;
}): Promise<void> {
  const occurredAt = new Date().toISOString();
  try {
    await publishWorkflowEvent({
      eventType: 'PAYMENT_REVERSED',
      payload: buildExternalPaymentReversedPayload({
        paymentId: params.paymentId,
        invoiceId: params.invoiceId,
        reversedAt: occurredAt,
        reversedByUserId: params.actorUserId,
        amount: params.amount,
        currency: params.currency,
        reason: params.reason,
        unlinkedFromProvider: params.unlinked,
      }),
      ctx: {
        tenantId: params.tenant,
        occurredAt,
        actor: { actorType: 'USER', actorUserId: params.actorUserId },
      },
      idempotencyKey: `payment_reversed:${params.paymentId}`,
    });
  } catch (error) {
    logger.error('[reverseInvoicePayment] Failed to publish PAYMENT_REVERSED', {
      tenant: params.tenant,
      paymentId: params.paymentId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Reverses one recorded payment.
 *
 * Manual payments (cheque, cash, bank transfer) are the MSP's own records and
 * reverse here outright. A payment that came from the accounting system is
 * that system's record: the default answer names it and sends the operator
 * there, because a sync of the same payment would otherwise land it again.
 * `algaOnly` is the deliberate exception — it additionally unlinks the payment
 * (tombstones its mapping), so AlgaPSA and the accounting system knowingly
 * disagree, and it needs the admin-level accounting remote-mutate capability.
 * Stripe money is refused outright; it can only go back as a refund.
 *
 * The write itself is `reverseExternalPayment`, the same primitive the sync
 * uses, so a reversal entered here and one observed from QuickBooks produce
 * identical records.
 */
export const reverseInvoicePayment = withAuth(async (
  user,
  { tenant },
  input: ReverseInvoicePaymentInput,
): Promise<ReverseInvoicePaymentSuccess | ActionPermissionError | ActionMessageError> => {
  if (user.user_type === 'client') {
    return permissionError(
      'Permission denied: operation not available in client portal',
      'msp/billing:errors.permissions.clientPortalUnavailable',
    );
  }
  if (!await hasPermission(user, 'invoice', 'payment')) {
    return permissionError('Permission denied: invoice payment required', `${REVERSE_KEY_PREFIX}.permissionDenied`);
  }

  const reason = input.reason?.trim();
  if (!reason) {
    return actionError('A reason is required to reverse a payment.', `${REVERSE_KEY_PREFIX}.reasonRequired`);
  }

  const { knex } = await createTenantKnex();
  const payment = await tenantDb(knex, tenant).table('invoice_payments')
    .where({ payment_id: input.paymentId })
    .first<PaymentRowWithInvoice | undefined>(
      'payment_id',
      'invoice_id',
      'amount',
      'payment_method',
      'payment_date',
      'reference_number',
      'notes',
      'status',
      'metadata',
    );
  if (!payment) {
    return actionError('Payment not found', `${REVERSE_KEY_PREFIX}.paymentNotFound`);
  }

  const amount = Number(payment.amount ?? 0);
  // A reversal row (negative, 'reversed') is history; reversing it would
  // re-apply money nobody received.
  if (amount <= 0 || payment.status === 'reversed') {
    return actionError('This payment cannot be reversed.', `${REVERSE_KEY_PREFIX}.notReversible`);
  }

  const invoiceRows = await loadPaymentRows(knex, tenant, payment.invoice_id);
  if (reversedPaymentIdsFrom(invoiceRows).has(payment.payment_id)) {
    return actionError('This payment has already been reversed.', `${REVERSE_KEY_PREFIX}.alreadyReversed`);
  }

  const summary = await loadInvoiceSummary(knex, tenant, payment.invoice_id);
  if (!summary) {
    return actionError('Invoice not found', `${KEY_PREFIX}.invoiceNotFound`);
  }

  const mappings = await loadInvoicePaymentMappings(knex, tenant, payment.invoice_id, [payment.payment_id]);
  const mapping = mappings.get(payment.payment_id);
  const descriptor = describePaymentSource(payment, mapping);

  if (descriptor.source === 'stripe') {
    return actionError(
      'This payment was taken through Stripe. Refund it through the payment provider instead.',
      `${REVERSE_KEY_PREFIX}.stripeRefundRequired`,
    );
  }

  const providerLabel = providerLabelForSource(descriptor.source);
  if (mapping && !input.algaOnly) {
    return actionError(
      `This payment came from ${providerLabel} payment ${mapping.externalEntityId}. Delete or edit it in ${providerLabel} and the next sync will reverse it here.`,
      `${REVERSE_KEY_PREFIX}.integrationOwned`,
      { provider: providerLabel, reference: mapping.externalEntityId },
    );
  }

  // Unlinking a payment from the accounting system leaves the two ledgers
  // knowingly disagreeing — the same admin-level capability that guards remote
  // voids, never plain invoice:payment.
  if (mapping && input.algaOnly && !await hasPermission(user, 'accounting_integrations', 'remote_mutate', knex)) {
    return permissionError(
      'Permission denied: reversing a synced payment in AlgaPSA only requires the accounting remote-mutate permission.',
      `${REVERSE_KEY_PREFIX}.remoteMutateRequired`,
    );
  }

  const reversalInput = {
    invoiceId: payment.invoice_id,
    amount,
    provider: payment.payment_method || 'manual',
    referenceNumber: reversalReferenceFor(payment.payment_id),
    notes: reason,
    reversedPaymentRowId: payment.payment_id,
    transactionDescription: `Payment reversed in AlgaPSA - ${reason}`,
    transactionMetadata: {
      reversed_by_user_id: user.user_id,
      reversal_reason: reason,
      payment_source: descriptor.source,
      ...(mapping
        ? { alga_only: true, unlinked_external_payment_id: mapping.externalEntityId }
        : {}),
    },
  };

  const outcome = mapping
    ? await withTransaction(knex, async (trx: Knex.Transaction) => {
      // One transaction: the money comes back and the link goes in the same
      // commit, so a sync can never see one without the other.
      const reversal = await reverseExternalPayment(trx, tenant, reversalInput);
      if (!reversal.success || !reversal.paymentId) {
        throw new Error(reversal.error ?? 'Failed to reverse the payment.');
      }
      await new SyncMappingLedger(trx, tenant, mapping.integrationType).tombstone(mapping.mappingId, {
        syncStatus: 'reversed',
        metadata: {
          locally_reversed: true,
          locally_reversed_by: user.user_id,
          locally_reversed_at: new Date().toISOString(),
          locally_reversed_reason: reason,
        },
      });
      return reversal;
    })
    : await reverseExternalPayment(knex, tenant, reversalInput);

  if (!outcome.success || !outcome.paymentId) {
    logger.warn('[reverseInvoicePayment] The AR landing refused the reversal', {
      tenant,
      paymentId: input.paymentId,
      error: outcome.error,
    });
    return actionError(outcome.error ?? 'Failed to reverse the payment.', `${REVERSE_KEY_PREFIX}.reverseFailed`);
  }

  // Queued pushes for a payment that no longer stands must never reach the
  // provider; 'skipped' is the terminal status for work deliberately dropped.
  try {
    await new SyncOperationsRepository(knex).skipPending(
      tenant,
      ['record_payment'],
      'invoice_payment',
      [payment.payment_id],
      `Payment reversed in AlgaPSA: ${reason}`,
    );
  } catch (error) {
    logger.warn('[reverseInvoicePayment] Failed to retire queued payment pushes', {
      tenant,
      paymentId: payment.payment_id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (mapping) {
    await writeAccountingAudit(knex, tenant, 'accounting_local_payment_reversal', {
      userId: user.user_id,
      provider: mapping.integrationType === 'xero' ? 'xero' : 'quickbooks_online',
      recordId: mapping.externalEntityId,
      details: {
        algaEntityType: 'invoice_payment',
        algaEntityId: payment.payment_id,
        invoiceId: payment.invoice_id,
        operation: 'reverse_payment_alga_only',
        amountCents: amount,
        reason,
        // The point of the record: nothing was asked of the provider.
        remoteRecordUntouched: true,
      },
    }).catch((error) => {
      logger.warn('[reverseInvoicePayment] Failed to write the local-reversal audit entry', {
        tenant,
        paymentId: payment.payment_id,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  await publishPaymentReversed({
    tenant,
    invoiceId: payment.invoice_id,
    paymentId: payment.payment_id,
    amount,
    currency: summary.currencyCode,
    reason,
    actorUserId: user.user_id,
    unlinked: Boolean(mapping),
  });

  return {
    success: true,
    reversalPaymentId: outcome.paymentId,
    invoiceId: payment.invoice_id,
    newStatus: outcome.newStatus ?? summary.status,
    balanceDue: computeBalanceDue({
      totalAmount: summary.totalAmount,
      creditApplied: summary.creditApplied,
      totalPaid: outcome.totalPaid ?? Math.max(summary.totalPaid - amount, 0),
    }),
    unlinked: Boolean(mapping),
  };
});
