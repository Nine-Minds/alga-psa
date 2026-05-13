/**
 * Add nullable threading columns to project task comments.
 *
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('project_task_comments', (table) => {
    table.uuid('thread_id').nullable();
    table.uuid('parent_comment_id').nullable();
    table.timestamp('deleted_at', { useTz: true }).nullable();
  });

  await knex.schema.alterTable('project_task_comments', (table) => {
    table
      .foreign(['tenant', 'thread_id'], 'project_task_comments_thread_fk')
      .references(['tenant', 'thread_id'])
      .inTable('comment_threads');
    table
      .foreign(['tenant', 'parent_comment_id'], 'project_task_comments_parent_comment_fk')
      .references(['tenant', 'task_comment_id'])
      .inTable('project_task_comments');
  });
};

/**
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.down = async function down(knex) {
  await knex.schema.alterTable('project_task_comments', (table) => {
    table.dropForeign(['tenant', 'parent_comment_id'], 'project_task_comments_parent_comment_fk');
    table.dropForeign(['tenant', 'thread_id'], 'project_task_comments_thread_fk');
  });

  await knex.schema.alterTable('project_task_comments', (table) => {
    table.dropColumn('deleted_at');
    table.dropColumn('parent_comment_id');
    table.dropColumn('thread_id');
  });
};
