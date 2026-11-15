// CM L6c (1 of 3): durable co-managed sync intent on online_meetings.
// Expand-only: six columns added metadata-only (NULL, or NOT NULL DEFAULT 0 for
// the attempt counter, which N-1 writers never name) and the CHECK added NOT
// VALID. 20261029090200 validates it; 20261029090300 builds the pending index.
// No trigger and no backfill. Each ALTER runs under a 2s lock_timeout and is
// retried (savepoint-scoped) so a busy online_meetings never queues writers.
const CHECK = 'online_meetings_co_managed_sync_intent';
const LOCK_ATTEMPTS = 3;
const COLUMNS = [
  'co_managed_sync_operation_id',
  'co_managed_sync_action',
  'co_managed_sync_requested_at',
  'co_managed_sync_attempts',
  'co_managed_sync_attempted_at',
  'co_managed_sync_last_error',
];

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
  if (!(await knex.schema.hasTable('online_meetings'))) return;
  await withLockRetry(knex, (trx) => trx.raw('ALTER TABLE online_meetings ADD COLUMN IF NOT EXISTS co_managed_sync_operation_id uuid'));
  await withLockRetry(knex, (trx) => trx.raw('ALTER TABLE online_meetings ADD COLUMN IF NOT EXISTS co_managed_sync_action text'));
  await withLockRetry(knex, (trx) => trx.raw('ALTER TABLE online_meetings ADD COLUMN IF NOT EXISTS co_managed_sync_requested_at timestamptz'));
  await withLockRetry(knex, (trx) => trx.raw('ALTER TABLE online_meetings ADD COLUMN IF NOT EXISTS co_managed_sync_attempts integer NOT NULL DEFAULT 0'));
  await withLockRetry(knex, (trx) => trx.raw('ALTER TABLE online_meetings ADD COLUMN IF NOT EXISTS co_managed_sync_attempted_at timestamptz'));
  await withLockRetry(knex, (trx) => trx.raw('ALTER TABLE online_meetings ADD COLUMN IF NOT EXISTS co_managed_sync_last_error text'));
  const { rows } = await knex.raw(
    `SELECT 1 FROM pg_constraint WHERE conname = ? AND conrelid = 'online_meetings'::regclass`,
    [CHECK]
  );
  if (!rows.length) {
    await withLockRetry(knex, (trx) => trx.raw(`ALTER TABLE online_meetings ADD CONSTRAINT online_meetings_co_managed_sync_intent CHECK (
      co_managed_sync_attempts >= 0 AND (
        (co_managed_sync_operation_id IS NULL AND co_managed_sync_action IS NULL AND co_managed_sync_requested_at IS NULL) OR
        (co_managed_sync_operation_id IS NOT NULL AND co_managed_sync_action IN ('update', 'delete') AND co_managed_sync_requested_at IS NOT NULL)
      )) NOT VALID`));
  }
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable('online_meetings'))) return;
  if (await knex.schema.hasColumn('online_meetings', COLUMNS[0])) {
    if (await knex('online_meetings').whereNotNull(COLUMNS[0]).first('meeting_id')) {
      throw new Error('Cannot discard pending co-managed meeting synchronization; reconcile it before rollback');
    }
  }
  await knex.raw('DROP INDEX IF EXISTS online_meetings_co_managed_sync_pending');
  await knex.raw(`ALTER TABLE online_meetings DROP CONSTRAINT IF EXISTS ${CHECK}`);
  for (const name of COLUMNS) {
    await knex.raw(`ALTER TABLE online_meetings DROP COLUMN IF EXISTS ${name}`);
  }
};
