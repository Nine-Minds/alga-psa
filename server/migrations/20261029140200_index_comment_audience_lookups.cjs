// CM L4a (3 of 5): partial indexes over the labelled/attributed minority of comment rows,
// built CONCURRENTLY (hence their own non-transactional file). They stay empty-sized for
// native tenants. Idempotent.
exports.config = { transaction: false };

exports.up = async function up(knex) {
  if ((await knex.schema.hasTable('comment_threads')) && (await knex.schema.hasColumn('comment_threads', 'collaboration_audience'))) {
    await knex.raw(
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS comment_threads_collaboration_audience_idx ON comment_threads (tenant, ticket_id, collaboration_audience) WHERE collaboration_audience IS NOT NULL'
    );
  }
  if ((await knex.schema.hasTable('comments')) && (await knex.schema.hasColumn('comments', 'actor_reference_id'))) {
    await knex.raw(
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS comments_collaboration_actor_idx ON comments (tenant, actor_reference_id) WHERE actor_reference_id IS NOT NULL'
    );
  }
};

exports.down = async function down(knex) {
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS comment_threads_collaboration_audience_idx');
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS comments_collaboration_actor_idx');
};
