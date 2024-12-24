/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('document_content', (table) => {
    // Primary key
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    
    // Foreign key to documents table
    table.uuid('document_id').notNullable();
    table.uuid('tenant').notNullable();
    
    // Document content
    table.text('content').notNullable();
    
    // User references
    table.uuid('created_by_id').notNullable();
    table.uuid('updated_by_id').notNullable();
    
    // Timestamps
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    
    // Constraints
    table.foreign(['tenant', 'document_id']).references(['tenant', 'document_id']).inTable('documents').onDelete('CASCADE');
    table.foreign(['tenant', 'created_by_id']).references(['tenant', 'user_id']).inTable('users');
    table.foreign(['tenant', 'updated_by_id']).references(['tenant', 'user_id']).inTable('users');
    table.unique(['document_id', 'tenant']);
  })
  // Add RLS policy
  .then(() => {
    return knex.raw(`
      ALTER TABLE document_content ENABLE ROW LEVEL SECURITY;
      
      CREATE POLICY document_content_tenant_isolation_policy ON document_content
        USING (tenant = current_setting('app.current_tenant')::uuid);
        
      CREATE POLICY document_content_tenant_modification_policy ON document_content
        FOR INSERT
        WITH CHECK (tenant = current_setting('app.current_tenant')::uuid);
    `);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTableIfExists('document_content');
};
