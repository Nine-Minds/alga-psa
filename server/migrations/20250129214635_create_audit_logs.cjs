/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('audit_logs', table => {
    // Primary key
    table.uuid('audit_id').primary();
    
    // Required fields
    table.string('tenant').notNullable();
    table.string('user_id');  // Nullable since system actions might not have a user
    table.string('operation').notNullable();
    table.string('table_name').notNullable();
    table.string('record_id').notNullable();
    table.jsonb('changed_data').notNullable();
    table.jsonb('details').notNullable();  // Additional context/notes about the audit entry
    table.timestamp('timestamp').notNullable().defaultTo(knex.fn.now());

    // Indexes
    table.index(['table_name', 'record_id']); // For querying entity history
    table.index('timestamp');                 // For time-based queries
    table.index('tenant');                    // For RLS filtering
  })
  .then(() => {
    // Add RLS policy
    return knex.raw(`
      ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
      
      CREATE POLICY tenant_isolation_policy ON audit_logs
        USING (tenant = current_setting('app.current_tenant')::text);
        
      CREATE POLICY tenant_isolation_policy_insert ON audit_logs
        FOR INSERT
        WITH CHECK (tenant = current_setting('app.current_tenant')::text);

      -- Create trigger to automatically set tenant from app.current_tenant
      CREATE OR REPLACE FUNCTION set_tenant_from_current_setting()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.tenant = current_setting('app.current_tenant');
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER set_tenant_on_audit_log_insert
        BEFORE INSERT ON audit_logs
        FOR EACH ROW
        EXECUTE FUNCTION set_tenant_from_current_setting();
    `);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTable('audit_logs');
};
