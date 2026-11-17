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
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { actionError, permissionError } from '@alga-psa/ui/lib/errorHandling';
import type { ActionMessageError, ActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import logger from '@alga-psa/core/logger';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { computeBalanceDue } from '../lib/balanceDue';
import { buildExternalPaymentAppliedPayload } from '../lib/paymentRecordedEvent';
// The method list lives outside this file on purpose: a 'use server' module may
// only export async functions, and the dialog needs the real array.
import { isManualPaymentMethod, type ManualPaymentMethod } from '../lib/payments/manualPaymentMethods';
import {
  isNonPayableInvoiceStatus,
  recordExternalPayment,
} from '../services/accountingSync/recordExternalPayment';

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
