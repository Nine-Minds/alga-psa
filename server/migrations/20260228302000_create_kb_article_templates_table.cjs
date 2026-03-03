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
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('kb_article_templates');
};

// CitusDB: create_distributed_table cannot run inside a transaction
exports.config = { transaction: false };
