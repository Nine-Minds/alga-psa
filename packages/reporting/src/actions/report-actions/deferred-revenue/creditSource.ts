/**
 * Credit source classification for the report's detail rows.
 *
 * Mirrors the QBO reachability logic in
 * packages/billing/src/services/accountingSync/creditApplicationApplier.ts
 * (resolveNonCreditMemoSource) and the prepayment/negative-total handling in
 * invoiceModification.ts: credits backed by a prepayment invoice or a
 * project-deposit issuance never produce a QBO CreditMemo, so their detail
 * rows carry qboReachable: false.
 */

import type { CreditSourceKind } from './types';

export interface CreditSourceInvoice {
  invoiceId: string;
  invoiceNumber: string | null;
  isPrepayment: boolean;
  invoiceType: string | null;
}

function normalizeMetadata(metadata: unknown): Record<string, unknown> {
  if (metadata && typeof metadata === 'object') {
    return metadata as Record<string, unknown>;
  }
  if (typeof metadata === 'string') {
    try {
      const parsed = JSON.parse(metadata);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

function isPrepaymentInvoice(invoice: CreditSourceInvoice | undefined): boolean {
  return Boolean(
    invoice &&
      (invoice.isPrepayment || invoice.invoiceType === 'prepayment'),
  );
}

export interface CreditSourceClassification {
  sourceKind: CreditSourceKind;
  qboReachable: boolean;
  invoiceNumber: string | null;
}

/**
 * Classify one credit_tracking row from its source transaction.
 *
 * @param transactionType the source transaction's `type` column
 * @param invoiceId the source transaction's invoice_id
 * @param metadata the source transaction's metadata
 * @param invoicesByInvoiceId invoices loaded for the tenant, keyed by invoice_id
 */
export function classifyCreditSource(
  transactionType: string | null | undefined,
  invoiceId: string | null | undefined,
  metadata: unknown,
  invoicesByInvoiceId: Map<string, CreditSourceInvoice>,
): CreditSourceClassification {
  const meta = normalizeMetadata(metadata);
  const projectDeposit =
    meta.project_billing_credit_kind === 'project_deposit';

  if (projectDeposit) {
    return { sourceKind: 'project_deposit', qboReachable: false, invoiceNumber: null };
  }

  if (transactionType === 'credit_transfer') {
    // A transfer inherits the source credit's reachability through its lineage.
    const sourceInvoiceId =
      typeof meta.source_invoice_id === 'string' ? meta.source_invoice_id : null;
    const sourceInvoice = sourceInvoiceId
      ? invoicesByInvoiceId.get(sourceInvoiceId)
      : undefined;
    return {
      sourceKind: 'transfer_in',
      qboReachable: !isPrepaymentInvoice(sourceInvoice),
      invoiceNumber: sourceInvoice?.invoiceNumber ?? null,
    };
  }

  if (transactionType === 'credit_issuance_from_negative_invoice') {
    return { sourceKind: 'negative_invoice', qboReachable: true, invoiceNumber: null };
  }

  const invoice = invoiceId ? invoicesByInvoiceId.get(invoiceId) : undefined;
  if (isPrepaymentInvoice(invoice)) {
    return {
      sourceKind: 'prepayment',
      qboReachable: false,
      invoiceNumber: invoice?.invoiceNumber ?? null,
    };
  }

  if (invoiceId) {
    // credit_issuance with a non-prepayment invoice (legacy credit note).
    return {
      sourceKind: 'other',
      qboReachable: true,
      invoiceNumber: invoice?.invoiceNumber ?? null,
    };
  }

  // Plain grant / direct issuance.
  return { sourceKind: 'direct_grant', qboReachable: true, invoiceNumber: null };
}
