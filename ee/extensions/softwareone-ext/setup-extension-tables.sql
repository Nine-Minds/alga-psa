-- SoftwareOne Extension Setup Script
-- This script creates the necessary extension tables for testing in CE environment
-- WARNING: This is for development/testing only. In production, use the EE version.

-- Create extensions table
CREATE TABLE IF NOT EXISTS extensions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    version VARCHAR(50) NOT NULL,
    manifest JSONB NOT NULL,
    main_entry_point VARCHAR(255),
    is_enabled BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, name)
);

-- Create extension_permissions table
CREATE TABLE IF NOT EXISTS extension_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    extension_id UUID NOT NULL REFERENCES extensions(id) ON DELETE CASCADE,
    resource VARCHAR(255) NOT NULL,
    action VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(extension_id, resource, action)
);

-- Create extension_storage table
CREATE TABLE IF NOT EXISTS extension_storage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    extension_id UUID NOT NULL REFERENCES extensions(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
    key VARCHAR(255) NOT NULL,
    value JSONB NOT NULL,
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(extension_id, tenant_id, key)
);

-- Create extension_settings table
CREATE TABLE IF NOT EXISTS extension_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    extension_id UUID NOT NULL REFERENCES extensions(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(extension_id, tenant_id)
);

-- Create extension_files table (optional, for completeness)
CREATE TABLE IF NOT EXISTS extension_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    extension_id UUID NOT NULL REFERENCES extensions(id) ON DELETE CASCADE,
    path VARCHAR(500) NOT NULL,
    content_hash VARCHAR(64),
    size INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(extension_id, path)
);

-- Enable RLS on all extension tables
ALTER TABLE extensions ENABLE ROW LEVEL SECURITY;
ALTER TABLE extension_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE extension_storage ENABLE ROW LEVEL SECURITY;
ALTER TABLE extension_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE extension_files ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for tenant isolation
CREATE POLICY tenant_isolation_select ON extensions 
    FOR SELECT USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY tenant_isolation_insert ON extensions 
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY tenant_isolation_update ON extensions 
    FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY tenant_isolation_delete ON extensions 
    FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_select ON extension_storage 
    FOR SELECT USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY tenant_isolation_insert ON extension_storage 
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY tenant_isolation_update ON extension_storage 
    FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY tenant_isolation_delete ON extension_storage 
    FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_select ON extension_settings 
    FOR SELECT USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY tenant_isolation_insert ON extension_settings 
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY tenant_isolation_update ON extension_settings 
    FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY tenant_isolation_delete ON extension_settings 
    FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Permissions are extension-scoped, so they use the extension's tenant
CREATE POLICY extension_isolation_all ON extension_permissions 
    FOR ALL USING (
        extension_id IN (
            SELECT id FROM extensions WHERE tenant_id = current_setting('app.current_tenant_id')::uuid
        )
    );

CREATE POLICY extension_isolation_all ON extension_files 
    FOR ALL USING (
        extension_id IN (
            SELECT id FROM extensions WHERE tenant_id = current_setting('app.current_tenant_id')::uuid
        )
    );

-- Create update trigger for updated_at columns
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_extensions_updated_at BEFORE UPDATE ON extensions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_extension_storage_updated_at BEFORE UPDATE ON extension_storage
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_extension_settings_updated_at BEFORE UPDATE ON extension_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_extension_files_updated_at BEFORE UPDATE ON extension_files
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Now insert the SoftwareOne extension
-- First, get your tenant ID by running: SELECT tenant_id FROM tenants LIMIT 1;
-- Then replace YOUR_TENANT_ID below with the actual value

/*
INSERT INTO extensions (
    name,
    tenant_id,
    description,
    version,
    manifest,
    main_entry_point,
    is_enabled
) VALUES (
    'SoftwareOne Integration',
    'YOUR_TENANT_ID', -- Replace this!
    'Browse and bill SoftwareOne agreements inside Alga PSA',
    '0.1.0',
    '{
        "id": "com.alga.softwareone",
        "name": "SoftwareOne Integration",
        "version": "0.1.0",
        "description": "Browse and bill SoftwareOne agreements inside Alga PSA",
        "permissions": {
            "api": ["companies:read", "invoices:write", "settings:read", "settings:write", "storage:read", "storage:write"],
            "ui": {"navigation": ["main"], "dashboards": []}
        }
    }'::jsonb,
    '/extensions/softwareone-ext/dist/index.js',
    true
);

-- Add permissions for the extension
INSERT INTO extension_permissions (extension_id, resource, action)
SELECT 
    e.id,
    perm.resource,
    perm.action
FROM extensions e
CROSS JOIN (VALUES 
    ('companies', 'read'),
    ('invoices', 'write'),
    ('settings', 'read'),
    ('settings', 'write'),
    ('storage', 'read'),
    ('storage', 'write')
) AS perm(resource, action)
WHERE e.name = 'SoftwareOne Integration'
AND e.tenant_id = 'YOUR_TENANT_ID'; -- Replace this too!
*/