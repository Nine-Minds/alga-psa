/**
 * The seat technician's views of the native ticket list: Client IT, With MSP, Unassigned, All.
 *
 * A view is data (a label and predicate clauses over the ticket query schema), contributed to the
 * ticket list through its view-provider seam. This module decides only WHO is offered them and
 * WHAT each means; the list composes the selected view into the same filter group that produces
 * its rows and its counts, ANDed with the technician's read authorization. The client and board
 * scope is that authorization (`seatAuthority`: own client, in-scope boards), compiled to SQL by
 * the kernel for every list read, so no view, client filter or board filter can widen it.
 *
 * Offered only to a subject the seat resolver governs who holds a live scope, and only while the
 * seat shape is released for the tenant (`release-v2-0-feature` on, `co-managed-seat` served).
 * Recognising a seat technician reads the facts loaded with the subject, so every other principal
 * resolves to "no views" without a query or a flag evaluation.
 *
 * Registration is a side effect of importing this module; `./capability` imports it.
 */
import {
  registerTicketListViewProvider,
  type TicketListViewDefinition,
  type TicketListViewProvider,
} from '@alga-psa/tickets/lib/ticketListViews';
import { coManagedSeatAuthority } from './seatAuthority';
import { coManagedSeatReleased } from './seatRelease';

export const CO_MANAGED_SEAT_LIST_VIEWS_PROVIDER_ID = 'co-managed-seat';

export type CoManagedSeatListViewKey = 'client_it' | 'msp' | 'unassigned' | 'all';

/** The four views, in the order they are shown. Pure: the same list for every seat technician. */
export function coManagedSeatTicketListViews(): readonly (TicketListViewDefinition & { key: CoManagedSeatListViewKey })[] {
  return [
    { key: 'client_it', labelKey: 'dashboard.seatViews.clientIt', defaultLabel: 'Client IT',
      clauses: [{ path: 'seat_responsibility', operator: 'equals', value: 'client_it' }] },
    { key: 'msp', labelKey: 'dashboard.seatViews.msp', defaultLabel: 'With MSP',
      clauses: [{ path: 'seat_responsibility', operator: 'equals', value: 'msp' }] },
    { key: 'unassigned', labelKey: 'dashboard.seatViews.unassigned', defaultLabel: 'Unassigned',
      clauses: [{ path: 'assigned_to', operator: 'is_empty' }] },
    { key: 'all', labelKey: 'dashboard.seatViews.all', defaultLabel: 'All', clauses: [] },
  ];
}

export const coManagedSeatListViewProvider: TicketListViewProvider = async ({ tenant, subject }) => {
  const authority = coManagedSeatAuthority(subject);
  // Not a seat technician: nothing was read and nothing is asked. A seat technician with no live
  // scope is offered no view; the kernel's closed baseline already returns them no tickets.
  if (!authority?.scope) return null;
  return await coManagedSeatReleased(tenant) ? coManagedSeatTicketListViews() : null;
};

/** Idempotent: registering again replaces the earlier registration. */
export function registerCoManagedSeatListViews(): void {
  registerTicketListViewProvider(CO_MANAGED_SEAT_LIST_VIEWS_PROVIDER_ID, coManagedSeatListViewProvider);
}

registerCoManagedSeatListViews();
