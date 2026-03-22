import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RECURRING_AUTHORING_CADENCE_OWNER,
  resolveRecurringAuthoringPolicy,
} from '@shared/billingClients/recurringAuthoringPolicy';

describe('recurring authoring policy', () => {
  it('uses only explicit boundary defaults for cadence owner while still standardizing timing and alignment', () => {
    expect(resolveRecurringAuthoringPolicy({
      defaultCadenceOwner: DEFAULT_RECURRING_AUTHORING_CADENCE_OWNER,
    })).toEqual({
      cadenceOwner: 'client',
      billingTiming: 'arrears',
      enableProration: false,
      billingCycleAlignment: 'start',
    });
  });

  it('fails fast when neither an explicit cadence owner nor a stored fallback is available', () => {
    expect(() => resolveRecurringAuthoringPolicy({})).toThrow(
      'Recurring authoring requires an explicit cadence owner or a stored cadence owner to reuse.',
    );
  });

  it('preserves explicit billing timing while deriving legacy alignment from partial-period settings', () => {
    expect(
      resolveRecurringAuthoringPolicy({
        cadenceOwner: 'client',
        billingTiming: 'advance',
        enableProration: true,
      }),
    ).toEqual({
      cadenceOwner: 'client',
      billingTiming: 'advance',
      enableProration: true,
      billingCycleAlignment: 'prorated',
    });
  });

  it('reuses stored cadence and timing defaults when a touched writer omits them on update', () => {
    expect(
      resolveRecurringAuthoringPolicy({
        fallbackCadenceOwner: 'client',
        fallbackBillingTiming: 'advance',
      }),
    ).toEqual({
      cadenceOwner: 'client',
      billingTiming: 'advance',
      enableProration: false,
      billingCycleAlignment: 'start',
    });
  });
});
