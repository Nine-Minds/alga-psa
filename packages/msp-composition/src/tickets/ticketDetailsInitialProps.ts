import type { IUser } from '@alga-psa/types';

/**
 * Consolidated ticket data fields (from getConsolidatedTicketData) that name the
 * people behind the ticket header's "Created …" / "Updated … by …" line.
 */
interface ConsolidatedTicketActors {
  createdByUser?: IUser | null;
  updatedByUser?: IUser | null;
}

/**
 * Maps consolidated ticket data to the TicketDetails `initial*` actor props.
 * Every drawer host spreads this so the header names the last updater on open
 * and the hosts cannot drift apart again.
 */
export function ticketDetailsInitialProps(data: ConsolidatedTicketActors) {
  return {
    initialCreatedByUser: data.createdByUser ?? null,
    initialUpdatedByUser: data.updatedByUser ?? null,
  };
}
