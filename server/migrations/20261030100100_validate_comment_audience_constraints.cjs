// CM L4a (2 of 5): VALIDATE only. Each scan runs under SHARE UPDATE EXCLUSIVE while reads
// and writes continue, so it lives in its own non-transactional file. Idempotent; each
// step is a no-op when the constraint is absent or already valid.
exports.config = { transaction: false };

async function pending(knex, table, name) {
  if (!(await knex.schema.hasTable(table))) return false;
  const { rows } = await knex.raw(`SELECT convalidated FROM pg_constraint WHERE conname = ? AND conrelid = ?::regclass`, [name, table]);
  return rows.length > 0 && !rows[0].convalidated;
}

exports.up = async function up(knex) {
  if (await pending(knex, 'comment_threads', 'comment_threads_collaboration_audience_check')) {
    await knex.raw('ALTER TABLE comment_threads VALIDATE CONSTRAINT comment_threads_collaboration_audience_check');
  }
  if (await pending(knex, 'comments', 'comments_collaboration_actor_check')) {
    await knex.raw('ALTER TABLE comments VALIDATE CONSTRAINT comments_collaboration_actor_check');
  }
  if (await pending(knex, 'comments', 'comments_collaboration_actor_fk')) {
    await knex.raw('ALTER TABLE comments VALIDATE CONSTRAINT comments_collaboration_actor_fk');
  }
};

exports.down = async function down() {
  // Forward-only: a validated constraint is not un-validated. The NOT VALID file's down removes the constraints.
};
