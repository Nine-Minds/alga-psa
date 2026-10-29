// CM L4a (6 of 8): the retained participation evidence store may now hold published shared
// conversation captures ('conversation') and the author's own organisation-private history
// ('private_conversation'). Expand-only: the source_type CHECK is replaced by a wider one added
// NOT VALID; 20261029120501 validates it in a separate non-transactional file. Each ALTER runs
// under a 2s lock_timeout and is retried. DDL cannot take bind parameters, so the (constant)
// source list is inlined. Idempotent: a replay finds the widened definition and returns.
const TABLE = 'co_managed_participation_evidence';

const LOCK_ATTEMPTS = 3;

async function withLockRetry(knex, statement) {
  const { rows } = await knex.raw(`SELECT current_setting('lock_timeout') AS value`);
  const prior = rows[0].value;
  const restore = () => knex.raw(`SELECT set_config('lock_timeout', ?, true)`, [prior]);
  for (let attempt = 1; ; attempt += 1) {
    await knex.raw('SAVEPOINT lock_retry');
    try {
      await knex.raw(`SET LOCAL lock_timeout = '2s'`);
      await statement(knex);
      await knex.raw('RELEASE SAVEPOINT lock_retry');
      await restore();
      return;
    } catch (error) {
      try {
        await knex.raw('ROLLBACK TO SAVEPOINT lock_retry');
        await restore();
      } catch {
        throw error;
      }
      if (error.code !== '55P03' || attempt >= LOCK_ATTEMPTS) throw error;
    }
  }
}

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) return;
  const { rows } = await knex.raw(
    `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
      WHERE conrelid = ?::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%source_type%'`, [TABLE]);
  if (rows.some((row) => row.definition.includes("'private_conversation'"))) return;
  // Postgres auto-named the original column CHECK <table>_<column>_check, which is NAME.
  await withLockRetry(knex, (trx) => trx.raw('ALTER TABLE co_managed_participation_evidence DROP CONSTRAINT IF EXISTS co_managed_participation_evidence_source_type_check'));
  await withLockRetry(knex, (trx) => trx.raw(`ALTER TABLE co_managed_participation_evidence ADD CONSTRAINT co_managed_participation_evidence_source_type_check
    CHECK (source_type IN ('ticket_handoff', 'work_audit', 'work_snapshot', 'conversation', 'private_conversation')) NOT VALID`));
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable(TABLE))) return;
  if (await knex(TABLE).whereIn('source_type', ['conversation', 'private_conversation']).first()) {
    throw new Error('Cannot remove retained conversation evidence');
  }
  await knex.raw('ALTER TABLE co_managed_participation_evidence DROP CONSTRAINT IF EXISTS co_managed_participation_evidence_source_type_check');
  await knex.raw("ALTER TABLE co_managed_participation_evidence ADD CONSTRAINT co_managed_participation_evidence_source_type_check CHECK (source_type IN ('ticket_handoff', 'work_audit', 'work_snapshot'))");
};
