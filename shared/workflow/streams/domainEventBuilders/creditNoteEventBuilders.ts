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
}) {
  return {
    creditNoteId: params.creditNoteId,
    clientId: params.clientId ?? undefined,
    createdByUserId: params.createdByUserId,
    createdAt: params.createdAt,
    amount: formatMoneyAmount(params.amount),
    currency: params.currency,
    status: params.status,
  };
}

export function buildCreditNoteAppliedPayload(params: {
  creditNoteId: string;
  invoiceId: string;
  appliedByUserId?: string;
  appliedAt?: string;
  amountApplied: number;
  currency: string;
}) {
  return {
    creditNoteId: params.creditNoteId,
    invoiceId: params.invoiceId,
    appliedByUserId: params.appliedByUserId,
    appliedAt: params.appliedAt,
    amountApplied: formatMoneyAmount(params.amountApplied),
    currency: params.currency,
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

