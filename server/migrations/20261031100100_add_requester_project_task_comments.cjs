// CM L4c (2 of 4): contact-authored task comments for requester task threads.
// Expand-only, nullable columns only. A requester reply is authored by a contact, not a user:
// user_id stays NULL (made nullable in 20261031100000), contact_id carries the author and
// author_kind says so. author_kind NULL means 'user' - N-1 writers never name it and the
// reader defaults it. request_hash makes a retried reply idempotent. The author_type
// check is widened to admit 'client' and the author-shape CHECK ties kind, user, contact and
// actor reference together; both CHECKs and the contact FK are NOT VALID here and validated in
// 20261031100200. No trigger, no backfill, and no global permission reconcile: the client
// 'project_task_comment:create' grant is seeded on admission, not for every tenant.
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
  await withLockRetry(knex, (trx) => trx.raw('ALTER TABLE project_task_comments ADD COLUMN IF NOT EXISTS contact_id uuid'));
  await withLockRetry(knex, (trx) => trx.raw('ALTER TABLE project_task_comments ADD COLUMN IF NOT EXISTS author_kind varchar(16)'));
  await withLockRetry(knex, (trx) => trx.raw('ALTER TABLE project_task_comments ADD COLUMN IF NOT EXISTS request_hash varchar(64)'));
  // The base table's unnamed knex CHECK only admits 'internal'.
  const { rows: checks } = await knex.raw(`SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE contype = 'c' AND conrelid = 'project_task_comments'::regclass`);
  for (const check of checks) {
    if (check.definition.includes('author_type') && !check.definition.includes("'client'") && !check.definition.includes('author_kind')) {
      // migration-lint: allow UNRESOLVED - the base table's author_type CHECK was created unnamed by knex, so its generated name is read from pg_constraint above; dropping a CHECK takes a brief ACCESS EXCLUSIVE lock under withLockRetry and scans nothing
      await withLockRetry(knex, (trx) => trx.raw('ALTER TABLE project_task_comments DROP CONSTRAINT ??', [check.conname]));
    }
  }
  if (!(await hasConstraint(knex, 'project_task_comments', 'project_task_comments_author_type'))) {
    await withLockRetry(knex, (trx) => trx.raw(`ALTER TABLE project_task_comments ADD CONSTRAINT project_task_comments_author_type CHECK (author_type IN ('internal', 'client')) NOT VALID`));
  }
  if (!(await hasConstraint(knex, 'project_task_comments', 'project_task_comments_author_kind'))) {
    await withLockRetry(knex, (trx) => trx.raw(`ALTER TABLE project_task_comments ADD CONSTRAINT project_task_comments_author_kind CHECK (author_kind IS NULL OR author_kind IN ('user', 'contact')) NOT VALID`));
  }
  if (!(await hasConstraint(knex, 'project_task_comments', 'project_task_comments_author_shape'))) {
    await withLockRetry(knex, (trx) => trx.raw(`ALTER TABLE project_task_comments ADD CONSTRAINT project_task_comments_author_shape CHECK (
      ((author_kind IS NULL OR author_kind = 'user') AND contact_id IS NULL AND (
        (actor_reference_id IS NULL AND user_id IS NOT NULL) OR
        (actor_reference_id IS NOT NULL AND user_id IS NULL AND author_type = 'internal'
          AND COALESCE(char_length(actor_display_name), 0) > 0 AND COALESCE(char_length(actor_organization_name), 0) > 0)))
      OR (author_kind = 'contact' AND contact_id IS NOT NULL AND user_id IS NULL AND actor_reference_id IS NULL AND author_type = 'client'
        AND COALESCE(char_length(actor_display_name), 0) > 0)) NOT VALID`));
  }
  if (!(await hasConstraint(knex, 'project_task_comments', 'project_task_comments_contact_fk'))) {
    await withLockRetry(knex, (trx) => trx.raw(`ALTER TABLE project_task_comments ADD CONSTRAINT project_task_comments_contact_fk FOREIGN KEY (tenant, contact_id) REFERENCES contacts (tenant, contact_name_id) NOT VALID`));
  }
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasColumn('project_task_comments', 'author_kind'))) return;
  if (await knex('project_task_comments').whereNotNull('contact_id').orWhereNotNull('author_kind').orWhereNotNull('request_hash').orWhere('author_type', 'client').first('task_comment_id')) {
    throw new Error('Cannot discard retained requester task conversations');
  }
  await knex.raw('DROP INDEX IF EXISTS project_task_comments_contact_idx');
  for (const name of ['project_task_comments_contact_fk', 'project_task_comments_author_shape', 'project_task_comments_author_kind', 'project_task_comments_author_type']) {
    await knex.raw('ALTER TABLE project_task_comments DROP CONSTRAINT IF EXISTS ??', [name]);
  }
  await knex.raw(`ALTER TABLE project_task_comments ADD CONSTRAINT project_task_comments_author_type CHECK (author_type = 'internal')`);
  for (const name of ['contact_id', 'author_kind', 'request_hash']) {
    await knex.raw(`ALTER TABLE project_task_comments DROP COLUMN IF EXISTS ${name}`);
  }
};
