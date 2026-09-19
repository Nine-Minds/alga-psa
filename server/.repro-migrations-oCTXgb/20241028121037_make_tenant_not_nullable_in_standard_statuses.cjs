exports.up = function(knex) {
  return knex.raw(`
    -- First drop the RLS policy
    DROP POLICY IF EXISTS tenant_isolation_policy ON standard_statuses;

    -- Make changes to the table
    ALTER TABLE standard_statuses
      DROP CONSTRAINT IF EXISTS standard_statuses_name_item_type_key;
    ALTER TABLE standard_statuses DROP CONSTRAINT IF EXISTS standard_statuses_name_item_type_tenant_key;
    ALTER TABLE standard_statuses ALTER COLUMN tenant SET NOT NULL,
      ADD CONSTRAINT standard_statuses_name_item_type_tenant_key UNIQUE (name, item_type, tenant);

    -- Recreate the RLS policy
    CREATE POLICY tenant_isolation_policy ON standard_statuses
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);
  `);
};

exports.down = function(knex) {
  return knex.raw(`
    -- First drop the RLS policy
    DROP POLICY IF EXISTS tenant_isolation_policy ON standard_statuses;
    
    -- Revert changes to the table
    ALTER TABLE standard_statuses 
      DROP CONSTRAINT IF EXISTS standard_statuses_name_item_type_tenant_key,
      ALTER COLUMN tenant DROP NOT NULL,
      ADD CONSTRAINT standard_statuses_name_item_type_key UNIQUE (name, item_type);
      
    -- Recreate the RLS policy
    CREATE POLICY tenant_isolation_policy ON standard_statuses
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);
  `);
};
