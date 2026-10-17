import type { Knex } from 'knex';

/**
 * `tickets.status_changed_at` is the moment a ticket entered its current status. It is the anchor of the
 * `ticket.status_age` date trigger ("ticket has been in status S for N days").
 *
 * The tickets table is Citus-distributed and carries no DB triggers, so every application path that
 * writes `tickets.status_id` spreads this patch into its UPDATE. The CASE reads the row's value from
 * before the update, so the clock only moves when the status really changes (a re-save of the same
 * status keeps it) and no prior read is needed. New rows get `now()` from the column default.
 *
 * The timestamp is bound as a parameter, not written as `now()`: Citus rejects non-IMMUTABLE functions
 * inside CASE/COALESCE in UPDATEs on distributed tables.
 *
 * Use as: `.update({ ...data, ...ticketStatusClockPatch(db, data.status_id) })`.
 */
export function ticketStatusClockPatch(
  db: Pick<Knex, 'raw'>,
  newStatusId: string | null | undefined,
  at: Date | string = new Date()
): { status_changed_at?: Knex.Raw } {
  if (newStatusId === undefined) return {};
  return {
    status_changed_at: db.raw(
      'CASE WHEN status_id IS DISTINCT FROM ?::uuid THEN ?::timestamptz ELSE status_changed_at END',
      [newStatusId, toIso(at)]
    ),
  };
}

/**
 * Same patch for an update that writes the status through a column reference rather than a literal
 * (for example `status_id = (SELECT ...)`): pass the SQL fragment and its bindings.
 */
export function ticketStatusClockPatchFromSql(
  db: Pick<Knex, 'raw'>,
  statusIdSql: string,
  bindings: readonly unknown[] = [],
  at: Date | string = new Date()
): { status_changed_at: Knex.Raw } {
  return {
    status_changed_at: db.raw(
      `CASE WHEN status_id IS DISTINCT FROM (${statusIdSql}) THEN ?::timestamptz ELSE status_changed_at END`,
      [...bindings, toIso(at)] as Knex.RawBinding[]
    ),
  };
}

function toIso(at: Date | string): string {
  return at instanceof Date ? at.toISOString() : at;
}
