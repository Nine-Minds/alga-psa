import type { CoManagedTicketRoutingNotification } from '@alga-psa/co-managed';
export function coManagedRoutingPresentation(message: CoManagedTicketRoutingNotification) {
  const link = message.ownerLocal ? `/msp/tickets/${message.resource.id}`
    : `/msp/co-management/tickets/${message.resource.tenant}/${message.resource.relationshipId}/${message.resource.id}`;
  return { link, data: { ticketNumber: message.ticketNumber ?? '—', ticketTitle: message.ticketTitle ?? '—' },
    metadata: { coManaged: { version: 4, kind: 'ticket_routing', eventId: message.eventId, transition: message.transition, resource: message.resource } } };
}
