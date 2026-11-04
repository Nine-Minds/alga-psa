/**
 * Co-managed IT L3b1: foreign-actor attribution on ticket_audit_logs.
 *
 * L2 (20261029110200) created collaboration_actor_references and deliberately left
 * ticket_audit_logs alone. A shared ticket edit written by a user of the other
 * workspace stores an owner-local actor reference instead of a user id, so the audit
 * row needs actor_reference_id + actor_organization_name, and the display-name snapshot
 * must hold a full name (text).
 *
 * Step 1 of 2: no long locks. The FK and the shape CHECK are added NOT VALID (catalog
 * only, new rows are enforced at once); 20261029140500 validates them. Every ALTER runs
 * under a 2s lock_timeout and is retried. Idempotent.
 */
const TABLE = 'ticket_audit_logs';
const REFERENCES = 'collaboration_actor_references';
const FK = 'ticket_audit_actor_reference_fk';
const SHAPE = 'ticket_audit_actor_reference_shape';
const LOCK_ATTEMPTS = 3;

// LEVERAGE: pattern migration-lock-retry — same savepoint/lock_timeout retry as 20261026090000; a shared migration util should own it once a third migration needs it.
async function withLockRetry(knex, statement) {
  const { rows } = await knex.raw(`SELECT current_setting('lock_timeout') AS value`);
  const prior = rows[0].value;
  const restore = () => knex.raw(`SELECT set_config('lock_timeout', ?, true)`, [prior]);
  for (let attempt = 1; ; attempt += 1) {
    await knex.raw('SAVEPOINT lock_retry');
    try {
      await knex.raw(`SET LOCAL lock_timeout = '2s'`);
      const result = await knex.raw(statement);
      await knex.raw('RELEASE SAVEPOINT lock_retry');
      await restore();
      return result;
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

async function hasConstraint(knex, name) {
  const { rows } = await knex.raw(`SELECT 1 FROM pg_constraint WHERE conname = ? AND conrelid = ?::regclass`, [name, TABLE]);
  return rows.length > 0;
}

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE)) || !(await knex.schema.hasTable(REFERENCES))) return;

  // Nullable, no default: catalog-only.
  await withLockRetry(knex, `ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS actor_reference_id uuid`);
  await withLockRetry(knex, `ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS actor_organization_name text`);

  // varchar(256) -> text is binary-coercible (no rewrite); skipped once it is text.
  const { rows } = await knex.raw(
    `SELECT data_type FROM information_schema.columns WHERE table_name = ? AND column_name = 'actor_display_name' AND table_schema = current_schema()`,
    [TABLE]
  );
  if (rows[0] && rows[0].data_type !== 'text') {
    // migration-lint: allow 3 - varchar(256) to text is binary-coercible, so PostgreSQL rewrites neither the table nor its indexes; the ACCESS EXCLUSIVE lock is catalog-only and bounded by the 2s lock_timeout retry
    await withLockRetry(knex, `ALTER TABLE ${TABLE} ALTER COLUMN actor_display_name TYPE text`);
  }

  if (!(await hasConstraint(knex, FK))) {
    await withLockRetry(knex, `ALTER TABLE ${TABLE} ADD CONSTRAINT ${FK}
      FOREIGN KEY (tenant, actor_reference_id) REFERENCES ${REFERENCES} (tenant, actor_reference_id) NOT VALID`);
  }
  if (!(await hasConstraint(knex, SHAPE))) {
    await withLockRetry(knex, `ALTER TABLE ${TABLE} ADD CONSTRAINT ${SHAPE} CHECK
      (actor_reference_id IS NULL OR (actor_user_id IS NULL AND actor_contact_id IS NULL AND actor_type = 'user'
        AND actor_display_name IS NOT NULL AND actor_organization_name IS NOT NULL)) NOT VALID`);
  }
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable(TABLE))) return;
  const hasReference = await knex.schema.hasColumn(TABLE, 'actor_reference_id');
  if (hasReference && (await knex(TABLE).whereNotNull('actor_reference_id').first())) {
    throw new Error('Cannot remove retained collaboration actor attribution');
  }
  await withLockRetry(knex, `ALTER TABLE ${TABLE} DROP CONSTRAINT IF EXISTS ${SHAPE}`);
  await withLockRetry(knex, `ALTER TABLE ${TABLE} DROP CONSTRAINT IF EXISTS ${FK}`);
  await withLockRetry(knex, `ALTER TABLE ${TABLE} DROP COLUMN IF EXISTS actor_reference_id`);
  await withLockRetry(knex, `ALTER TABLE ${TABLE} DROP COLUMN IF EXISTS actor_organization_name`);
  // Back to the original varchar(256) only when nothing would be truncated.
  if (!(await knex(TABLE).whereRaw('char_length(actor_display_name) > 256').first())) {
    await withLockRetry(knex, `ALTER TABLE ${TABLE} ALTER COLUMN actor_display_name TYPE varchar(256)`);
  }
};
