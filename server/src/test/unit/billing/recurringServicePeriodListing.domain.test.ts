import { describe, expect, it } from 'vitest';

import {
  buildRecurringServicePeriodListingQuery,
  listRecurringServicePeriodRecords,
} from '@alga-psa/shared/billingClients/recurringServicePeriodListing';
import { buildRecurringServicePeriodRecord } from '../../test-utils/recurringTimingFixtures';

describe('recurring service period listing', () => {
  it('T348: future persisted service periods can be listed independently of due selection or invoice generation', () => {
    const futureGenerated = buildRecurringServicePeriodRecord({
      recordId: 'rsp_future_generated',
      scheduleKey: 'schedule:a',
      lifecycleState: 'generated',
      servicePeriod: {
        start: '2026-06-10',
        end: '2026-07-10',
        semantics: 'half_open',
      },
    });
    const futureSkipped = buildRecurringServicePeriodRecord({
      recordId: 'rsp_future_skipped',
      scheduleKey: 'schedule:a',
      lifecycleState: 'skipped',
      servicePeriod: {
        start: '2026-07-10',
        end: '2026-08-10',
        semantics: 'half_open',
      },
    });
    const billedHistory = buildRecurringServicePeriodRecord({
      recordId: 'rsp_billed_history',
      scheduleKey: 'schedule:a',
      lifecycleState: 'billed',
      servicePeriod: {
        start: '2026-04-10',
        end: '2026-05-10',
        semantics: 'half_open',
      },
    });
    const otherSchedule = buildRecurringServicePeriodRecord({
      recordId: 'rsp_other_schedule',
      scheduleKey: 'schedule:b',
      lifecycleState: 'generated',
      sourceObligation: {
        tenant: 'tenant-1',
        obligationId: 'line-2',
        obligationType: 'contract_line',
        chargeFamily: 'product',
      },
      servicePeriod: {
        start: '2026-06-15',
        end: '2026-07-15',
        semantics: 'half_open',
      },
    });

    const query = buildRecurringServicePeriodListingQuery({
      tenant: 'tenant-1',
      asOf: '2026-05-15',
      scheduleKeys: ['schedule:a', 'schedule:a'],
    });

    expect(query.lifecycleStates).toEqual(['generated', 'edited', 'skipped', 'locked']);
    expect(listRecurringServicePeriodRecords([
      otherSchedule,
      billedHistory,
      futureSkipped,
      futureGenerated,
    ], query).map((record) => record.recordId)).toEqual([
      'rsp_future_generated',
      'rsp_future_skipped',
    ]);

    const narrowed = buildRecurringServicePeriodListingQuery({
      tenant: 'tenant-1',
      asOf: '2026-05-15',
      cadenceOwner: 'client',
      chargeFamilies: ['product'],
    });

    expect(listRecurringServicePeriodRecords([
      futureGenerated,
      otherSchedule,
    ], narrowed).map((record) => record.recordId)).toEqual(['rsp_other_schedule']);
  });
});
