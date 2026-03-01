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
  if (!(await knex.schema.hasTable('document_entity_folder_init'))) {
    await knex.schema.createTable('document_entity_folder_init', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('entity_folder_init_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('entity_id').notNullable();
      table.text('entity_type').notNullable();
      table.uuid('initialized_from_template_id');
      table.timestamp('initialized_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
      table.uuid('created_by');
      table.uuid('updated_by');

      table.primary(['tenant', 'entity_folder_init_id']);

      table
        .foreign('tenant')
        .references('tenant')
        .inTable('tenants');

      table
        .foreign(['tenant', 'initialized_from_template_id'])
        .references(['tenant', 'template_id'])
        .inTable('document_folder_templates')
        .onDelete('SET NULL');

      table.unique(['tenant', 'entity_type', 'entity_id'], 'uq_doc_entity_folder_init_tenant_entity_scope');
      table.index(['tenant', 'entity_type', 'entity_id'], 'idx_doc_entity_folder_init_tenant_entity_scope');
      table.index(['tenant', 'initialized_from_template_id'], 'idx_doc_entity_folder_init_tenant_template');
    });
  }

  await distributeIfCitus(knex, 'document_entity_folder_init');
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('document_entity_folder_init');
};
