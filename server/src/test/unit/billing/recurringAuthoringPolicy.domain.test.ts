import { describe, expect, it } from 'vitest';

import { resolveRecurringAuthoringPolicy } from '@shared/billingClients/recurringAuthoringPolicy';

describe('recurring authoring policy', () => {
  it('uses one authoritative default for cadence owner, billing timing, and partial-period alignment', () => {
    expect(resolveRecurringAuthoringPolicy({})).toEqual({
      cadenceOwner: 'client',
      billingTiming: 'arrears',
      enableProration: false,
      billingCycleAlignment: 'start',
    });
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
