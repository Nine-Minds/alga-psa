import type { Knex } from 'knex';

/**
 * Server-owned audit stamp for a `tickets` UPDATE.
 *
 * Spread into the update payload so `updated_at` and `updated_by` change in the
 * same statement. Pass `null` for system/integration writes so a previous
 * human's id is never left in place. Do not use for bookkeeping writes
 * (response_state, sla_*, escalated*, email_metadata, follow-ups inside an
 * already-stamped transaction).
 */
// LEVERAGE: pattern ticket-update-stamp — ~30 raw `tickets` writers decide stamping by hand; a single updateTicketRow(trx, tenant, id, patch, actor) writer is the missing layer below.
export function ticketUpdateStamp(knex: Knex | Knex.Transaction, actorUserId: string | null) {
  return { updated_at: knex.fn.now(), updated_by: actorUserId };
}
