/**
 * Add nullable threading columns to ticket comments.
 *
 * thread_id remains nullable until the staged backfill and enforcement
 * migration complete.
 *
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('comments', (table) => {
    table.uuid('thread_id').nullable();
    table.uuid('parent_comment_id').nullable();
    table.timestamp('deleted_at', { useTz: true }).nullable();
  });

  await knex.schema.alterTable('comments', (table) => {
    table
      .foreign(['tenant', 'thread_id'], 'comments_thread_fk')
      .references(['tenant', 'thread_id'])
      .inTable('comment_threads');
    table
      .foreign(['tenant', 'parent_comment_id'], 'comments_parent_comment_fk')
      .references(['tenant', 'comment_id'])
      .inTable('comments');
  });
};

/**
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.down = async function down(knex) {
  await knex.schema.alterTable('comments', (table) => {
    table.dropForeign(['tenant', 'parent_comment_id'], 'comments_parent_comment_fk');
    table.dropForeign(['tenant', 'thread_id'], 'comments_thread_fk');
  });

  await knex.schema.alterTable('comments', (table) => {
    table.dropColumn('deleted_at');
    table.dropColumn('parent_comment_id');
    table.dropColumn('thread_id');
  });
};
