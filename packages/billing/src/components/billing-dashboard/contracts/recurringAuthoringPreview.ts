export type RecurringAuthoringPreviewInput = {
  cadenceOwner?: 'client' | 'contract';
  billingTiming?: 'arrears' | 'advance';
  enableProration?: boolean;
};

export type RecurringAuthoringPreview = {
  cadenceOwnerLabel: string;
  cadenceOwnerSummary: string;
  billingTimingLabel: string;
  billingTimingSummary: string;
  firstInvoiceSummary: string;
  partialPeriodSummary: string;
};

export function getRecurringAuthoringPreview(
  input: RecurringAuthoringPreviewInput,
): RecurringAuthoringPreview {
  const cadenceOwner = input.cadenceOwner === 'contract' ? 'contract' : 'client';
  const billingTiming = input.billingTiming === 'advance' ? 'advance' : 'arrears';
  const enableProration = Boolean(input.enableProration);

  return {
    cadenceOwnerLabel:
      cadenceOwner === 'contract' ? 'Contract anniversary' : 'Client billing schedule',
    cadenceOwnerSummary:
      cadenceOwner === 'contract'
        ? 'Service periods and invoice windows follow the contract anniversary dates.'
        : 'Service periods and invoice windows stay aligned to the client billing calendar.',
    billingTimingLabel: billingTiming === 'advance' ? 'Advance' : 'Arrears',
    billingTimingSummary:
      billingTiming === 'advance'
        ? 'Invoices post at the opening of the due service period.'
        : 'Invoices post after the covered service period closes.',
    firstInvoiceSummary:
      cadenceOwner === 'contract'
        ? billingTiming === 'advance'
          ? 'First invoice: bill on the contract anniversary window that opens the first covered service period.'
          : 'First invoice: bill on the next contract anniversary window after the first covered service period closes.'
        : billingTiming === 'advance'
          ? 'First invoice: bill on the first client billing schedule window covering the service period.'
          : 'First invoice: bill on the next client billing schedule window after the first covered service period closes.',
    partialPeriodSummary: enableProration
      ? 'Partial periods adjust the recurring fee to the covered portion of the service period.'
      : 'Partial periods keep the full recurring fee even when contract dates land inside a service period.',
  };
}
