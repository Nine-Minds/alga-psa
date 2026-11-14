import { admits } from '@alga-psa/core/capability';
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
 * Pure decision. `seatCapabilityAdmitted` is the `co-managed-seat` release capability (behind
 * `release-v2-0-feature`): with it off no viewer is ever given the seat set.
 */
export function resolveTicketViewerCapabilities(input: {
  surfaceKind: string | null | undefined;
  seatCapabilityAdmitted: boolean;
}): Readonly<TicketCapabilities> {
  if (!input.surfaceKind || !input.seatCapabilityAdmitted) return NATIVE_TICKET_CAPABILITIES;
  return Object.prototype.hasOwnProperty.call(TICKET_CAPABILITIES_BY_PRINCIPAL_KIND, input.surfaceKind)
    ? TICKET_CAPABILITIES_BY_PRINCIPAL_KIND[input.surfaceKind]
    : NATIVE_TICKET_CAPABILITIES;
}

/**
 * The signed-in viewer's ticket capabilities, derived once per request from the S12 principal. An ordinary
 * user (no principal kind) never touches the capability gate, so their request is unchanged.
 */
export async function getViewerTicketCapabilities(tenant: string): Promise<Readonly<TicketCapabilities>> {
  const principal = await getCurrentProductPrincipal();
  if (!principal.surfaceKind) return NATIVE_TICKET_CAPABILITIES;
  const decision = await admits('co-managed-seat', tenant);
  return resolveTicketViewerCapabilities({ surfaceKind: principal.surfaceKind, seatCapabilityAdmitted: decision.admitted });
}
