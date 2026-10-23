import { builtWorkflowPayload, type BuiltWorkflowPayload } from '@alga-psa/event-schemas';
import type { CapacityThresholdReachedEventPayload } from '@alga-psa/event-schemas';

export function buildCapacityThresholdReachedPayload(params: {
  teamId: string;
  date: string;
  capacityLimit: number;
  currentBooked: number;
  triggeredAt?: string;
}): Omit<CapacityThresholdReachedEventPayload, 'tenantId' | 'occurredAt'> & BuiltWorkflowPayload<'CAPACITY_THRESHOLD_REACHED'> {
  return builtWorkflowPayload('CAPACITY_THRESHOLD_REACHED', {
    teamId: params.teamId,
    date: params.date,
    capacityLimit: params.capacityLimit,
    currentBooked: params.currentBooked,
    ...(params.triggeredAt ? { triggeredAt: params.triggeredAt } : {}),
  });
}

