import type {
  IInvoiceCharge,
  InvoiceViewModel as SampleInvoiceViewModel,
  WasmInvoiceViewModel as RendererInvoiceViewModel,
} from '@alga-psa/types';

const normalizeRecurringDetailPeriods = (
  periods: IInvoiceCharge['recurring_detail_periods']
): RendererInvoiceViewModel['items'][number]['recurringDetailPeriods'] =>
  periods?.map((detail) => ({
    servicePeriodStart: detail.service_period_start ?? null,
    servicePeriodEnd: detail.service_period_end ?? null,
    billingTiming: detail.billing_timing ?? null,
  })) ?? undefined;

export const mapSampleInvoiceToRendererViewModel = (
  sample: SampleInvoiceViewModel
): RendererInvoiceViewModel => ({
  invoiceNumber: sample.invoice_number,
  issueDate: sample.invoice_date.toString(),
  dueDate: sample.due_date.toString(),
  tenantClient: {
    name: sample.client?.name || null,
    address: sample.client?.address || null,
    logoUrl: sample.client?.logo || null,
  },
  customer: {
    name: sample.contact?.name || 'N/A',
    address: sample.contact?.address || 'N/A',
  },
  items: sample.invoice_charges.map((item, index) => ({
    id: item.item_id || `sample-item-${index + 1}`,
    description: item.description,
    quantity: item.quantity,
    unitPrice: item.unit_price,
    total: item.total_price,
    servicePeriodStart: item.service_period_start ?? null,
    servicePeriodEnd: item.service_period_end ?? null,
    billingTiming: item.billing_timing ?? null,
    recurringDetailPeriods: normalizeRecurringDetailPeriods(item.recurring_detail_periods),
  })),
  subtotal: sample.subtotal,
  tax: sample.tax,
  total: sample.total,
  currencyCode: sample.currencyCode || 'USD',
});
