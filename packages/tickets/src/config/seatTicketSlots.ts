import { registerUiSlot } from '@alga-psa/ui/capability/uiSlotRegistry';

/**
 * The seat shape's ticket-screen affordance, contributed as data so it exists only while the
 * `co-managed-seat` capability is served. TicketDetails resolves `ticket.details.responsibility` and mounts
 * the responsibility chip and the hand-to-client-IT action; a host that does not resolve it renders the
 * ordinary ticket. The server-supplied state stays a second, independent gate (defence in depth).
 */
registerUiSlot('ticket.details.responsibility', {
  id: 'co-managed-seat.responsibility',
  capability: 'co-managed-seat',
  order: 10,
});
