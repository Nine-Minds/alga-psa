/**
 * Creates the document_default_folders table.
 *
 * Defines which folders are automatically created when documents are first
 * accessed for an entity of a given type.
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
  if (!(await knex.schema.hasTable('document_default_folders'))) {
    await knex.schema.createTable('document_default_folders', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('default_folder_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.text('entity_type').notNullable();
      table.text('folder_path').notNullable();
      table.text('folder_name').notNullable();
      table.boolean('is_client_visible').notNullable().defaultTo(false);
      table.integer('sort_order').notNullable().defaultTo(0);
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
      table.uuid('created_by');
      table.uuid('updated_by');

      table.primary(['tenant', 'default_folder_id']);
      table.foreign('tenant').references('tenant').inTable('tenants');

      table.unique(['tenant', 'entity_type', 'folder_path'], 'uq_doc_default_folders_tenant_entity_type_path');
      table.index(['tenant', 'entity_type'], 'idx_doc_default_folders_tenant_entity_type');
    });
  }

  await distributeIfCitus(knex, 'document_default_folders');
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('document_default_folders');
};

// CitusDB: create_distributed_table cannot run inside a transaction
exports.config = { transaction: false };
