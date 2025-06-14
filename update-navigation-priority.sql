-- Update the SoftwareOne navigation item priority to appear with main navigation
UPDATE extensions 
SET manifest = jsonb_set(
    manifest,
    '{components,0,props,priority}',
    '50'::jsonb
)
WHERE name = 'SoftwareOne Integration' 
AND manifest->'components'->0->>'slot' = 'main-navigation';

-- Also update the path to use the correct routing
UPDATE extensions 
SET manifest = jsonb_set(
    manifest,
    '{components,0,props,path}',
    '"/ext/softwareone/agreements"'::jsonb
)
WHERE name = 'SoftwareOne Integration' 
AND manifest->'components'->0->>'slot' = 'main-navigation';

-- Show the updated navigation item
SELECT id, name, 
       manifest->'components'->0->'props'->>'priority' as priority,
       manifest->'components'->0->'props'->>'path' as path,
       manifest->'components'->0->'props'->>'label' as label
FROM extensions
WHERE name = 'SoftwareOne Integration';