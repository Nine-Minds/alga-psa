/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
async function distributeIfCitus(knex, tableName) {
  const citusFn = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_proc WHERE proname = 'create_distributed_table'
    ) AS exists;
  `);

  if (citusFn.rows?.[0]?.exists) {
    const alreadyDistributed = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition
        WHERE logicalrelid = '${tableName}'::regclass
      ) AS is_distributed;
    `);

    if (!alreadyDistributed.rows?.[0]?.is_distributed) {
      await knex.raw(`SELECT create_distributed_table('${tableName}', 'tenant')`);
    }
  }
}

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('kb_article_reviewers'))) {
    await knex.schema.createTable('kb_article_reviewers', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('reviewer_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('article_id').notNullable();
      table.uuid('user_id').notNullable();

      // Review status: 'pending' | 'approved' | 'rejected' | 'changes_requested'
      table.text('review_status').notNullable().defaultTo('pending');

      // Review notes/comments
      table.text('review_notes');

      // Timestamps
      table.timestamp('assigned_at', { useTz: true }).defaultTo(knex.fn.now());
      table.timestamp('reviewed_at', { useTz: true });

      // Who assigned this reviewer
      table.uuid('assigned_by');

      table.primary(['tenant', 'reviewer_id']);
      table.foreign('tenant').references('tenant').inTable('tenants');
      table.foreign(['tenant', 'article_id']).references(['tenant', 'article_id']).inTable('kb_articles').onDelete('CASCADE');

      // One review per user per article
      table.unique(['tenant', 'article_id', 'user_id'], 'uq_kb_article_reviewers_article_user');

      // Index for querying by article and status
      table.index(['tenant', 'article_id', 'review_status'], 'idx_kb_article_reviewers_article_status');
      // Index for querying user's pending reviews
      table.index(['tenant', 'user_id', 'review_status'], 'idx_kb_article_reviewers_user_status');
    });
  }

  await distributeIfCitus(knex, 'kb_article_reviewers');
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('kb_article_reviewers');
};

// CitusDB: create_distributed_table cannot run inside a transaction
exports.config = { transaction: false };
