import { describe, expect, it } from 'vitest';

import { ContractLineTimingNotAllowedError } from '@shared/billingClients/contractLineTimingRule';
import {
  DEFAULT_RECURRING_AUTHORING_CADENCE_OWNER,
  resolveRecurringAuthoringPolicy,
} from '@shared/billingClients/recurringAuthoringPolicy';

describe('recurring authoring policy', () => {
  it('uses only explicit boundary defaults for cadence owner while still standardizing timing and alignment', () => {
    expect(resolveRecurringAuthoringPolicy({
      lineType: 'Fixed',
      defaultCadenceOwner: DEFAULT_RECURRING_AUTHORING_CADENCE_OWNER,
    })).toEqual({
      cadenceOwner: 'client',
      billingTiming: 'arrears',
      enableProration: false,
      billingCycleAlignment: 'start',
    });
  });

  it('fails fast when neither an explicit cadence owner nor a stored fallback is available', () => {
    expect(() => resolveRecurringAuthoringPolicy({ lineType: 'Fixed' })).toThrow(
      'Recurring authoring requires an explicit cadence owner or a stored cadence owner to reuse.',
    );
  });

  it('preserves explicit billing timing while deriving legacy alignment from partial-period settings', () => {
    expect(
      resolveRecurringAuthoringPolicy({
        lineType: 'Fixed',
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
        lineType: 'Fixed',
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

  // T6: explicit advance on Hourly/Usage is rejected; otherwise arrears wins over any default.
  it.each(['Hourly', 'Usage', 'hourly', 'time'])('rejects explicit advance on %s lines', (lineType) => {
    expect(() => resolveRecurringAuthoringPolicy({
      lineType,
      cadenceOwner: 'client',
      billingTiming: 'advance',
    })).toThrow(ContractLineTimingNotAllowedError);
  });

  it.each(['Hourly', 'Usage'])('forces arrears on %s lines even when a default or stored value says advance', (lineType) => {
    expect(resolveRecurringAuthoringPolicy({
      lineType,
      cadenceOwner: 'client',
      contractWideBillingTiming: 'advance',
      fallbackBillingTiming: 'advance',
    }).billingTiming).toBe('arrears');
  });

  // T7: changing a stored advance Fixed line to Hourly resets timing to arrears.
  it('resets a stored advance timing to arrears when the line type becomes Hourly', () => {
    expect(resolveRecurringAuthoringPolicy({
      lineType: 'Hourly',
      fallbackCadenceOwner: 'client',
      fallbackBillingTiming: 'advance',
    }).billingTiming).toBe('arrears');
  });

  it('keeps advance for Fixed and Product lines', () => {
    for (const lineType of ['Fixed', 'Product', null]) {
      expect(resolveRecurringAuthoringPolicy({
        lineType,
        cadenceOwner: 'client',
        billingTiming: 'advance',
      }).billingTiming).toBe('advance');
    }
  });
});
