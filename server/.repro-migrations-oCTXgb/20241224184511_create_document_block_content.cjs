/**
 * Creates the document_block_content table for storing block-based JSON content
 * associated with documents.
 */
exports.up = function(knex) {
  return knex.schema
    .createTable('document_block_content', table => {
      table.uuid('content_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant').notNullable().references('tenant').inTable('tenants');
      table.uuid('document_id').notNullable();
      table.jsonb('block_data').notNullable();
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
      
      // Create composite foreign key to documents table
      table.foreign(['tenant', 'document_id'])
        .references(['tenant', 'document_id'])
        .inTable('documents')
        .onDelete('CASCADE');
    })
    .then(() => {
      return knex.raw(`
        CREATE UNIQUE INDEX ON document_block_content(tenant, document_id);

        -- Enable RLS
        ALTER TABLE document_block_content ENABLE ROW LEVEL SECURITY;

        -- Create policy for tenant isolation
        CREATE POLICY tenant_isolation_policy ON document_block_content
          USING (tenant = current_setting('app.current_tenant')::uuid);
      `);
    });
};

exports.down = function(knex) {
  return knex.schema.dropTableIfExists('document_block_content');
};
