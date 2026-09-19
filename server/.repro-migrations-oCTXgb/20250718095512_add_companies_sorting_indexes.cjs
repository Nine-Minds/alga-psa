exports.up = async function(knex) {
  // Add indexes for commonly sorted columns in companies table
  await knex.schema.table('companies', (table) => {
    // Index for company_name sorting (most common)
    table.index(['tenant', 'company_name'], 'idx_companies_tenant_company_name');
    
    // Index for client_type sorting
    table.index(['tenant', 'client_type'], 'idx_companies_tenant_client_type');
    
    // Index for url sorting
    table.index(['tenant', 'url'], 'idx_companies_tenant_url');
    
    // Composite index for tenant + is_inactive + company_name for filtered sorting
    table.index(['tenant', 'is_inactive', 'company_name'], 'idx_companies_tenant_inactive_name');
  });

  // Add indexes for company_locations table to speed up joins and sorting by phone/address
  await knex.schema.table('company_locations', (table) => {
    // Index for phone sorting (when sorting by phone_no)
    table.index(['tenant', 'company_id', 'is_default', 'phone'], 'idx_company_locations_default_phone');
    
    // Index for address sorting
    table.index(['tenant', 'company_id', 'is_default', 'address_line1'], 'idx_company_locations_default_address');
  });
};

exports.down = async function(knex) {
  // Remove company_locations indexes
  await knex.schema.table('company_locations', (table) => {
    table.dropIndex(['tenant', 'company_id', 'is_default', 'address_line1'], 'idx_company_locations_default_address');
    table.dropIndex(['tenant', 'company_id', 'is_default', 'phone'], 'idx_company_locations_default_phone');
  });

  // Remove companies indexes
  await knex.schema.table('companies', (table) => {
    table.dropIndex(['tenant', 'is_inactive', 'company_name'], 'idx_companies_tenant_inactive_name');
    table.dropIndex(['tenant', 'url'], 'idx_companies_tenant_url');
    table.dropIndex(['tenant', 'client_type'], 'idx_companies_tenant_client_type');
    table.dropIndex(['tenant', 'company_name'], 'idx_companies_tenant_company_name');
  });
};