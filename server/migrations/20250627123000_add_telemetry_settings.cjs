/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema
    // Create dedicated tenant telemetry settings table
    .createTable('tenant_telemetry_settings', table => {
      table.uuid('tenant').primary();
      table.boolean('enabled').notNullable().defaultTo(true);
      table.boolean('allow_user_override').notNullable().defaultTo(true);
      table.enum('anonymization_level', ['none', 'partial', 'full']).notNullable().defaultTo('partial');
      table.jsonb('exclude_patterns').defaultTo('[]');
      table.text('compliance_notes');
      table.uuid('updated_by').notNullable();
      table.timestamps(true, true);

      // Foreign key constraints
      table.foreign('tenant').references('tenant').inTable('tenants').onDelete('CASCADE');
      table.foreign(['tenant', 'updated_by']).references(['tenant', 'user_id']).inTable('users').onDelete('RESTRICT');
    })
    
    // Create telemetry consent log for compliance tracking
    .createTable('telemetry_consent_log', table => {
      table.increments('id').primary();
      table.uuid('tenant').notNullable();
      table.uuid('user_id').notNullable();
      table.enum('action', ['opted_in', 'opted_out', 'settings_changed', 'consent_given', 'consent_withdrawn']).notNullable();
      table.jsonb('preferences_before');
      table.jsonb('preferences_after');
      table.string('consent_version').notNullable();
      table.text('user_agent');
      table.inet('ip_address');
      table.text('notes');
      table.timestamps(true, true);

      // Foreign key constraints
      table.foreign('tenant').references('tenant').inTable('tenants').onDelete('CASCADE');
      table.foreign(['tenant', 'user_id']).references(['tenant', 'user_id']).inTable('users').onDelete('CASCADE');
      
      // Indexes for performance
      table.index(['tenant', 'user_id']);
      table.index('created_at');
      table.index('action');
    })
    
    // Add RLS policies for both tables
    .raw(`
      -- Enable RLS for tenant telemetry settings
      ALTER TABLE tenant_telemetry_settings ENABLE ROW LEVEL SECURITY;
      
      CREATE POLICY tenant_isolation_policy ON tenant_telemetry_settings
        USING (tenant = current_setting('app.current_tenant')::uuid)
        WITH CHECK (tenant = current_setting('app.current_tenant')::uuid);
      
      -- Enable RLS for telemetry consent log
      ALTER TABLE telemetry_consent_log ENABLE ROW LEVEL SECURITY;
      
      CREATE POLICY tenant_isolation_policy ON telemetry_consent_log
        USING (tenant = current_setting('app.current_tenant')::uuid)
        WITH CHECK (tenant = current_setting('app.current_tenant')::uuid);
    `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema
    .raw(`
      -- Drop RLS policies
      DROP POLICY IF EXISTS tenant_isolation_policy ON telemetry_consent_log;
      ALTER TABLE telemetry_consent_log DISABLE ROW LEVEL SECURITY;
      
      DROP POLICY IF EXISTS tenant_isolation_policy ON tenant_telemetry_settings;
      ALTER TABLE tenant_telemetry_settings DISABLE ROW LEVEL SECURITY;
    `)
    .dropTableIfExists('telemetry_consent_log')
    .dropTableIfExists('tenant_telemetry_settings');
};