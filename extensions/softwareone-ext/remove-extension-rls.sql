-- Remove RLS from extension tables

-- Disable RLS on all extension tables
ALTER TABLE extensions DISABLE ROW LEVEL SECURITY;
ALTER TABLE extension_permissions DISABLE ROW LEVEL SECURITY;
ALTER TABLE extension_files DISABLE ROW LEVEL SECURITY;
ALTER TABLE extension_storage DISABLE ROW LEVEL SECURITY;
ALTER TABLE extension_settings DISABLE ROW LEVEL SECURITY;

-- Drop all RLS policies
DROP POLICY IF EXISTS extensions_tenant_isolation_select ON extensions;
DROP POLICY IF EXISTS extensions_tenant_isolation_insert ON extensions;
DROP POLICY IF EXISTS extensions_tenant_isolation_update ON extensions;
DROP POLICY IF EXISTS extensions_tenant_isolation_delete ON extensions;

DROP POLICY IF EXISTS extension_storage_tenant_isolation_select ON extension_storage;
DROP POLICY IF EXISTS extension_storage_tenant_isolation_insert ON extension_storage;
DROP POLICY IF EXISTS extension_storage_tenant_isolation_update ON extension_storage;
DROP POLICY IF EXISTS extension_storage_tenant_isolation_delete ON extension_storage;

DROP POLICY IF EXISTS extension_settings_tenant_isolation_select ON extension_settings;
DROP POLICY IF EXISTS extension_settings_tenant_isolation_insert ON extension_settings;
DROP POLICY IF EXISTS extension_settings_tenant_isolation_update ON extension_settings;
DROP POLICY IF EXISTS extension_settings_tenant_isolation_delete ON extension_settings;

DROP POLICY IF EXISTS extension_permissions_extension_isolation ON extension_permissions;
DROP POLICY IF EXISTS extension_files_extension_isolation ON extension_files;