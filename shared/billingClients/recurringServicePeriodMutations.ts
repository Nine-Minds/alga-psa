import type { IRecurringServicePeriodRecord } from '@alga-psa/types';

export const RECURRING_SERVICE_PERIOD_MUTATION_OPERATIONS = [
  'edit_boundaries',
  'skip',
  'defer',
  'regenerate',
  'invoice_linkage_repair',
  'archive',
] as const;

export type RecurringServicePeriodMutationOperation =
  (typeof RECURRING_SERVICE_PERIOD_MUTATION_OPERATIONS)[number];

export interface IRecurringServicePeriodMutationDecision {
  allowed: boolean;
  reason: string;
}

export function evaluateRecurringServicePeriodMutationPermission(
  record: IRecurringServicePeriodRecord,
  operation: RecurringServicePeriodMutationOperation,
): IRecurringServicePeriodMutationDecision {
  switch (record.lifecycleState) {
    case 'generated':
    case 'edited':
    case 'skipped':
      if (operation === 'invoice_linkage_repair') {
        return {
          allowed: false,
          reason: 'Invoice linkage repair is only valid after the service period is locked or billed.',
        };
      }
      return {
        allowed: true,
        reason: 'Future unlocked service periods can still be updated through normal edit or regeneration flows.',
      };
    case 'locked':
    case 'billed':
      if (operation === 'invoice_linkage_repair' || operation === 'archive') {
        return {
          allowed: true,
          reason: 'Locked or billed service periods are immutable except through explicitly allowed corrective flows.',
        };
      }
      return {
        allowed: false,
        reason: 'Locked or billed service periods cannot be edited, skipped, deferred, or regenerated in place.',
      };
    case 'superseded':
    case 'archived':
      return {
        allowed: false,
        reason: 'Superseded or archived service periods are historical records and cannot be mutated further.',
      };
  }
}
