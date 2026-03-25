import { describe, expect, it } from 'vitest';

import {
  applyRecurringServicePeriodInvoiceLinkage,
  hasRecurringServicePeriodInvoiceLinkage,
} from '@alga-psa/shared/billingClients/recurringServicePeriodInvoiceLinkage';
import {
  buildRecurringServicePeriodInvoiceLinkage,
  buildRecurringServicePeriodRecord,
} from '../../test-utils/recurringTimingFixtures';

describe('recurring service period invoice linkage', () => {
  it('T291: persisted service periods link cleanly to resulting invoice detail rows after invoice generation', () => {
    const record = buildRecurringServicePeriodRecord({
      lifecycleState: 'locked',
      invoiceLinkage: null,
    });
    const linkage = buildRecurringServicePeriodInvoiceLinkage({
      invoiceId: 'invoice-27',
      invoiceChargeId: 'charge-11',
      invoiceChargeDetailId: 'detail-42',
      linkedAt: '2026-03-18T12:15:00.000Z',
    });

    const linkedRecord = applyRecurringServicePeriodInvoiceLinkage(record, linkage);

    expect(hasRecurringServicePeriodInvoiceLinkage(record)).toBe(false);
    expect(hasRecurringServicePeriodInvoiceLinkage(linkedRecord)).toBe(true);
    expect(linkedRecord.lifecycleState).toBe('billed');
    expect(linkedRecord.invoiceLinkage).toEqual(linkage);
    expect(linkedRecord.updatedAt).toBe('2026-03-18T12:15:00.000Z');
  });

  it('rejects conflicting relinks unless a later repair flow handles them explicitly', () => {
    const record = buildRecurringServicePeriodRecord({
      lifecycleState: 'billed',
      invoiceLinkage: buildRecurringServicePeriodInvoiceLinkage({
        invoiceChargeDetailId: 'detail-existing',
      }),
    });

    expect(() =>
      applyRecurringServicePeriodInvoiceLinkage(
        record,
        buildRecurringServicePeriodInvoiceLinkage({
          invoiceChargeDetailId: 'detail-replacement',
        }),
      ),
    ).toThrow('use invoice_linkage_repair');
  });
});
