import { z } from 'zod';
import { defineEventExtension } from './define';

/**
 * Routing events for a shared (co-managed) ticket (CM L5).
 *
 * Published after commit by the server actions that apply an escalation, a hand-back/take-back/revoke,
 * or an MSP assignment. The payload names only the tenant, ticket and the operation id: the
 * subscriber re-reads recipients from the handoff receipt / sponsor reference, so a replayed event
 * can never widen who is told. Published only for tenants the capability gate serves.
 */
const routingPayload = z.object({
  tenantId: z.string().uuid(),
  ticketId: z.string().uuid(),
  relationshipId: z.string().uuid(),
  /** Idempotency key: the handoff/assignment command's operation id. */
  operationId: z.string().uuid(),
  occurredAt: z.string().optional(),
});

export const coManagedRoutingExtension = defineEventExtension({
  name: 'co-managed-routing',
  eventTypes: ['CO_MANAGED_ESCALATION_RECEIVED', 'CO_MANAGED_ESCALATION_RETURNED', 'CO_MANAGED_TICKET_ASSIGNED'],
  payloadSchemas: {
    CO_MANAGED_ESCALATION_RECEIVED: routingPayload.describe('Payload for CO_MANAGED_ESCALATION_RECEIVED'),
    CO_MANAGED_ESCALATION_RETURNED: routingPayload.describe('Payload for CO_MANAGED_ESCALATION_RETURNED'),
    CO_MANAGED_TICKET_ASSIGNED: routingPayload.describe('Payload for CO_MANAGED_TICKET_ASSIGNED'),
  },
});

export type CoManagedRoutingEventType = (typeof coManagedRoutingExtension.eventTypes)[number];
export type CoManagedRoutingPayload = z.infer<typeof routingPayload>;
