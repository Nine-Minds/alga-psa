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
 */

/** One selected ticket, with the revision of the row the user selected it from. */
export interface BulkHandoffItem {
  ticketId: string;
  expectedRevision: number;
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
 * The operation id of one ticket's handoff in one submission: the same on every retry of the submission, different
 * for every ticket and every direction. The submission id is fixed by the caller when the dialog opens, so a retry
 * of the whole submission (a lost response, a double click) finds each ticket's original receipt instead of handing
 * the ticket over twice. Shaped as a version 5 UUID: the commands take UUIDs.
 */
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
