/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  const exists = await knex.schema.hasTable('document_folders');
  if (exists) {
    return;
  }

  await knex.schema.createTable('document_folders', (table) => {
    table.uuid('folder_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant').notNullable();
    table.string('folder_path', 500).notNullable();
    table.string('folder_name', 255).notNullable();
    table.uuid('parent_folder_id').nullable(); // For easier querying
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.uuid('created_by').nullable();

    // Indexes
    table.index(['tenant', 'folder_path'], 'idx_document_folders_tenant_path');
    table.index(['tenant', 'parent_folder_id'], 'idx_document_folders_tenant_parent');

    // Unique constraint: one folder per path per tenant
    table.unique(['tenant', 'folder_path'], {
      indexName: 'uq_document_folders_tenant_path'
    });

    // Foreign keys (no CASCADE for Citus compatibility)
    table.foreign('tenant').references('tenants.tenant');
    table.foreign('parent_folder_id').references('document_folders.folder_id');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTableIfExists('document_folders');
};
