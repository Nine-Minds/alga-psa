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
  if (!(await knex.schema.hasTable('kb_articles'))) {
    await knex.schema.createTable('kb_articles', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('article_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('document_id').notNullable();

      // Article metadata
      table.text('slug').notNullable(); // URL-friendly identifier
      table.text('article_type').notNullable().defaultTo('how_to'); // 'how_to' | 'faq' | 'troubleshooting' | 'reference'
      table.text('audience').notNullable().defaultTo('internal'); // 'internal' | 'client' | 'public'
      table.text('status').notNullable().defaultTo('draft'); // 'draft' | 'review' | 'published' | 'archived'

      // Review cycle
      table.timestamp('next_review_due', { useTz: true });
      table.integer('review_cycle_days'); // e.g., 90 days
      table.timestamp('last_reviewed_at', { useTz: true });
      table.uuid('last_reviewed_by');

      // Analytics
      table.integer('view_count').notNullable().defaultTo(0);
      table.integer('helpful_count').notNullable().defaultTo(0);
      table.integer('not_helpful_count').notNullable().defaultTo(0);

      // Category — no FK to standard_categories; intentional for CitusDB cross-table compatibility.
      // Referential integrity enforced at application level.
      table.uuid('category_id');

      // Audit columns
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
      table.uuid('created_by');
      table.uuid('updated_by');

      // Published metadata
      table.timestamp('published_at', { useTz: true });
      table.uuid('published_by');

      table.primary(['tenant', 'article_id']);
      table.foreign('tenant').references('tenant').inTable('tenants');
      table.foreign(['tenant', 'document_id']).references(['tenant', 'document_id']).inTable('documents');

      // Slug must be unique per tenant
      table.unique(['tenant', 'slug'], 'uq_kb_articles_tenant_slug');

      // Indexes for common queries
      table.index(['tenant', 'status'], 'idx_kb_articles_tenant_status');
      table.index(['tenant', 'audience'], 'idx_kb_articles_tenant_audience');
      table.index(['tenant', 'article_type'], 'idx_kb_articles_tenant_type');
      table.index(['tenant', 'category_id'], 'idx_kb_articles_tenant_category');
      table.index(['tenant', 'next_review_due'], 'idx_kb_articles_tenant_review_due');
    });
  }

  await distributeIfCitus(knex, 'kb_articles');
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('kb_articles');
};

// CitusDB: create_distributed_table cannot run inside a transaction
exports.config = { transaction: false };
