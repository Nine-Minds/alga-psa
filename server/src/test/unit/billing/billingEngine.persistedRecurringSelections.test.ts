import { describe, expect, it } from 'vitest';

import { BillingEngine } from '@alga-psa/billing/services';
import {
  buildPersistedRecurringObligationRef,
  buildRecurringServicePeriodRecord,
} from '../../test-utils/recurringTimingFixtures';

describe('billing engine persisted recurring selections', () => {
  it('T307: fixed, product, and license runtime timing selections all build from persisted service-period records with the same coverage semantics', () => {
    const engine = new BillingEngine();

    const fixed = buildRecurringServicePeriodRecord({
      sourceObligation: buildPersistedRecurringObligationRef({
        obligationId: 'fixed-line',
        chargeFamily: 'fixed',
      }),
      cadenceOwner: 'client',
      duePosition: 'advance',
      servicePeriod: {
        start: '2025-01-01',
        end: '2025-02-01',
        semantics: 'half_open',
      },
      activityWindow: null,
    });
    const product = buildRecurringServicePeriodRecord({
      sourceObligation: buildPersistedRecurringObligationRef({
        obligationId: 'product-line',
        chargeFamily: 'product',
      }),
      cadenceOwner: 'client',
      duePosition: 'arrears',
      servicePeriod: {
        start: '2025-02-01',
        end: '2025-03-01',
        semantics: 'half_open',
      },
      activityWindow: {
        start: '2025-02-10',
        end: '2025-02-20',
        semantics: 'half_open',
      },
    });
    const license = buildRecurringServicePeriodRecord({
      sourceObligation: buildPersistedRecurringObligationRef({
        obligationId: 'license-line',
        chargeFamily: 'license',
      }),
      cadenceOwner: 'contract',
      duePosition: 'advance',
      servicePeriod: {
        start: '2025-03-08',
        end: '2025-04-08',
        semantics: 'half_open',
      },
      activityWindow: null,
    });

    const selections = (engine as any).buildRecurringTimingSelectionsFromPersistedRecords([
      fixed,
      product,
      license,
    ]);

    expect(selections['fixed-line']).toEqual({
      duePosition: 'advance',
      servicePeriodStart: '2025-01-01',
      servicePeriodEnd: '2025-01-31',
      servicePeriodStartExclusive: '2025-01-01',
      servicePeriodEndExclusive: '2025-02-01',
      coverageRatio: 1,
    });

    expect(selections['product-line']).toMatchObject({
      duePosition: 'arrears',
      servicePeriodStart: '2025-02-10',
      servicePeriodEnd: '2025-02-19',
      servicePeriodStartExclusive: '2025-02-10',
      servicePeriodEndExclusive: '2025-02-20',
    });
    expect(selections['product-line'].coverageRatio).toBeCloseTo(10 / 28);

    expect(selections['license-line']).toEqual({
      duePosition: 'advance',
      servicePeriodStart: '2025-03-08',
      servicePeriodEnd: '2025-04-07',
      servicePeriodStartExclusive: '2025-03-08',
      servicePeriodEndExclusive: '2025-04-08',
      coverageRatio: 1,
    });
  });
});
