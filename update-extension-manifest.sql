-- Update the SoftwareOne extension manifest in the database
UPDATE extensions 
SET manifest = jsonb_set(
    manifest,
    '{components,0,component}',
    '"descriptors/navigation/NavItemSimple.json"'::jsonb
)
WHERE name = 'softwareone-ext' 
AND manifest->'components'->0->>'slot' = 'main-navigation';

-- Show the updated manifest
SELECT id, name, manifest->'components'->0 as main_nav_component
FROM extensions
WHERE name = 'softwareone-ext';