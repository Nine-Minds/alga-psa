-- Register SoftwareOne Extension
-- First, get a tenant ID
DO $$
DECLARE
    v_tenant_id UUID;
    v_extension_id UUID;
BEGIN
    -- Get the first tenant ID
    SELECT tenant INTO v_tenant_id FROM tenants LIMIT 1;
    
    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'No tenants found. Please create a tenant first.';
    END IF;
    
    -- Set the tenant context
    PERFORM set_config('app.current_tenant_id', v_tenant_id::text, false);
    
    -- Insert the extension
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
        v_tenant_id,
        'Browse and bill SoftwareOne agreements inside Alga PSA',
        '0.1.0',
        '{
            "id": "com.alga.softwareone",
            "name": "SoftwareOne Integration",
            "version": "0.1.0",
            "description": "Browse and bill SoftwareOne agreements inside Alga PSA",
            "author": {
                "name": "Alga Development Team",
                "email": "dev@alga.io"
            },
            "minAppVersion": "1.5.0",
            "tenantMode": "specific",
            "main": "dist/index.js",
            "permissions": {
                "api": ["companies:read", "invoices:write", "settings:read", "settings:write", "storage:read", "storage:write"],
                "ui": {"navigation": ["main"], "dashboards": []}
            },
            "components": [
                {
                    "type": "navigation",
                    "id": "swone-main-nav",
                    "displayName": "SoftwareOne",
                    "icon": "CloudIcon",
                    "component": "./dist/components/NavItem.js",
                    "permissions": [],
                    "props": {
                        "path": "/softwareone/agreements"
                    }
                },
                {
                    "type": "page",
                    "id": "swone-settings",
                    "path": "/settings/softwareone",
                    "displayName": "SoftwareOne Settings",
                    "component": "./dist/pages/SettingsPage.js",
                    "permissions": ["settings:write"]
                },
                {
                    "type": "page",
                    "id": "swone-agreements",
                    "path": "/softwareone/agreements",
                    "displayName": "Agreements",
                    "component": "./dist/pages/AgreementsList.js",
                    "permissions": []
                },
                {
                    "type": "page",
                    "id": "swone-agreement-detail",
                    "path": "/softwareone/agreement/:id",
                    "displayName": "Agreement Details",
                    "component": "./dist/pages/AgreementDetail.js",
                    "permissions": []
                },
                {
                    "type": "page",
                    "id": "swone-statements",
                    "path": "/softwareone/statements",
                    "displayName": "Statements",
                    "component": "./dist/pages/StatementsList.js",
                    "permissions": []
                },
                {
                    "type": "page",
                    "id": "swone-statement-detail",
                    "path": "/softwareone/statement/:id",
                    "displayName": "Statement Details",
                    "component": "./dist/pages/StatementDetail.js",
                    "permissions": []
                }
            ],
            "api": {
                "endpoints": [
                    {
                        "id": "sync",
                        "path": "/sync",
                        "method": "POST",
                        "handler": "./dist/handlers/runSync.js",
                        "permissions": ["storage:write"]
                    },
                    {
                        "id": "activate-agreement",
                        "path": "/activate-agreement",
                        "method": "POST",
                        "handler": "./dist/handlers/activateAgreement.js",
                        "permissions": ["storage:write"]
                    }
                ]
            },
            "settings": [
                {
                    "key": "apiEndpoint",
                    "type": "string",
                    "label": "API Endpoint",
                    "description": "SoftwareOne API endpoint URL",
                    "required": true,
                    "default": "https://api.softwareone.com"
                },
                {
                    "key": "apiToken",
                    "type": "string",
                    "label": "API Token",
                    "description": "SoftwareOne API authentication token",
                    "required": true,
                    "encrypted": true
                },
                {
                    "key": "syncInterval",
                    "type": "number",
                    "label": "Sync Interval (minutes)",
                    "description": "How often to sync data from SoftwareOne",
                    "default": 60,
                    "min": 15,
                    "max": 1440
                },
                {
                    "key": "enableAutoSync",
                    "type": "boolean",
                    "label": "Enable Auto-sync",
                    "description": "Automatically sync data at the specified interval",
                    "default": false
                }
            ],
            "dependencies": {}
        }'::jsonb,
        '/extensions/softwareone-ext/dist/index.js',
        true
    ) RETURNING id INTO v_extension_id;
    
    -- Add permissions for the extension
    INSERT INTO extension_permissions (extension_id, resource, action)
    VALUES 
        (v_extension_id, 'companies', 'read'),
        (v_extension_id, 'invoices', 'write'),
        (v_extension_id, 'settings', 'read'),
        (v_extension_id, 'settings', 'write'),
        (v_extension_id, 'storage', 'read'),
        (v_extension_id, 'storage', 'write');
    
    RAISE NOTICE 'SoftwareOne Extension registered successfully!';
    RAISE NOTICE 'Extension ID: %', v_extension_id;
    RAISE NOTICE 'Tenant ID: %', v_tenant_id;
    
END $$;