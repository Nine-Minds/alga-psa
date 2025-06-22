-- Debug extension data
SELECT 
    id,
    name,
    manifest->>'id' as manifest_id,
    manifest->>'name' as manifest_name,
    is_enabled,
    created_at
FROM extensions
WHERE name = 'softwareone-ext' OR manifest->>'id' = 'com.alga.softwareone'
ORDER BY created_at DESC
LIMIT 5;