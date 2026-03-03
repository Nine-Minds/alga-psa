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
  if (!(await knex.schema.hasTable('document_folder_template_items'))) {
    await knex.schema.createTable('document_folder_template_items', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('template_item_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('template_id').notNullable();
      table.uuid('parent_template_item_id');
      table.text('folder_name').notNullable();
      table.text('folder_path').notNullable();
      table.integer('sort_order').notNullable().defaultTo(0);
      table.boolean('is_client_visible').notNullable().defaultTo(false);
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
      table.uuid('created_by');
      table.uuid('updated_by');

      table.primary(['tenant', 'template_item_id']);

      table
        .foreign('tenant')
        .references('tenant')
        .inTable('tenants');

      table
        .foreign(['tenant', 'template_id'])
        .references(['tenant', 'template_id'])
        .inTable('document_folder_templates')
        .onDelete('CASCADE');

      // No self-referential FK for parent_template_item_id — unsupported on CitusDB distributed tables.
      // Parent-child tree relationship enforced at application level.

      table.index(['tenant', 'template_id'], 'idx_doc_folder_template_items_tenant_template_id');
      table.index(['tenant', 'parent_template_item_id'], 'idx_doc_folder_template_items_tenant_parent_item_id');
      table.unique(['tenant', 'template_id', 'folder_path'], 'uq_doc_folder_template_items_tenant_template_path');
    });
  }

  await distributeIfCitus(knex, 'document_folder_template_items');
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('document_folder_template_items');
};

// CitusDB: create_distributed_table cannot run inside a transaction
exports.config = { transaction: false };
