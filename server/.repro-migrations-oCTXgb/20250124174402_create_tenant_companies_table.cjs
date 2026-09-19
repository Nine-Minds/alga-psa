exports.up = async function(knex) {
  await knex.schema.createTable('tenant_companies', (table) => {
    // Composite primary key
    table.uuid('tenant_id').notNullable();
    table.uuid('company_id').notNullable();
    table.primary(['tenant_id', 'company_id']);

    // Foreign keys
    table.foreign('tenant_id').references('tenant').inTable('tenants').onDelete('CASCADE');
    table.foreign('company_id').references('company_id').inTable('companies').onDelete('CASCADE');

    // Default company flag with unique constraint
    table.boolean('is_default').notNullable().defaultTo(false);
    
    // Soft delete support
    table.timestamp('deleted_at').nullable();
    
    // Timestamps
    table.timestamps(true, true);
  });

  // Create partial unique index for is_default
  await knex.raw(`
    CREATE UNIQUE INDEX idx_tenant_default_company 
    ON tenant_companies (tenant_id) 
    WHERE is_default = TRUE;
  `);

  // Enable RLS and create policies
  await knex.raw(`
    ALTER TABLE tenant_companies ENABLE ROW LEVEL SECURITY;
    
    CREATE POLICY tenant_isolation_policy ON tenant_companies
      USING (tenant_id::TEXT = current_setting('app.current_tenant')::TEXT);
  `);
};

exports.down = async function(knex) {
  // Drop RLS policies
  await knex.raw(`
    DROP POLICY IF EXISTS tenant_isolation_policy ON tenant_companies;
    ALTER TABLE tenant_companies DISABLE ROW LEVEL SECURITY;
  `);

  // Drop the unique index
  await knex.raw('DROP INDEX IF EXISTS idx_tenant_default_company');

  // Drop the table
  await knex.schema.dropTable('tenant_companies');
};
