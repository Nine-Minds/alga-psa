import { Temporal } from '@js-temporal/polyfill';

export type InvoiceDeliveryMethod = 'email' | 'portal' | 'print';

export function inferInvoiceDeliveryMethod(params: {
  emailRecipientCount?: number;
  includePdf?: boolean;
}): InvoiceDeliveryMethod {
  if ((params.emailRecipientCount ?? 0) > 0) return 'email';
  if (params.includePdf) return 'print';
  return 'portal';
}

export function toIsoDateString(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value.slice(0, 10);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

export function formatMoneyAmount(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return String(Math.max(0, value));
}

export function calculateDaysOverdue(params: { dueDate: string; overdueAt: string }): number {
  const due = Temporal.PlainDate.from(params.dueDate);
  const overdueAtDate = Temporal.Instant.from(params.overdueAt).toZonedDateTimeISO('UTC').toPlainDate();
  const days = overdueAtDate.since(due).days;
  return Math.max(0, Math.trunc(days));
}

export function buildInvoiceSentPayload(params: {
  invoiceId: string;
  clientId?: string | null;
  sentByUserId?: string;
  sentAt: string;
  deliveryMethod: InvoiceDeliveryMethod;
}) {
  return {
    invoiceId: params.invoiceId,
    clientId: params.clientId ?? undefined,
    sentByUserId: params.sentByUserId,
    sentAt: params.sentAt,
    deliveryMethod: params.deliveryMethod,
  };
}

export function buildInvoiceStatusChangedPayload(params: {
  invoiceId: string;
  previousStatus: string;
  newStatus: string;
  changedAt: string;
}) {
  return {
    invoiceId: params.invoiceId,
    previousStatus: params.previousStatus,
    newStatus: params.newStatus,
    changedAt: params.changedAt,
  };
}

export function buildInvoiceDueDateChangedPayload(params: {
  invoiceId: string;
  previousDueDate: string;
  newDueDate: string;
  changedAt: string;
}) {
  return {
    invoiceId: params.invoiceId,
    previousDueDate: params.previousDueDate,
    newDueDate: params.newDueDate,
    changedAt: params.changedAt,
  };
}

export function buildInvoiceOverduePayload(params: {
  invoiceId: string;
  clientId?: string | null;
  overdueAt: string;
  dueDate: string;
  amountDue: number;
  currency: string;
}) {
  return {
    invoiceId: params.invoiceId,
    clientId: params.clientId ?? undefined,
    overdueAt: params.overdueAt,
    dueDate: params.dueDate,
    amountDue: formatMoneyAmount(params.amountDue),
    currency: params.currency,
    daysOverdue: calculateDaysOverdue({ dueDate: params.dueDate, overdueAt: params.overdueAt }),
  };
}

export function buildInvoiceWrittenOffPayload(params: {
  invoiceId: string;
  writtenOffAt: string;
  amountWrittenOff: number;
  currency: string;
  reason?: string;
}) {
  return {
    invoiceId: params.invoiceId,
    writtenOffAt: params.writtenOffAt,
    amountWrittenOff: formatMoneyAmount(params.amountWrittenOff),
    currency: params.currency,
    reason: params.reason,
  };
}

