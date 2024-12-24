/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Create document_versions table
  await knex.schema.createTable('document_versions', table => {
    table.uuid('version_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('document_id').notNullable();
    table.uuid('tenant').notNullable();
    table.integer('version_number').notNullable();
    table.boolean('is_active').notNullable().defaultTo(true);
    table.uuid('created_by');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    // Add composite foreign key to documents
    table.foreign(['tenant', 'document_id'])
      .references(['tenant', 'document_id'])
      .inTable('documents')
      .onDelete('CASCADE');

    // Add unique constraint to prevent duplicate version numbers per document
    table.unique(['tenant', 'document_id', 'version_number']);
  });

  // Add RLS policy for tenant isolation
  await knex.raw(`
    ALTER TABLE document_versions ENABLE ROW LEVEL SECURITY;
    CREATE POLICY document_versions_tenant_isolation_policy ON document_versions
      USING (tenant = current_setting('app.current_tenant')::uuid);
  `);

  // Add version_id column to document_block_content
  await knex.schema.alterTable('document_block_content', table => {
    table.uuid('version_id').references('version_id').inTable('document_versions');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Remove version_id column from document_block_content
  await knex.schema.alterTable('document_block_content', table => {
    table.dropColumn('version_id');
  });

  // Drop document_versions table
  await knex.schema.dropTableIfExists('document_versions');
};
