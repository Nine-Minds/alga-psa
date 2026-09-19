exports.up = async function(knex) {
  // Create tenant_settings table for tenant-wide configuration
  await knex.schema.createTable('tenant_settings', (table) => {
    table.uuid('tenant').primary().notNullable();
    table.boolean('onboarding_completed').defaultTo(false);
    table.timestamp('onboarding_completed_at', { useTz: true });
    table.boolean('onboarding_skipped').defaultTo(false);
    table.jsonb('onboarding_data').comment('Stores wizard data for reference/audit');
    table.jsonb('settings').comment('For other tenant-wide settings');
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
    
    // Foreign key to tenants table
    table.foreign('tenant').references('tenant').inTable('tenants').onDelete('CASCADE');
    
    // Index for faster lookups
    table.index('tenant');
  });

  // Create a trigger to update the updated_at timestamp
  await knex.raw(`
    CREATE TRIGGER update_tenant_settings_updated_at
    BEFORE UPDATE ON tenant_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);

  // Insert default tenant_settings for existing tenants
  await knex.raw(`
    INSERT INTO tenant_settings (tenant)
    SELECT tenant FROM tenants
    ON CONFLICT (tenant) DO NOTHING;
  `);
};

exports.down = async function(knex) {
  // Drop the trigger first
  await knex.raw('DROP TRIGGER IF EXISTS update_tenant_settings_updated_at ON tenant_settings');
  
  // Drop the table
  await knex.schema.dropTableIfExists('tenant_settings');
};