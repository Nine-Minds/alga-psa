/**
 * Creates the knowledge base system: articles, relations, templates, and reviewers.
 *
 * Combines:
 *  - create_kb_articles_table
 *  - create_kb_article_relations_table
 *  - create_kb_article_templates_table
 *  - create_kb_article_reviewers_table
 *
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
  // --- Step 1: Create kb_articles ---
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

  // --- Step 2: Create kb_article_relations ---
  if (!(await knex.schema.hasTable('kb_article_relations'))) {
    await knex.schema.createTable('kb_article_relations', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('relation_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('source_article_id').notNullable();
      table.uuid('target_article_id').notNullable();

      // Relation type: 'related' | 'prerequisite' | 'supersedes'
      table.text('relation_type').notNullable().defaultTo('related');

      // Audit columns
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.uuid('created_by');

      table.primary(['tenant', 'relation_id']);
      table.foreign('tenant').references('tenant').inTable('tenants');
      table.foreign(['tenant', 'source_article_id']).references(['tenant', 'article_id']).inTable('kb_articles').onDelete('CASCADE');
      table.foreign(['tenant', 'target_article_id']).references(['tenant', 'article_id']).inTable('kb_articles').onDelete('CASCADE');

      // Prevent duplicate relations
      table.unique(['tenant', 'source_article_id', 'target_article_id', 'relation_type'], 'uq_kb_article_relations_unique');

      // Index for querying relations
      table.index(['tenant', 'source_article_id'], 'idx_kb_article_relations_source');
      table.index(['tenant', 'target_article_id'], 'idx_kb_article_relations_target');
    });
  }

  await distributeIfCitus(knex, 'kb_article_relations');

  // --- Step 3: Create kb_article_templates ---
  if (!(await knex.schema.hasTable('kb_article_templates'))) {
    await knex.schema.createTable('kb_article_templates', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('template_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));

      table.text('name').notNullable();
      table.text('description');

      // Article type this template is for
      table.text('article_type').notNullable().defaultTo('how_to');

      // BlockNote JSON content template
      table.jsonb('content_template').notNullable().defaultTo('[]');

      // Whether this is the default template for the article type
      table.boolean('is_default').notNullable().defaultTo(false);

      // Audit columns
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
      table.uuid('created_by');
      table.uuid('updated_by');

      table.primary(['tenant', 'template_id']);
      table.foreign('tenant').references('tenant').inTable('tenants');

      // Unique name per tenant
      table.unique(['tenant', 'name'], 'uq_kb_article_templates_tenant_name');

      // Index for article type queries
      table.index(['tenant', 'article_type'], 'idx_kb_article_templates_tenant_type');
    });
  }

  await distributeIfCitus(knex, 'kb_article_templates');

  // --- Step 4: Create kb_article_reviewers ---
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
  await knex.schema.dropTableIfExists('kb_article_templates');
  await knex.schema.dropTableIfExists('kb_article_relations');
  await knex.schema.dropTableIfExists('kb_articles');
};

// CitusDB: create_distributed_table cannot run inside a transaction
exports.config = { transaction: false };
