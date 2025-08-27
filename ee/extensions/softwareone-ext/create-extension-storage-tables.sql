-- Create remaining extension tables

-- Create extension_storage table
CREATE TABLE IF NOT EXISTS extension_storage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    extension_id UUID NOT NULL REFERENCES extensions(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(tenant) ON DELETE CASCADE,
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
    tenant_id UUID NOT NULL REFERENCES tenants(tenant) ON DELETE CASCADE,
    settings JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(extension_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_extension_settings_extension_id ON extension_settings(extension_id);
CREATE INDEX IF NOT EXISTS idx_extension_settings_tenant_id ON extension_settings(tenant_id);

-- Create update triggers for updated_at columns
CREATE TRIGGER update_extension_storage_updated_at BEFORE UPDATE ON extension_storage
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_extension_settings_updated_at BEFORE UPDATE ON extension_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security
ALTER TABLE extension_storage ENABLE ROW LEVEL SECURITY;
ALTER TABLE extension_settings ENABLE ROW LEVEL SECURITY;

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