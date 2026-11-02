// CM L4c (1 of 4): qualified attribution and revisions on project_task_comments.
// Expand-only. project_task_comments is Citus-distributed by tenant, so every addition is a
// nullable, metadata-only column; the CHECK and the FK are NOT VALID here and validated in
// 20261031100200 (transaction:false). No default, no backfill, no trigger: a NULL
// collaboration_revision means revision 1 and readers default it; N-1 writers never name
// these columns and keep inserting a user_id. user_id becomes nullable so a collaborator
// from another organisation (who has no users row here) can author a row through an
// actor reference. Each ALTER runs under a short lock_timeout with a savepoint retry so a busy
// comments table never queues writers behind the migration.
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
      try { await knex.raw('ROLLBACK TO SAVEPOINT lock_retry'); await restore(); } catch { throw error; }
      if (error.code !== '55P03' || attempt >= LOCK_ATTEMPTS) throw error;
    }
  }
}

async function hasConstraint(knex, table, name) {
  const { rows } = await knex.raw(`SELECT 1 FROM pg_constraint WHERE conname = ? AND conrelid = ?::regclass`, [name, table]);
  return rows.length > 0;
}

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('project_task_comments'))) return;
  await withLockRetry(knex, (trx) => trx.raw('ALTER TABLE project_task_comments ADD COLUMN IF NOT EXISTS actor_reference_id uuid'));
  await withLockRetry(knex, (trx) => trx.raw('ALTER TABLE project_task_comments ADD COLUMN IF NOT EXISTS actor_display_name text'));
  await withLockRetry(knex, (trx) => trx.raw('ALTER TABLE project_task_comments ADD COLUMN IF NOT EXISTS actor_organization_name text'));
  await withLockRetry(knex, (trx) => trx.raw('ALTER TABLE project_task_comments ADD COLUMN IF NOT EXISTS collaboration_revision integer'));
  await withLockRetry(knex, (trx) => trx.raw('ALTER TABLE project_task_comments ALTER COLUMN user_id DROP NOT NULL'));
  if (!(await hasConstraint(knex, 'project_task_comments', 'project_task_comments_revision_positive'))) {
    await withLockRetry(knex, (trx) => trx.raw(`ALTER TABLE project_task_comments ADD CONSTRAINT project_task_comments_revision_positive
      CHECK (collaboration_revision IS NULL OR collaboration_revision > 0) NOT VALID`));
  }
  if ((await knex.schema.hasTable('collaboration_actor_references')) && !(await hasConstraint(knex, 'project_task_comments', 'project_task_comments_collaboration_actor_fk'))) {
    await withLockRetry(knex, (trx) => trx.raw(`ALTER TABLE project_task_comments ADD CONSTRAINT project_task_comments_collaboration_actor_fk
      FOREIGN KEY (tenant, actor_reference_id) REFERENCES collaboration_actor_references (tenant, actor_reference_id) NOT VALID`));
  }
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasColumn('project_task_comments', 'actor_reference_id'))) return;
  if (await knex('project_task_comments').whereNotNull('actor_reference_id').orWhereNotNull('collaboration_revision').first('task_comment_id')) {
    throw new Error('Cannot discard retained project task collaboration attribution or revisions');
  }
  if (await knex('project_task_comments').whereNull('user_id').first('task_comment_id')) {
    throw new Error('Cannot restore NOT NULL user_id while authorless task comments exist');
  }
  await knex.raw('DROP INDEX IF EXISTS project_task_comments_collaboration_actor_idx');
  await knex.raw('ALTER TABLE project_task_comments DROP CONSTRAINT IF EXISTS project_task_comments_collaboration_actor_fk');
  await knex.raw('ALTER TABLE project_task_comments DROP CONSTRAINT IF EXISTS project_task_comments_revision_positive');
  await knex.raw('ALTER TABLE project_task_comments ALTER COLUMN user_id SET NOT NULL');
  for (const name of ['actor_reference_id', 'actor_display_name', 'actor_organization_name', 'collaboration_revision']) {
    await knex.raw(`ALTER TABLE project_task_comments DROP COLUMN IF EXISTS ${name}`);
  }
};
