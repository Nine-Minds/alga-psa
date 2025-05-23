exports.up = async function(knex) {
  // Check if the table already has the new structure
  const hasTable = await knex.schema.hasTable('company_locations');
  
  if (hasTable) {
    const columns = await knex('information_schema.columns')
      .select('column_name')
      .where({ table_name: 'company_locations', table_schema: 'public' });
    
    const columnNames = columns.map(col => col.column_name);
    const hasNewStructure = columnNames.includes('location_name') && 
                           columnNames.includes('country_code') &&
                           columnNames.includes('is_default');
    
    if (hasNewStructure) {
      // Table already has the new structure, skip migration
      return;
    }
    
    // Drop foreign key constraints that reference company_locations
    await knex.raw(`
      ALTER TABLE IF EXISTS company_tax_rates 
      DROP CONSTRAINT IF EXISTS company_tax_rates_location_id_tenant_foreign
    `);
    
    // Drop the old table
    await knex.schema.dropTable('company_locations');
  }
  
  // Create the new company_locations table with proper tenant support
  await knex.schema.createTable('company_locations', function(table) {
    table.uuid('location_id').notNullable();
    table.uuid('tenant').notNullable();
    table.uuid('company_id').notNullable();
    
    // Address fields - flexible for international addresses
    table.string('location_name'); // e.g., "Main Office", "Warehouse"
    table.string('address_line1').notNullable();
    table.string('address_line2');
    table.string('address_line3'); // For international addresses that need more lines
    table.string('city').notNullable();
    table.string('state_province'); // Made optional and renamed for international use
    table.string('postal_code');
    table.string('country_code', 2).notNullable(); // ISO 3166-1 alpha-2 country code
    table.string('country_name').notNullable(); // Full country name for display
    
    // Tax and billing related
    table.string('region_code'); // FK to tax_regions table
    table.boolean('is_billing_address').defaultTo(false);
    table.boolean('is_shipping_address').defaultTo(false);
    table.boolean('is_default').defaultTo(false);
    
    // Contact information for this location
    table.string('phone');
    table.string('fax');
    table.string('email');
    
    // Additional fields
    table.text('notes');
    table.boolean('is_active').defaultTo(true);
    
    // Timestamps
    table.timestamps(true, true);
    
    // Primary key with tenant for CitusDB
    table.primary(['location_id', 'tenant']);
    
    // Foreign keys
    table.foreign(['company_id', 'tenant']).references(['company_id', 'tenant']).inTable('companies').onDelete('CASCADE');
    table.foreign(['region_code', 'tenant']).references(['region_code', 'tenant']).inTable('tax_regions');
    table.foreign('tenant').references('tenant').inTable('tenants');
    
    // Indexes
    table.index(['tenant', 'company_id']);
    table.index(['tenant', 'is_default']);
    table.index(['tenant', 'is_active']);
  });
  
  // Create a trigger to ensure only one default location per company
  await knex.raw(`
    CREATE OR REPLACE FUNCTION ensure_single_default_location()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.is_default = true THEN
        UPDATE company_locations 
        SET is_default = false 
        WHERE company_id = NEW.company_id 
        AND tenant = NEW.tenant
        AND location_id != NEW.location_id
        AND is_default = true;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    
    CREATE TRIGGER ensure_single_default_location_trigger
    BEFORE INSERT OR UPDATE ON company_locations
    FOR EACH ROW
    EXECUTE FUNCTION ensure_single_default_location();
  `);
  
  // Add RLS policy for company_locations
  await knex.raw(`
    ALTER TABLE company_locations ENABLE ROW LEVEL SECURITY;
    
    CREATE POLICY tenant_isolation ON company_locations
    USING (tenant = current_setting('app.current_tenant')::uuid);
    
    CREATE POLICY company_locations_tenant_isolation ON company_locations
    FOR ALL USING (tenant = current_setting('app.current_tenant', true)::uuid);
  `);
};

exports.down = async function(knex) {
  // Drop the trigger and function
  await knex.raw('DROP TRIGGER IF EXISTS ensure_single_default_location_trigger ON company_locations');
  await knex.raw('DROP FUNCTION IF EXISTS ensure_single_default_location()');
  
  // Drop RLS policies
  await knex.raw('DROP POLICY IF EXISTS tenant_isolation ON company_locations');
  await knex.raw('DROP POLICY IF EXISTS company_locations_tenant_isolation ON company_locations');
  
  // Drop the table
  await knex.schema.dropTableIfExists('company_locations');
  
  // Recreate the original table structure
  await knex.schema.createTable('company_locations', function(table) {
    table.uuid('location_id').primary();
    table.uuid('company_id').notNullable();
    table.string('address_line1').notNullable();
    table.string('address_line2');
    table.string('city').notNullable();
    table.string('state');
    table.string('postal_code');
    table.string('country').notNullable();
    table.string('tax_region').notNullable();
    table.timestamps(true, true);
    table.foreign('company_id').references('companies.company_id');
  });
};