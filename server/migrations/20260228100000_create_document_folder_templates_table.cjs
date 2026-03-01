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
  if (!(await knex.schema.hasTable('document_folder_templates'))) {
    await knex.schema.createTable('document_folder_templates', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('template_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.text('name').notNullable();
      table.text('entity_type').notNullable();
      table.boolean('is_default').notNullable().defaultTo(false);
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
      table.uuid('created_by');
      table.uuid('updated_by');

      table.primary(['tenant', 'template_id']);
      table.foreign('tenant').references('tenant').inTable('tenants');

      table.index(['tenant', 'entity_type'], 'idx_doc_folder_templates_tenant_entity_type');
      table.index(['tenant', 'is_default'], 'idx_doc_folder_templates_tenant_is_default');
      table.unique(['tenant', 'entity_type', 'name'], 'uq_doc_folder_templates_tenant_entity_type_name');
    });
  }

  await distributeIfCitus(knex, 'document_folder_templates');
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('document_folder_templates');
};
