/**
 * Bulk handoff, as a set of independent single handoffs.
 *
 * Each selected ticket is its own unit of work: it is checked, handed over (or refused) and reported on
 * its own, in its own transaction inside the command. One ticket's refusal, or its unexpected failure,
 * never stops the others, and a ticket that does not qualify is never acted on. The pure parts live
 * here, away from the action layer, so they can be pinned without a database:
 *
 *   (the idempotency key lives in ./bulkHandoffOperationId: it needs node:crypto, and this module is
 *   imported by client components)
 *   - `runBulkHandoff`: the isolating loop and the shape of its result.
 *   - `selectBulkHandoffTickets`: the selected rows as the dialog submits them, with the revision each must name.
 */

/** One selected ticket, with the revision of the row the user selected it from. */
export interface BulkHandoffItem {
  ticketId: string;
  expectedRevision: number;
}

/** One selected ticket as the list showed it: how it is named to the user, and the revision its handoff must name. */
export interface BulkHandoffTicket {
  ticket_id: string;
  ticket_number?: string | null;
  title?: string | null;
  /** The revision the handoff names. Absent: the row's seat state was never read, so it is not submitted. */
  seat_responsibility_revision?: number;
}

/** A selected row as the list knows it. */
export interface BulkHandoffSourceRow {
  ticket_id?: string | null;
  ticket_number?: string | null;
  title?: string | null;
  seat_responsibility_revision?: number;
}

/**
 * The selected tickets as the handoff dialog submits them, in selection order. `listRows` are the list page's rows:
 * their seat state was read with the page, so one without a revision has no responsibility at all (its client has no
 * seat arrangement). It is submitted at revision 0 and the server names the actual refusal; reporting it as "not
 * loaded" would send the user to a page they are already on. `otherRows` (smart search results) carry no seat state:
 * without a revision they stay unloaded and are not submitted.
 */
export function selectBulkHandoffTickets(
  selectedIds: readonly string[],
  listRows: readonly BulkHandoffSourceRow[],
  otherRows: readonly BulkHandoffSourceRow[] = [],
): BulkHandoffTicket[] {
  const listed = new Map(listRows.flatMap((row) => (row.ticket_id ? [[row.ticket_id, row] as const] : [])));
  const other = new Map(otherRows.flatMap((row) => (row.ticket_id ? [[row.ticket_id, row] as const] : [])));
  return selectedIds.map((ticketId) => {
    const row = listed.get(ticketId) ?? other.get(ticketId);
    const revision = typeof row?.seat_responsibility_revision === 'number'
      ? row.seat_responsibility_revision
      : listed.has(ticketId) ? 0 : undefined;
    return {
      ticket_id: ticketId,
      ticket_number: row?.ticket_number ?? null,
      title: row?.title ?? null,
      ...(revision !== undefined ? { seat_responsibility_revision: revision } : {}),
    };
  });
}

/** The most tickets one submission may name. */
export const MAX_BULK_HANDOFF_TICKETS = 100;

export interface BulkHandoffFailure {
  /** The refusal, in the caller's locale. */
  message: string;
  /** The translation key the message came from, for a client that translates again. */
  messageKey?: string;
}

/** What happened to one ticket: handed over (with where it now stands) or refused (with why). */
export type BulkHandoffTicketResult<State> =
  | { ticketId: string; ok: true; state: State }
  | ({ ticketId: string; ok: false } & BulkHandoffFailure);

export interface BulkHandoffSummary {
  succeeded: string[];
  failed: Array<{ ticketId: string } & BulkHandoffFailure>;
}

export function summarizeBulkHandoff<State>(results: readonly BulkHandoffTicketResult<State>[]): BulkHandoffSummary {
  const summary: BulkHandoffSummary = { succeeded: [], failed: [] };
  for (const result of results) {
    if (result.ok) summary.succeeded.push(result.ticketId);
    else summary.failed.push({ ticketId: result.ticketId, message: result.message, ...(result.messageKey ? { messageKey: result.messageKey } : {}) });
  }
  return summary;
}

/**
 * Runs `handOne` for each distinct ticket, one at a time, and returns one result per ticket in selection order.
 * `handOne` returns the ticket's new state or its failure; if it throws, that is that ticket's failure
 * (`onUnexpected` says how it is reported) and the loop goes on. A ticket named twice is handed over once.
 */
export async function runBulkHandoff<State>(
  items: readonly BulkHandoffItem[],
  handOne: (item: BulkHandoffItem) => Promise<{ state: State } | BulkHandoffFailure>,
  onUnexpected: (item: BulkHandoffItem, error: unknown) => Promise<BulkHandoffFailure> | BulkHandoffFailure,
): Promise<Array<BulkHandoffTicketResult<State>>> {
  const results: Array<BulkHandoffTicketResult<State>> = [];
  const seen = new Set<string>();
  for (const item of items) {
    const key = item.ticketId.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const outcome = await handOne(item);
      results.push('state' in outcome
        ? { ticketId: item.ticketId, ok: true, state: outcome.state }
        : { ticketId: item.ticketId, ok: false, ...outcome });
    } catch (error) {
      let failure: BulkHandoffFailure;
      try {
        failure = await onUnexpected(item, error);
      } catch {
        failure = { message: 'This ticket could not be handed over.' };
      }
      results.push({ ticketId: item.ticketId, ok: false, ...failure });
    }
  }
  return results;
}
