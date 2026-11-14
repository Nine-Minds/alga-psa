/**
 * Co-managed seat and workspace shapes, slice S10: why a seat assignment ended.
 *
 * `co_managed_seat_assignments.ended_reason`: `'revoked'` when the technician's seat was taken
 * away and the user deactivated, `'converted'` when the technician became an ordinary MSP user.
 * Both end the assignment (`state = 'revoked'`, `revoked_at` set) and free its seat; they differ in
 * what happens to the user, and admission must tell them apart: a revoked technician is never
 * reactivated as a plain MSP user, while a converted user is one and may be deactivated and
 * reactivated like any other. NULL on a live assignment, and on any assignment ended before this
 * column existed (none was: nothing ended an assignment until this slice).
 *
 * Additive and idempotent. A nullable column with no default is a catalog change only. The CHECK
 * leads with nothing distributed-table specific: it is a row-level constraint, valid on Citus.
 */
const TABLE = 'co_managed_seat_assignments';
const CHECK = 'co_managed_seat_assignments_ended_reason_check';

/** @param { import("knex").Knex } knex */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasColumn(TABLE, 'ended_reason'))) {
    await knex.raw(`ALTER TABLE ${TABLE} ADD COLUMN ended_reason text`);
  }
  const existing = await knex.raw(`SELECT 1 FROM pg_constraint WHERE conname = ? AND conrelid = ?::regclass`, [CHECK, TABLE]);
  if (!existing.rows.length) {
    await knex.raw(`ALTER TABLE ${TABLE} ADD CONSTRAINT ${CHECK}
      CHECK (ended_reason IS NULL OR (state = 'revoked' AND ended_reason IN ('revoked', 'converted')))`);
  }
};

/** @param { import("knex").Knex } knex */
exports.down = async function down(knex) {
  if (await knex.schema.hasTable(TABLE)) {
    await knex.raw(`ALTER TABLE ${TABLE} DROP CONSTRAINT IF EXISTS ${CHECK}`);
    await knex.raw(`ALTER TABLE ${TABLE} DROP COLUMN IF EXISTS ended_reason`);
  }
};
