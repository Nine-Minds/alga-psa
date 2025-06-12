-- Create extension tables manually (EE functionality)
-- Run this as postgres user

-- Create extensions table
CREATE TABLE IF NOT EXISTS extensions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(tenant) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    version VARCHAR(50) NOT NULL,
    manifest JSONB NOT NULL,
    main_entry_point VARCHAR(255),
    is_enabled BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_extensions_tenant_id ON extensions(tenant_id);

-- Create extension_permissions table
CREATE TABLE IF NOT EXISTS extension_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    extension_id UUID NOT NULL REFERENCES extensions(id) ON DELETE CASCADE,
    resource VARCHAR(255) NOT NULL,
    action VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(extension_id, resource, action)
);

CREATE INDEX IF NOT EXISTS idx_extension_permissions_extension_id ON extension_permissions(extension_id);

-- Create extension_files table
CREATE TABLE IF NOT EXISTS extension_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    extension_id UUID NOT NULL REFERENCES extensions(id) ON DELETE CASCADE,
    path VARCHAR(500) NOT NULL,
    content_hash VARCHAR(64),
    size INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(extension_id, path)
);

CREATE INDEX IF NOT EXISTS idx_extension_files_extension_id ON extension_files(extension_id);

-- Create extension_storage table
CREATE TABLE IF NOT EXISTS extension_storage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    extension_id UUID NOT NULL REFERENCES extensions(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    key VARCHAR(255) NOT NULL,
    value JSONB NOT NULL,
    expires_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(extension_id, tenant_id, key)
);

CREATE INDEX IF NOT EXISTS idx_extension_storage_extension_id ON extension_storage(extension_id);
CREATE INDEX IF NOT EXISTS idx_extension_storage_tenant_id ON extension_storage(tenant_id);
CREATE INDEX IF NOT EXISTS idx_extension_storage_expires_at ON extension_storage(expires_at);

-- Create extension_settings table
CREATE TABLE IF NOT EXISTS extension_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    extension_id UUID NOT NULL REFERENCES extensions(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    settings JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(extension_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_extension_settings_extension_id ON extension_settings(extension_id);
CREATE INDEX IF NOT EXISTS idx_extension_settings_tenant_id ON extension_settings(tenant_id);

-- Create update triggers for updated_at columns
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_extensions_updated_at BEFORE UPDATE ON extensions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_extension_files_updated_at BEFORE UPDATE ON extension_files
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_extension_storage_updated_at BEFORE UPDATE ON extension_storage
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_extension_settings_updated_at BEFORE UPDATE ON extension_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security
ALTER TABLE extensions ENABLE ROW LEVEL SECURITY;
ALTER TABLE extension_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE extension_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE extension_storage ENABLE ROW LEVEL SECURITY;
ALTER TABLE extension_settings ENABLE ROW LEVEL SECURITY;

-- Create RLS policies (from the third migration)
-- Policies for extensions table
CREATE POLICY extensions_tenant_isolation_select ON extensions 
    FOR SELECT USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY extensions_tenant_isolation_insert ON extensions 
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY extensions_tenant_isolation_update ON extensions 
    FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY extensions_tenant_isolation_delete ON extensions 
    FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Policies for extension_storage table
CREATE POLICY extension_storage_tenant_isolation_select ON extension_storage 
    FOR SELECT USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY extension_storage_tenant_isolation_insert ON extension_storage 
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY extension_storage_tenant_isolation_update ON extension_storage 
    FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY extension_storage_tenant_isolation_delete ON extension_storage 
    FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Policies for extension_settings table
CREATE POLICY extension_settings_tenant_isolation_select ON extension_settings 
    FOR SELECT USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY extension_settings_tenant_isolation_insert ON extension_settings 
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY extension_settings_tenant_isolation_update ON extension_settings 
    FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY extension_settings_tenant_isolation_delete ON extension_settings 
    FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Policies for extension_permissions and extension_files (extension-scoped)
CREATE POLICY extension_permissions_extension_isolation ON extension_permissions 
    FOR ALL USING (
        extension_id IN (
            SELECT id FROM extensions WHERE tenant_id = current_setting('app.current_tenant_id')::uuid
        )
    );

CREATE POLICY extension_files_extension_isolation ON extension_files 
    FOR ALL USING (
        extension_id IN (
            SELECT id FROM extensions WHERE tenant_id = current_setting('app.current_tenant_id')::uuid
        )
    );

-- Update knex_migrations to mark these as completed
INSERT INTO knex_migrations (name, batch, migration_time)
VALUES 
    ('202511011000_create_extension_tables.cjs', 999, NOW()),
    ('202511011001_create_extension_storage_tables.cjs', 999, NOW()),
    ('202511011002_add_extension_rls_policies.cjs', 999, NOW())
ON CONFLICT (name) DO NOTHING;