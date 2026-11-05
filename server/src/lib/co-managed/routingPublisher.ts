import logger from '@alga-psa/core/logger';
import type { CoManagedSharedResource } from '@alga-psa/co-managed';
import { publishEvent } from '../eventBus/publishers';

type RoutingEvent = 'CO_MANAGED_ESCALATION_RECEIVED' | 'CO_MANAGED_ESCALATION_RETURNED' | 'CO_MANAGED_TICKET_ASSIGNED';

/**
 * Wake the routing subscriber after the transition committed. The recipients are already durable as
 * pending ledger rows, so this is only a prompt: a failed publish is logged and the recovery job
 * delivers the rows instead. Never throws into the user's action.
 */
export async function publishCoManagedRouting(eventType: RoutingEvent, resource: CoManagedSharedResource, operationId: string): Promise<void> {
  try {
    await publishEvent({
      eventType,
      payload: { tenantId: resource.tenant, ticketId: resource.id, relationshipId: resource.relationshipId, operationId, occurredAt: new Date().toISOString() },
    } as Parameters<typeof publishEvent>[0]);
  } catch (error) {
    logger.warn('[CoManagedRouting] publish failed; recovery will deliver the pending rows', { eventType, operationId, error: error instanceof Error ? error.message : String(error) });
  }
}
