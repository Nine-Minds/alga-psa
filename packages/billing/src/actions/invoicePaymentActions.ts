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
import { computeBalanceDue } from '../lib/balanceDue';
// The method list lives outside this file on purpose: a 'use server' module may
// only export async functions, and the dialog needs the real array.
import { isManualPaymentMethod, type ManualPaymentMethod } from '../lib/payments/manualPaymentMethods';
import {
  isNonPayableInvoiceStatus,
  recordExternalPayment,
} from '../services/accountingSync/recordExternalPayment';

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
  /** False when the invoice can never take a payment (draft/void/cancelled/settled). */
  canRecordPayment: boolean;
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
  finalized_at: unknown | null;
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
      'finalized_at',
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

  return {
    invoiceId: invoice.invoice_id,
    invoiceNumber: invoice.invoice_number,
    status: invoice.status,
    currencyCode: invoice.currency_code || 'USD',
    totalAmount: Number(invoice.total_amount),
    creditApplied: Number(invoice.credit_applied ?? 0),
    totalPaid,
    balanceDue,
    canRecordPayment: Boolean(invoice.finalized_at)
      && !isNonPayableInvoiceStatus(invoice.status)
      && balanceDue > 0,
  };
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
  if (!summary.canRecordPayment) {
    if (summary.balanceDue <= 0 && !isNonPayableInvoiceStatus(summary.status)) {
      return actionError('This invoice has no balance due.', `${KEY_PREFIX}.noBalanceDue`);
    }
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
