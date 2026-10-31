/**
 * Co-managed routing notifications (CM L5): escalation received, escalation returned, ticket assigned.
 *
 * The recipient set was captured atomically with the transition as `pending` rows in
 * `co_management_deliveries` (packages/co-managed routingOutbox, written from the L3b1 handoff
 * receipt / assignment transaction). This subscriber only delivers those rows. It resolves the
 * served decision ONCE per event, before any `co_management_*` SQL: a psa tenant (or the
 * `FORCE_CAPABILITIES=co-managed:off` kill switch) leaves the rows waiting for the recovery job.
 */
import logger from '@alga-psa/core/logger';
import { isCapabilityServed } from '@alga-psa/core/capability';
import { EventSchemas } from '@alga-psa/event-schemas';
import { coManagedDeliverySeam } from '@shared/lib/coManagedDelivery';
import { getEventBus } from '../index';
import { deliverRouting } from '../../notifications/coManagedRoutingDelivery';

export const CO_MANAGED_ROUTING_EVENTS = ['CO_MANAGED_ESCALATION_RECEIVED', 'CO_MANAGED_ESCALATION_RETURNED', 'CO_MANAGED_TICKET_ASSIGNED'] as const;
type RoutingEventType = (typeof CO_MANAGED_ROUTING_EVENTS)[number];

let isRegistered = false;

export async function handleCoManagedRoutingEvent(event: unknown): Promise<void> {
  const type = (event as { eventType?: RoutingEventType })?.eventType;
  if (!type || !CO_MANAGED_ROUTING_EVENTS.includes(type)) return;
  const { tenantId, operationId } = (EventSchemas as Record<string, { parse(e: unknown): { payload: { tenantId: string; operationId: string } } }>)[type].parse(event).payload;
  // The served decision, once per event, before any co_management_* SQL (the seam re-reads the same cached verdict).
  if (!(await isCapabilityServed('co-managed', tenantId))) return;
  const provider = await coManagedDeliverySeam.resolve(tenantId);
  if (!provider) return;
  const tally = await deliverRouting(provider, tenantId, { sourceId: operationId });
  // A failed row stays `failed`/`sending` in the ledger. The recovery job owns the retry, so a
  // redelivered bus event never fans out a second send.
  logger.info('[CoManagedRoutingSubscriber] Routing delivered', { tenantId, operationId, type, ...tally });
}

export async function registerCoManagedRoutingSubscriber(): Promise<void> {
  if (isRegistered) return;
  for (const type of CO_MANAGED_ROUTING_EVENTS) await getEventBus().subscribe(type, handleCoManagedRoutingEvent);
  isRegistered = true;
  logger.info('[CoManagedRoutingSubscriber] Registered');
}

export async function unregisterCoManagedRoutingSubscriber(): Promise<void> {
  if (!isRegistered) return;
  for (const type of CO_MANAGED_ROUTING_EVENTS) await getEventBus().unsubscribe(type, handleCoManagedRoutingEvent);
  isRegistered = false;
  logger.info('[CoManagedRoutingSubscriber] Unregistered');
}
