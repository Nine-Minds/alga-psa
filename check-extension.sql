-- Check for extension with various name patterns
SELECT id, name, version, is_enabled, created_at
FROM extensions
WHERE name LIKE '%software%' 
   OR name LIKE '%softwareone%'
   OR name = 'SoftwareOne Integration'
   OR manifest->>'id' = 'com.alga.softwareone'
ORDER BY created_at DESC;