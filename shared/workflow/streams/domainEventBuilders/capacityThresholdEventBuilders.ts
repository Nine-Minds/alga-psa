import type { CapacityThresholdReachedEventPayload } from '../../runtime/schemas/schedulingEventSchemas';

export function buildCapacityThresholdReachedPayload(params: {
  teamId: string;
  date: string;
  capacityLimit: number;
  currentBooked: number;
  triggeredAt?: string;
}): Omit<CapacityThresholdReachedEventPayload, 'tenantId' | 'occurredAt'> {
  return {
    teamId: params.teamId,
    date: params.date,
    capacityLimit: params.capacityLimit,
    currentBooked: params.currentBooked,
    ...(params.triggeredAt ? { triggeredAt: params.triggeredAt } : {}),
  };
}

