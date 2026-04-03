import { describe, expect, it } from 'vitest';
import { sampleInvoices } from '../src/utils/sampleInvoiceData';
import { mapSampleInvoiceToRendererViewModel } from '../src/utils/sampleInvoicePreview';
import { INVOICE_PREVIEW_SAMPLE_SCENARIOS } from '../src/components/invoice-designer/preview/sampleScenarios';

describe('invoice preview sample data', () => {
  it('preserves canonical recurring service-period metadata for manager-backed sample invoices', () => {
    const mapped = mapSampleInvoiceToRendererViewModel(sampleInvoices[0]);

    expect(mapped.items[0]).toMatchObject({
      id: 'UNBIRTH-001',
      servicePeriodStart: '2023-05-01',
      servicePeriodEnd: '2023-07-01',
      billingTiming: 'arrears',
      recurringDetailPeriods: [
        {
          servicePeriodStart: '2023-05-01',
          servicePeriodEnd: '2023-06-01',
          billingTiming: 'arrears',
        },
        {
          servicePeriodStart: '2023-06-01',
          servicePeriodEnd: '2023-07-01',
          billingTiming: 'arrears',
        },
      ],
    });

    expect(mapped.items[1]).toMatchObject({
      id: 'GRIN-002',
      servicePeriodStart: '2023-07-01',
      servicePeriodEnd: '2023-08-01',
      billingTiming: 'advance',
    });
  });

  it('includes canonical recurring service periods in designer preview demo scenarios', () => {
    const recurringItems = INVOICE_PREVIEW_SAMPLE_SCENARIOS.flatMap((scenario) =>
      scenario.data.items.filter((item) => item.servicePeriodStart || item.recurringDetailPeriods?.length)
    );

    expect(recurringItems.length).toBeGreaterThan(0);
    expect(recurringItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          servicePeriodStart: expect.any(String),
          servicePeriodEnd: expect.any(String),
          billingTiming: expect.stringMatching(/advance|arrears/),
        }),
      ])
    );

    recurringItems
      .filter((item) => item.recurringDetailPeriods && item.recurringDetailPeriods.length > 0)
      .forEach((item) => {
        expect(item.servicePeriodStart).toBe(item.recurringDetailPeriods?.[0]?.servicePeriodStart ?? null);
        expect(item.servicePeriodEnd).toBe(
          item.recurringDetailPeriods?.[item.recurringDetailPeriods.length - 1]?.servicePeriodEnd ?? null
        );
      });
  });
});
