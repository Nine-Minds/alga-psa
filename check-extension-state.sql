-- Check SoftwareOne Extension State
-- This script verifies if the SoftwareOne extension is properly installed and enabled

-- 1. Check if the extension exists in the extensions table
SELECT '=== Extension Records ===' AS section;
SELECT 
    id,
    name,
    version,
    description,
    enabled,
    created_at,
    updated_at
FROM extensions
WHERE name = 'softwareone-ext'
ORDER BY created_at DESC;

-- 2. Show the manifest content for the extension
SELECT '=== Extension Manifest ===' AS section;
SELECT 
    id,
    name,
    manifest::text AS manifest_json
FROM extensions
WHERE name = 'softwareone-ext';

-- 3. Check if it's enabled for any tenants
SELECT '=== Tenant Extensions ===' AS section;
SELECT 
    te.id,
    te.tenant,
    te.extension_id,
    te.enabled,
    te.settings,
    te.created_at,
    te.updated_at,
    e.name AS extension_name,
    e.version AS extension_version
FROM tenant_extensions te
JOIN extensions e ON e.id = te.extension_id
WHERE e.name = 'softwareone-ext'
ORDER BY te.tenant, te.created_at DESC;

-- 4. Show count of enabled tenants
SELECT '=== Summary ===' AS section;
SELECT 
    COUNT(DISTINCT te.tenant) AS total_tenants_with_extension,
    COUNT(DISTINCT CASE WHEN te.enabled = true THEN te.tenant END) AS enabled_tenants
FROM tenant_extensions te
JOIN extensions e ON e.id = te.extension_id
WHERE e.name = 'softwareone-ext';

-- 5. Show any extension storage data (if table exists)
SELECT '=== Extension Storage (if exists) ===' AS section;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'extension_storage') THEN
        EXECUTE 'SELECT tenant, key, value::text, created_at, updated_at FROM extension_storage WHERE extension_id IN (SELECT id FROM extensions WHERE name = ''softwareone-ext'') ORDER BY tenant, key';
    ELSE
        RAISE NOTICE 'extension_storage table does not exist';
    END IF;
END $$;