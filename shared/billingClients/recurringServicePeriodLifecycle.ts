import type { RecurringServicePeriodLifecycleState } from '@alga-psa/types';

export const RECURRING_SERVICE_PERIOD_TERMINAL_STATES = [
  'billed',
  'superseded',
  'archived',
] as const satisfies readonly RecurringServicePeriodLifecycleState[];

export const RECURRING_SERVICE_PERIOD_LIFECYCLE_TRANSITIONS = {
  generated: ['edited', 'skipped', 'locked', 'billed', 'superseded', 'archived'],
  edited: ['skipped', 'locked', 'billed', 'superseded', 'archived'],
  skipped: ['edited', 'locked', 'superseded', 'archived'],
  locked: ['billed', 'superseded', 'archived'],
  billed: ['archived'],
  superseded: ['archived'],
  archived: [],
} as const satisfies Record<
  RecurringServicePeriodLifecycleState,
  readonly RecurringServicePeriodLifecycleState[]
>;

export function canTransitionRecurringServicePeriodState(
  from: RecurringServicePeriodLifecycleState,
  to: RecurringServicePeriodLifecycleState,
) {
  return (
    RECURRING_SERVICE_PERIOD_LIFECYCLE_TRANSITIONS[from] as readonly RecurringServicePeriodLifecycleState[]
  ).includes(to);
}

export function isRecurringServicePeriodStateTerminal(
  state: RecurringServicePeriodLifecycleState,
) {
  return (
    RECURRING_SERVICE_PERIOD_TERMINAL_STATES as readonly RecurringServicePeriodLifecycleState[]
  ).includes(state);
}
