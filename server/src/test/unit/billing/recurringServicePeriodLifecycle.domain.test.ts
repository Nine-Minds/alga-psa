import { describe, expect, it } from 'vitest';

import {
  canTransitionRecurringServicePeriodState,
  isRecurringServicePeriodStateTerminal,
  RECURRING_SERVICE_PERIOD_LIFECYCLE_TRANSITIONS,
  RECURRING_SERVICE_PERIOD_TERMINAL_STATES,
} from '@alga-psa/shared/billingClients/recurringServicePeriodLifecycle';

describe('recurring service period lifecycle', () => {
  it('T283: generated, edited, skipped, locked, billed, superseded, and archived states transition according to the documented model', () => {
    expect(RECURRING_SERVICE_PERIOD_LIFECYCLE_TRANSITIONS.generated).toEqual([
      'edited',
      'skipped',
      'locked',
      'billed',
      'superseded',
      'archived',
    ]);
    expect(RECURRING_SERVICE_PERIOD_LIFECYCLE_TRANSITIONS.locked).toEqual([
      'billed',
      'superseded',
      'archived',
    ]);
    expect(RECURRING_SERVICE_PERIOD_LIFECYCLE_TRANSITIONS.archived).toEqual([]);
    expect(RECURRING_SERVICE_PERIOD_TERMINAL_STATES).toEqual([
      'billed',
      'superseded',
      'archived',
    ]);

    expect(canTransitionRecurringServicePeriodState('generated', 'edited')).toBe(true);
    expect(canTransitionRecurringServicePeriodState('edited', 'skipped')).toBe(true);
    expect(canTransitionRecurringServicePeriodState('locked', 'billed')).toBe(true);
    expect(canTransitionRecurringServicePeriodState('skipped', 'billed')).toBe(false);
    expect(canTransitionRecurringServicePeriodState('billed', 'edited')).toBe(false);
    expect(canTransitionRecurringServicePeriodState('archived', 'generated')).toBe(false);

    expect(isRecurringServicePeriodStateTerminal('generated')).toBe(false);
    expect(isRecurringServicePeriodStateTerminal('locked')).toBe(false);
    expect(isRecurringServicePeriodStateTerminal('billed')).toBe(true);
    expect(isRecurringServicePeriodStateTerminal('superseded')).toBe(true);
    expect(isRecurringServicePeriodStateTerminal('archived')).toBe(true);
  });
});
