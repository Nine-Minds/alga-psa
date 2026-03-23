import { Temporal } from '@js-temporal/polyfill';

export type InvoiceDeliveryMethod = 'email' | 'portal' | 'print';
export type InvoiceRecurringBillingTimingShape = 'none' | 'uniform' | 'mixed';

export interface InvoiceRecurringChargeLike {
  service_period_start?: string | null;
  service_period_end?: string | null;
  billing_timing?: 'arrears' | 'advance' | null;
  recurring_detail_periods?: Array<{
    service_period_start?: string | null;
    service_period_end?: string | null;
    billing_timing?: 'arrears' | 'advance' | null;
  }>;
}

export interface InvoiceRecurringProvenance {
  authoritativePeriodSource: 'canonical_detail_rows' | 'parent_charge_fields';
  detailBackedChargeCount: number;
  detailPeriodCount: number;
  summaryServicePeriodStart?: string | null;
  summaryServicePeriodEnd?: string | null;
  billingTimingShape: InvoiceRecurringBillingTimingShape;
}

function compareNullableStrings(left: string | null | undefined, right: string | null | undefined): number {
  return String(left ?? '').localeCompare(String(right ?? ''));
}

function resolveBillingTimingShape(values: Array<'arrears' | 'advance' | null | undefined>): InvoiceRecurringBillingTimingShape {
  const uniqueValues = new Set(values.filter((value): value is 'arrears' | 'advance' => value === 'arrears' || value === 'advance'));
  if (uniqueValues.size === 0) return 'none';
  if (uniqueValues.size === 1) return 'uniform';
  return 'mixed';
}

export function summarizeInvoiceRecurringProvenance(
  charges: InvoiceRecurringChargeLike[] | null | undefined
): InvoiceRecurringProvenance | undefined {
  if (!charges?.length) {
    return undefined;
  }

  const canonicalDetailPeriods = charges
    .filter(
      (charge) =>
        Array.isArray(charge.recurring_detail_periods) &&
        charge.recurring_detail_periods.length > 0
    )
    .flatMap((charge) => charge.recurring_detail_periods ?? [])
    .sort((left, right) => {
      const byStart = compareNullableStrings(left.service_period_start, right.service_period_start);
      if (byStart !== 0) {
        return byStart;
      }
      return compareNullableStrings(left.service_period_end, right.service_period_end);
    });

  if (canonicalDetailPeriods.length > 0) {
    return {
      authoritativePeriodSource: 'canonical_detail_rows',
      detailBackedChargeCount: charges.filter(
        (charge) => Array.isArray(charge.recurring_detail_periods) && charge.recurring_detail_periods.length > 0
      ).length,
      detailPeriodCount: canonicalDetailPeriods.length,
      summaryServicePeriodStart: canonicalDetailPeriods[0]?.service_period_start ?? null,
      summaryServicePeriodEnd: canonicalDetailPeriods[canonicalDetailPeriods.length - 1]?.service_period_end ?? null,
      billingTimingShape: resolveBillingTimingShape(canonicalDetailPeriods.map((period) => period.billing_timing)),
    };
  }

  const parentPeriodCharges = charges
    .filter((charge) => charge.service_period_start || charge.service_period_end || charge.billing_timing)
    .sort((left, right) => {
      const byStart = compareNullableStrings(left.service_period_start, right.service_period_start);
      if (byStart !== 0) {
        return byStart;
      }
      return compareNullableStrings(left.service_period_end, right.service_period_end);
    });

  if (parentPeriodCharges.length === 0) {
    return undefined;
  }

  return {
    authoritativePeriodSource: 'parent_charge_fields',
    detailBackedChargeCount: 0,
    detailPeriodCount: 0,
    summaryServicePeriodStart: parentPeriodCharges[0]?.service_period_start ?? null,
    summaryServicePeriodEnd: parentPeriodCharges[parentPeriodCharges.length - 1]?.service_period_end ?? null,
    billingTimingShape: resolveBillingTimingShape(parentPeriodCharges.map((charge) => charge.billing_timing)),
  };
}

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
  recurringProvenance?: InvoiceRecurringProvenance;
}) {
  return {
    invoiceId: params.invoiceId,
    clientId: params.clientId ?? undefined,
    sentByUserId: params.sentByUserId,
    sentAt: params.sentAt,
    deliveryMethod: params.deliveryMethod,
    recurringProvenance: params.recurringProvenance,
  };
}

export function buildInvoiceStatusChangedPayload(params: {
  invoiceId: string;
  previousStatus: string;
  newStatus: string;
  changedAt: string;
  recurringProvenance?: InvoiceRecurringProvenance;
}) {
  return {
    invoiceId: params.invoiceId,
    previousStatus: params.previousStatus,
    newStatus: params.newStatus,
    changedAt: params.changedAt,
    recurringProvenance: params.recurringProvenance,
  };
}

export function buildInvoiceDueDateChangedPayload(params: {
  invoiceId: string;
  previousDueDate: string;
  newDueDate: string;
  changedAt: string;
  recurringProvenance?: InvoiceRecurringProvenance;
}) {
  return {
    invoiceId: params.invoiceId,
    previousDueDate: params.previousDueDate,
    newDueDate: params.newDueDate,
    changedAt: params.changedAt,
    recurringProvenance: params.recurringProvenance,
  };
}

export function buildInvoiceOverduePayload(params: {
  invoiceId: string;
  clientId?: string | null;
  overdueAt: string;
  dueDate: string;
  amountDue: number;
  currency: string;
  recurringProvenance?: InvoiceRecurringProvenance;
}) {
  return {
    invoiceId: params.invoiceId,
    clientId: params.clientId ?? undefined,
    overdueAt: params.overdueAt,
    dueDate: params.dueDate,
    amountDue: formatMoneyAmount(params.amountDue),
    currency: params.currency,
    daysOverdue: calculateDaysOverdue({ dueDate: params.dueDate, overdueAt: params.overdueAt }),
    recurringProvenance: params.recurringProvenance,
  };
}

export function buildInvoiceWrittenOffPayload(params: {
  invoiceId: string;
  writtenOffAt: string;
  amountWrittenOff: number;
  currency: string;
  reason?: string;
  recurringProvenance?: InvoiceRecurringProvenance;
}) {
  return {
    invoiceId: params.invoiceId,
    writtenOffAt: params.writtenOffAt,
    amountWrittenOff: formatMoneyAmount(params.amountWrittenOff),
    currency: params.currency,
    reason: params.reason,
    recurringProvenance: params.recurringProvenance,
  };
}
