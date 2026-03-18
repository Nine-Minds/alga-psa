import { describe, expect, it } from 'vitest';

import { getRecurringAuthoringPreview } from '../src/components/billing-dashboard/contracts/recurringAuthoringPreview';

describe('recurring authoring preview copy', () => {
  it('T238: authoring previews explain first invoice behavior correctly for client-cadence recurring lines', () => {
    expect(
      getRecurringAuthoringPreview({
        cadenceOwner: 'client',
        billingTiming: 'arrears',
        enableProration: true,
      }),
    ).toMatchObject({
      cadenceOwnerLabel: 'Client billing schedule',
      firstInvoiceSummary:
        'First invoice: bill on the next client billing schedule window after the first covered service period closes.',
      partialPeriodSummary:
        'Partial periods adjust the recurring fee to the covered portion of the service period.',
    });

    expect(
      getRecurringAuthoringPreview({
        cadenceOwner: 'client',
        billingTiming: 'advance',
        enableProration: false,
      }),
    ).toMatchObject({
      firstInvoiceSummary:
        'First invoice: bill on the first client billing schedule window covering the service period.',
      partialPeriodSummary:
        'Partial periods keep the full recurring fee even when contract dates land inside a service period.',
    });
  });

  it('T239: authoring previews explain first invoice behavior correctly for contract-cadence recurring lines', () => {
    expect(
      getRecurringAuthoringPreview({
        cadenceOwner: 'contract',
        billingTiming: 'advance',
        enableProration: true,
      }),
    ).toMatchObject({
      cadenceOwnerLabel: 'Contract anniversary',
      firstInvoiceSummary:
        'First invoice: bill on the contract anniversary window that opens the first covered service period.',
    });

    expect(
      getRecurringAuthoringPreview({
        cadenceOwner: 'contract',
        billingTiming: 'arrears',
        enableProration: false,
      }),
    ).toMatchObject({
      firstInvoiceSummary:
        'First invoice: bill on the next contract anniversary window after the first covered service period closes.',
      partialPeriodSummary:
        'Partial periods keep the full recurring fee even when contract dates land inside a service period.',
    });
  });
});
