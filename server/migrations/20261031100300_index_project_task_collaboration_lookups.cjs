// CM L4c (4 of 4): partial indexes over the attributed minority of task comments and the
// labelled task threads, built CONCURRENTLY (hence their own non-transactional file). They
// stay empty-sized for native tenants. Idempotent.
exports.config = { transaction: false };

exports.up = async function up(knex) {
  if (await knex.schema.hasColumn('project_task_comments', 'actor_reference_id')) {
    await knex.raw('CREATE INDEX CONCURRENTLY IF NOT EXISTS project_task_comments_collaboration_actor_idx ON project_task_comments (tenant, actor_reference_id) WHERE actor_reference_id IS NOT NULL');
  }
  if (await knex.schema.hasColumn('project_task_comments', 'contact_id')) {
    await knex.raw('CREATE INDEX CONCURRENTLY IF NOT EXISTS project_task_comments_contact_idx ON project_task_comments (tenant, contact_id) WHERE contact_id IS NOT NULL');
  }
  if (await knex.schema.hasColumn('comment_threads', 'collaboration_audience')) {
    await knex.raw('CREATE INDEX CONCURRENTLY IF NOT EXISTS comment_threads_task_audience_idx ON comment_threads (tenant, project_task_id, collaboration_audience) WHERE project_task_id IS NOT NULL AND collaboration_audience IS NOT NULL');
  }
};

exports.down = async function down(knex) {
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS project_task_comments_collaboration_actor_idx');
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS project_task_comments_contact_idx');
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS comment_threads_task_audience_idx');
};
