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
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('kb_article_relations');
};
