import type { IInvoiceCharge, InvoiceViewModel } from '@alga-psa/types';

function buildServicePeriodLabel(
  start: string | { toString(): string } | null | undefined,
  end: string | { toString(): string } | null | undefined,
  formatDate: (date: string | { toString(): string } | undefined | null) => string
): string | null {
  if (!start && !end) {
    return null;
  }

  const startLabel = start ? formatDate(start) : 'Unknown start';
  const endLabel = end ? formatDate(end) : 'Unknown end';
  return `${startLabel} - ${endLabel}`;
}

function collectChargePeriodLabels(
  invoiceCharges: IInvoiceCharge[] | undefined,
  formatDate: (date: string | { toString(): string } | undefined | null) => string
): string[] {
  if (!invoiceCharges || invoiceCharges.length === 0) {
    return [];
  }

  const labels = new Set<string>();

  invoiceCharges.forEach((charge) => {
    if (charge.recurring_detail_periods && charge.recurring_detail_periods.length > 0) {
      charge.recurring_detail_periods.forEach((period) => {
        const label = buildServicePeriodLabel(
          period.service_period_start,
          period.service_period_end,
          formatDate
        );
        if (label) {
          labels.add(label);
        }
      });
      return;
    }

    const chargeLabel = buildServicePeriodLabel(
      charge.service_period_start,
      charge.service_period_end,
      formatDate
    );
    if (chargeLabel) {
      labels.add(chargeLabel);
    }
  });

  return Array.from(labels);
}

export function getRecurringServicePeriodSummary(
  invoice: Pick<InvoiceViewModel, 'service_period_start' | 'service_period_end' | 'invoice_charges'>,
  formatDate: (date: string | { toString(): string } | undefined | null) => string
): string | null {
  const detailLabels = collectChargePeriodLabels(invoice.invoice_charges, formatDate);
  if (detailLabels.length > 0) {
    return detailLabels.join('; ');
  }

  return buildServicePeriodLabel(
    invoice.service_period_start,
    invoice.service_period_end,
    formatDate
  );
}
