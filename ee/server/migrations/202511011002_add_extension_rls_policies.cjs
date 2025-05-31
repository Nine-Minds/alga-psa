/**
 * Migration file to add RLS policies for extension tables
 */
exports.up = function(knex) {
  return knex.raw(`
    -- Enable row level security
    ALTER TABLE extensions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE extension_permissions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE extension_files ENABLE ROW LEVEL SECURITY;
    ALTER TABLE extension_storage ENABLE ROW LEVEL SECURITY;
    ALTER TABLE extension_settings ENABLE ROW LEVEL SECURITY;
    
    -- Create policies for extensions table
    CREATE POLICY tenant_isolation_select ON extensions
      FOR SELECT
      USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
      
    CREATE POLICY tenant_isolation_insert ON extensions
      FOR INSERT
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
      
    CREATE POLICY tenant_isolation_update ON extensions
      FOR UPDATE
      USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
      
    CREATE POLICY tenant_isolation_delete ON extensions
      FOR DELETE
      USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
    
    -- Create policies for extension_permissions table (via extension_id -> tenant_id)
    CREATE POLICY tenant_isolation_select ON extension_permissions
      FOR SELECT
      USING (extension_id IN (
        SELECT id FROM extensions
        WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
      ));
      
    CREATE POLICY tenant_isolation_insert ON extension_permissions
      FOR INSERT
      WITH CHECK (extension_id IN (
        SELECT id FROM extensions
        WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
      ));
      
    CREATE POLICY tenant_isolation_update ON extension_permissions
      FOR UPDATE
      USING (extension_id IN (
        SELECT id FROM extensions
        WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
      ));
      
    CREATE POLICY tenant_isolation_delete ON extension_permissions
      FOR DELETE
      USING (extension_id IN (
        SELECT id FROM extensions
        WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
      ));
    
    -- Create policies for extension_files table (via extension_id -> tenant_id)
    CREATE POLICY tenant_isolation_select ON extension_files
      FOR SELECT
      USING (extension_id IN (
        SELECT id FROM extensions
        WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
      ));
      
    CREATE POLICY tenant_isolation_insert ON extension_files
      FOR INSERT
      WITH CHECK (extension_id IN (
        SELECT id FROM extensions
        WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
      ));
      
    CREATE POLICY tenant_isolation_update ON extension_files
      FOR UPDATE
      USING (extension_id IN (
        SELECT id FROM extensions
        WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
      ));
      
    CREATE POLICY tenant_isolation_delete ON extension_files
      FOR DELETE
      USING (extension_id IN (
        SELECT id FROM extensions
        WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
      ));
    
    -- Create policies for extension_storage table
    CREATE POLICY tenant_isolation_select ON extension_storage
      FOR SELECT
      USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
      
    CREATE POLICY tenant_isolation_insert ON extension_storage
      FOR INSERT
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
      
    CREATE POLICY tenant_isolation_update ON extension_storage
      FOR UPDATE
      USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
      
    CREATE POLICY tenant_isolation_delete ON extension_storage
      FOR DELETE
      USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
    
    -- Create policies for extension_settings table
    CREATE POLICY tenant_isolation_select ON extension_settings
      FOR SELECT
      USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
      
    CREATE POLICY tenant_isolation_insert ON extension_settings
      FOR INSERT
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
      
    CREATE POLICY tenant_isolation_update ON extension_settings
      FOR UPDATE
      USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
      
    CREATE POLICY tenant_isolation_delete ON extension_settings
      FOR DELETE
      USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
  `);
};

exports.down = function(knex) {
  return knex.raw(`
    -- Drop policies for extensions table
    DROP POLICY IF EXISTS tenant_isolation_select ON extensions;
    DROP POLICY IF EXISTS tenant_isolation_insert ON extensions;
    DROP POLICY IF EXISTS tenant_isolation_update ON extensions;
    DROP POLICY IF EXISTS tenant_isolation_delete ON extensions;
    
    -- Drop policies for extension_permissions table
    DROP POLICY IF EXISTS tenant_isolation_select ON extension_permissions;
    DROP POLICY IF EXISTS tenant_isolation_insert ON extension_permissions;
    DROP POLICY IF EXISTS tenant_isolation_update ON extension_permissions;
    DROP POLICY IF EXISTS tenant_isolation_delete ON extension_permissions;
    
    -- Drop policies for extension_files table
    DROP POLICY IF EXISTS tenant_isolation_select ON extension_files;
    DROP POLICY IF EXISTS tenant_isolation_insert ON extension_files;
    DROP POLICY IF EXISTS tenant_isolation_update ON extension_files;
    DROP POLICY IF EXISTS tenant_isolation_delete ON extension_files;
    
    -- Drop policies for extension_storage table
    DROP POLICY IF EXISTS tenant_isolation_select ON extension_storage;
    DROP POLICY IF EXISTS tenant_isolation_insert ON extension_storage;
    DROP POLICY IF EXISTS tenant_isolation_update ON extension_storage;
    DROP POLICY IF EXISTS tenant_isolation_delete ON extension_storage;
    
    -- Drop policies for extension_settings table
    DROP POLICY IF EXISTS tenant_isolation_select ON extension_settings;
    DROP POLICY IF EXISTS tenant_isolation_insert ON extension_settings;
    DROP POLICY IF EXISTS tenant_isolation_update ON extension_settings;
    DROP POLICY IF EXISTS tenant_isolation_delete ON extension_settings;
    
    -- Disable row level security
    ALTER TABLE extensions DISABLE ROW LEVEL SECURITY;
    ALTER TABLE extension_permissions DISABLE ROW LEVEL SECURITY;
    ALTER TABLE extension_files DISABLE ROW LEVEL SECURITY;
    ALTER TABLE extension_storage DISABLE ROW LEVEL SECURITY;
    ALTER TABLE extension_settings DISABLE ROW LEVEL SECURITY;
  `);
};