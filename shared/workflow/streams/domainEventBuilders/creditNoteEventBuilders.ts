function formatMoneyAmount(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return String(Math.max(0, value));
}

export function buildCreditNoteCreatedPayload(params: {
  creditNoteId: string;
  clientId?: string | null;
  createdByUserId?: string;
  createdAt?: string;
  amount: number;
  currency: string;
  status: string;
  sourceDocumentKind?: 'prepayment_invoice' | 'negative_invoice';
  sourceInvoiceId?: string | null;
  sourceInvoiceNumber?: string | null;
  sourceInvoiceStatus?: string | null;
  sourceInvoiceDateBasis?: 'financial_document_date' | 'canonical_recurring_service_period';
  sourceServicePeriodStart?: string | null;
  sourceServicePeriodEnd?: string | null;
}) {
  return {
    creditNoteId: params.creditNoteId,
    clientId: params.clientId ?? undefined,
    createdByUserId: params.createdByUserId,
    createdAt: params.createdAt,
    amount: formatMoneyAmount(params.amount),
    currency: params.currency,
    status: params.status,
    sourceDocumentKind: params.sourceDocumentKind,
    sourceInvoiceId: params.sourceInvoiceId ?? undefined,
    sourceInvoiceNumber: params.sourceInvoiceNumber ?? undefined,
    sourceInvoiceStatus: params.sourceInvoiceStatus ?? undefined,
    sourceInvoiceDateBasis: params.sourceInvoiceDateBasis,
    sourceServicePeriodStart: params.sourceServicePeriodStart ?? undefined,
    sourceServicePeriodEnd: params.sourceServicePeriodEnd ?? undefined,
  };
}

export function buildCreditNoteAppliedPayload(params: {
  creditNoteId: string;
  invoiceId: string;
  appliedByUserId?: string;
  appliedAt?: string;
  amountApplied: number;
  currency: string;
  appliedInvoiceNumber?: string | null;
  appliedInvoiceStatus?: string | null;
  appliedInvoiceDateBasis?: 'financial_document_date' | 'canonical_recurring_service_period';
  appliedServicePeriodStart?: string | null;
  appliedServicePeriodEnd?: string | null;
}) {
  return {
    creditNoteId: params.creditNoteId,
    invoiceId: params.invoiceId,
    appliedByUserId: params.appliedByUserId,
    appliedAt: params.appliedAt,
    amountApplied: formatMoneyAmount(params.amountApplied),
    currency: params.currency,
    appliedInvoiceNumber: params.appliedInvoiceNumber ?? undefined,
    appliedInvoiceStatus: params.appliedInvoiceStatus ?? undefined,
    appliedInvoiceDateBasis: params.appliedInvoiceDateBasis,
    appliedServicePeriodStart: params.appliedServicePeriodStart ?? undefined,
    appliedServicePeriodEnd: params.appliedServicePeriodEnd ?? undefined,
  };
}

export function buildCreditNoteVoidedPayload(params: {
  creditNoteId: string;
  voidedByUserId?: string;
  voidedAt?: string;
  reason?: string | null;
}) {
  return {
    creditNoteId: params.creditNoteId,
    voidedByUserId: params.voidedByUserId,
    voidedAt: params.voidedAt,
    reason: params.reason ?? undefined,
  };
}
