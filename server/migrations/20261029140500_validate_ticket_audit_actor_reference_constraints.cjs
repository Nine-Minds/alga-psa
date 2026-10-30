/**
 * Co-managed IT L3b1, step 2 of 2: validate the NOT VALID constraints that
 * 20261029140400 added to ticket_audit_logs. VALIDATE CONSTRAINT takes only
 * SHARE UPDATE EXCLUSIVE, so the full scan does not block reads or writes.
 * Runs outside a transaction so each scan's lock is released as soon as it
 * finishes instead of being held alongside the next one. No session setting
 * is relied on, so each statement may use any pooled connection.
 * Idempotent: already-validated constraints are skipped.
 */
const TABLE = 'ticket_audit_logs';
const CONSTRAINTS = ['ticket_audit_actor_reference_fk', 'ticket_audit_actor_reference_shape'];

exports.config = { transaction: false };

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) return;
  for (const name of CONSTRAINTS) {
    const { rows } = await knex.raw(
      `SELECT convalidated FROM pg_constraint WHERE conname = ? AND conrelid = ?::regclass`,
      [name, TABLE]
    );
    if (rows[0] && rows[0].convalidated === false) {
      await knex.raw(`ALTER TABLE ${TABLE} VALIDATE CONSTRAINT ${name}`);
    }
  }
};

// Validation is not a schema shape worth undoing; 20261029140400 owns removal of the constraints.
exports.down = async function down() {};
