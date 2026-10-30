// CM L4a (1 of 5): conversation audience on the hot comment tables.
// Expand-only. comment_threads.collaboration_audience and the three comments.actor_*
// attribution columns are nullable metadata-only adds (NULL = legacy, so N-1 writers never
// name them). Both CHECKs and the FK are added NOT VALID; 20261030100100 validates them in
// a separate non-transactional file. No trigger, no backfill, no default. Each ALTER runs
// under a 2s lock_timeout and is retried (savepoint-scoped) so a busy comments or
// comment_threads table never queues writers behind this migration.
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

async function hasConstraint(knex, table, name) {
  const { rows } = await knex.raw(`SELECT 1 FROM pg_constraint WHERE conname = ? AND conrelid = ?::regclass`, [name, table]);
  return rows.length > 0;
}

exports.up = async function up(knex) {
  if (await knex.schema.hasTable('comment_threads')) {
    await withLockRetry(knex, (trx) => trx.raw('ALTER TABLE comment_threads ADD COLUMN IF NOT EXISTS collaboration_audience varchar(32)'));
    if (!(await hasConstraint(knex, 'comment_threads', 'comment_threads_collaboration_audience_check'))) {
      // NULL retains legacy semantics. A labelled thread's visibility flag must agree with it.
      await withLockRetry(knex, (trx) => trx.raw(`ALTER TABLE comment_threads ADD CONSTRAINT comment_threads_collaboration_audience_check
        CHECK (collaboration_audience IS NULL OR (collaboration_audience IN ('requester', 'shared_it', 'organization_private')
          AND is_internal = (collaboration_audience <> 'requester'))) NOT VALID`));
    }
  }
  if (await knex.schema.hasTable('comments')) {
    await withLockRetry(knex, (trx) => trx.raw('ALTER TABLE comments ADD COLUMN IF NOT EXISTS actor_reference_id uuid'));
    await withLockRetry(knex, (trx) => trx.raw('ALTER TABLE comments ADD COLUMN IF NOT EXISTS actor_display_name text'));
    await withLockRetry(knex, (trx) => trx.raw('ALTER TABLE comments ADD COLUMN IF NOT EXISTS actor_organization_name text'));
    if (!(await hasConstraint(knex, 'comments', 'comments_collaboration_actor_check'))) {
      await withLockRetry(knex, (trx) => trx.raw(`ALTER TABLE comments ADD CONSTRAINT comments_collaboration_actor_check CHECK (
        (actor_reference_id IS NULL AND actor_display_name IS NULL AND actor_organization_name IS NULL) OR
        (actor_reference_id IS NOT NULL AND user_id IS NULL AND contact_id IS NULL AND author_type IS NOT NULL AND author_type = 'internal'
          AND actor_display_name IS NOT NULL AND char_length(actor_display_name) > 0
          AND actor_organization_name IS NOT NULL AND char_length(actor_organization_name) > 0)) NOT VALID`));
    }
    if ((await knex.schema.hasTable('collaboration_actor_references')) && !(await hasConstraint(knex, 'comments', 'comments_collaboration_actor_fk'))) {
      await withLockRetry(knex, (trx) => trx.raw(`ALTER TABLE comments ADD CONSTRAINT comments_collaboration_actor_fk
        FOREIGN KEY (tenant, actor_reference_id) REFERENCES collaboration_actor_references (tenant, actor_reference_id) NOT VALID`));
    }
  }
};

exports.down = async function down(knex) {
  if (await knex.schema.hasColumn('comments', 'actor_reference_id')) {
    if (await knex('comments').whereNotNull('actor_reference_id').first('comment_id')) {
      throw new Error('Cannot discard retained collaboration attribution');
    }
  }
  if (await knex.schema.hasColumn('comment_threads', 'collaboration_audience')) {
    if (await knex('comment_threads').whereNotNull('collaboration_audience').first('thread_id')) {
      throw new Error('Cannot discard retained collaboration audiences');
    }
  }
  await knex.raw('DROP INDEX IF EXISTS comments_collaboration_actor_idx');
  await knex.raw('DROP INDEX IF EXISTS comment_threads_collaboration_audience_idx');
  await knex.raw('ALTER TABLE comments DROP CONSTRAINT IF EXISTS comments_collaboration_actor_fk');
  await knex.raw('ALTER TABLE comments DROP CONSTRAINT IF EXISTS comments_collaboration_actor_check');
  await knex.raw('ALTER TABLE comment_threads DROP CONSTRAINT IF EXISTS comment_threads_collaboration_audience_check');
  for (const name of ['actor_reference_id', 'actor_display_name', 'actor_organization_name']) {
    await knex.raw(`ALTER TABLE comments DROP COLUMN IF EXISTS ${name}`);
  }
  await knex.raw('ALTER TABLE comment_threads DROP COLUMN IF EXISTS collaboration_audience');
};
