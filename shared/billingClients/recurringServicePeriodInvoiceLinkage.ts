import type {
  IRecurringServicePeriodInvoiceLinkage,
  IRecurringServicePeriodRecord,
} from '@alga-psa/types';

export function hasRecurringServicePeriodInvoiceLinkage(
  record: IRecurringServicePeriodRecord,
) {
  return record.invoiceLinkage != null;
}

export function applyRecurringServicePeriodInvoiceLinkage(
  record: IRecurringServicePeriodRecord,
  invoiceLinkage: IRecurringServicePeriodInvoiceLinkage,
): IRecurringServicePeriodRecord {
  if (record.lifecycleState === 'superseded' || record.lifecycleState === 'archived') {
    throw new Error(
      `Recurring service period ${record.recordId} cannot accept invoice linkage once it is ${record.lifecycleState}.`,
    );
  }

  if (record.invoiceLinkage) {
    const sameLinkage = (
      record.invoiceLinkage.invoiceId === invoiceLinkage.invoiceId
      && record.invoiceLinkage.invoiceChargeId === invoiceLinkage.invoiceChargeId
      && record.invoiceLinkage.invoiceChargeDetailId === invoiceLinkage.invoiceChargeDetailId
    );

    if (!sameLinkage) {
      throw new Error(
        `Recurring service period ${record.recordId} is already linked to invoice detail ${record.invoiceLinkage.invoiceChargeDetailId}; use invoice_linkage_repair for a corrective relink.`,
      );
    }
  }

  return {
    ...record,
    lifecycleState: 'billed',
    invoiceLinkage,
    updatedAt: invoiceLinkage.linkedAt,
  };
}
