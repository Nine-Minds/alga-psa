import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';

import { getRecurringAuthoringPreview } from '../src/components/billing-dashboard/contracts/recurringAuthoringPreview';

// Fake t that returns `defaultValue` interpolated with params, mirroring i18next's
// English fallback path. Lets the English copy assertions below exercise the helper
// without spinning up an i18next instance.
const mockT: TFunction = ((key: string, options?: Record<string, unknown>) => {
  const fallback = (options?.defaultValue as string | undefined) ?? key;
  if (!options) return fallback;
  return fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
    options[name] != null ? String(options[name]) : `{{${name}}}`,
  );
}) as unknown as TFunction;

describe('recurring authoring preview copy', () => {
  it('T238: authoring previews explain first invoice behavior correctly for client-cadence recurring lines', () => {
    expect(
      getRecurringAuthoringPreview({
        cadenceOwner: 'client',
        billingTiming: 'arrears',
        enableProration: true,
      }, mockT),
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
      }, mockT),
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
      }, mockT),
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
      }, mockT),
    ).toMatchObject({
      firstInvoiceSummary:
        'First invoice: bill on the next contract anniversary window after the first covered service period closes.',
      partialPeriodSummary:
        'Partial periods keep the full recurring fee even when contract dates land inside a service period.',
    });
  });

  it('T308: schedule previews and explainers show illustrative future materialized service periods before a contract line is saved', () => {
    expect(
      getRecurringAuthoringPreview({
        cadenceOwner: 'client',
        billingTiming: 'advance',
        billingFrequency: 'monthly',
        enableProration: true,
      }, mockT),
    ).toMatchObject({
      materializedPeriodsHeading: 'Illustrative future materialized periods',
      materializedPeriodsSummary:
        'If you save this recurring line, future periods would materialize on the client billing schedule preview before invoice generation.',
      materializedPeriods: expect.arrayContaining([
        {
          servicePeriodLabel: '2025-04-01 to 2025-05-01',
          invoiceWindowLabel: '2025-04-01 to 2025-05-01',
        },
        {
          servicePeriodLabel: '2025-05-01 to 2025-06-01',
          invoiceWindowLabel: '2025-05-01 to 2025-06-01',
        },
      ]),
    });

    expect(
      getRecurringAuthoringPreview({
        cadenceOwner: 'contract',
        billingTiming: 'arrears',
        billingFrequency: 'monthly',
        enableProration: false,
      }, mockT),
    ).toMatchObject({
      materializedPeriodsSummary:
        'If you save this recurring line, future periods would materialize on an anniversary-style preview anchored to the 8th before invoice generation.',
      materializedPeriods: expect.arrayContaining([
        {
          servicePeriodLabel: '2025-04-08 to 2025-05-08',
          invoiceWindowLabel: '2025-05-08 to 2025-06-08',
        },
        {
          servicePeriodLabel: '2025-05-08 to 2025-06-08',
          invoiceWindowLabel: '2025-06-08 to 2025-07-08',
        },
      ]),
    });
  });
});
