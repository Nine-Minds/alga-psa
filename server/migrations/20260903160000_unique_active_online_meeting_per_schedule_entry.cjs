/**
 * Migration: enforce one non-cancelled online meeting per schedule entry.
 *
 * scheduleTeamsMeeting's existing-entry mode rejects a second meeting for an
 * entry, but an application-level check-then-insert alone is race-prone. This
 * backs that contract with a partial unique index on the distributed table's
 * tenant column plus schedule_entry_id, so concurrent creates cannot both
 * land. Cancelled meetings are excluded: cancelling and re-creating a meeting
 * for the same entry stays legal.
 *
 * Before creating the index, duplicate non-cancelled rows are collapsed: the
 * latest keeps flowing (matching the app, which surfaces the most recent
 * meeting), earlier ones are marked cancelled.
 */

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  // ── 1. Collapse existing duplicate non-cancelled meetings (keep the latest) ──
  await knex.raw(`
    UPDATE online_meetings o
    SET status = 'cancelled',
        updated_at = now()
    WHERE o.schedule_entry_id IS NOT NULL
      AND o.status <> 'cancelled'
      AND EXISTS (
        SELECT 1
        FROM online_meetings k
        WHERE k.tenant = o.tenant
          AND k.schedule_entry_id = o.schedule_entry_id
          AND k.status <> 'cancelled'
          AND (k.created_at > o.created_at
               OR (k.created_at = o.created_at AND k.meeting_id > o.meeting_id))
      )
  `);

  // ── 2. Enforce one active meeting per schedule entry ─────────────────────
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS online_meetings_schedule_entry_active_unique
    ON online_meetings (tenant, schedule_entry_id)
    WHERE schedule_entry_id IS NOT NULL AND status <> 'cancelled'
  `);
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  // Collapsed duplicates are not resurrected — their cancellation is a fact.
  await knex.raw('DROP INDEX IF EXISTS online_meetings_schedule_entry_active_unique');
};

exports.config = { transaction: false };
