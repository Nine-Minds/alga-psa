import { CO_MANAGED_SEAT_PRINCIPAL_KIND } from '@alga-psa/co-managed/seatAuthority';
import {
  NATIVE_TICKET_CAPABILITIES,
  SEAT_TECHNICIAN_TICKET_CAPABILITIES,
  type TicketCapabilities,
} from '@alga-psa/tickets/lib/ticketDataSource';
import { getCurrentProductPrincipal } from '@/lib/productAccess';

/**
 * Capability set of the native ticket screen for one principal kind. A kind with no entry (every ordinary
 * user) has the native set. Adding a kind with its own reduced screen means adding one row here.
 */
const TICKET_CAPABILITIES_BY_PRINCIPAL_KIND: Readonly<Record<string, Readonly<TicketCapabilities>>> = Object.freeze({
  [CO_MANAGED_SEAT_PRINCIPAL_KIND]: SEAT_TECHNICIAN_TICKET_CAPABILITIES,
});

/**
 * Pure decision. A principal whose kind has a reduced set always gets it: the release flag decides whether
 * seats exist, never how much of the screen an existing seat technician may see, so it fails closed.
 */
export function resolveTicketViewerCapabilities(input: {
  surfaceKind: string | null | undefined;
}): Readonly<TicketCapabilities> {
  if (!input.surfaceKind) return NATIVE_TICKET_CAPABILITIES;
  return Object.prototype.hasOwnProperty.call(TICKET_CAPABILITIES_BY_PRINCIPAL_KIND, input.surfaceKind)
    ? TICKET_CAPABILITIES_BY_PRINCIPAL_KIND[input.surfaceKind]
    : NATIVE_TICKET_CAPABILITIES;
}

/**
 * The signed-in viewer's ticket capabilities, derived once per request from the S12 principal. No release
 * capability is consulted: an ordinary user is native, a seat technician is reduced.
 */
export async function getViewerTicketCapabilities(): Promise<Readonly<TicketCapabilities>> {
  const principal = await getCurrentProductPrincipal();
  return resolveTicketViewerCapabilities({ surfaceKind: principal.surfaceKind });
}
