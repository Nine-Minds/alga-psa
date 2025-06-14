-- Update the SoftwareOne extension manifest with routes
UPDATE extensions 
SET manifest = jsonb_set(
    jsonb_set(
        manifest,
        '{components,0,props,path}',
        '"/ext/softwareone/agreements"'::jsonb
    ),
    '{routes}',
    '[
        {
            "path": "/agreements",
            "component": "descriptors/pages/AgreementsList.json"
        },
        {
            "path": "/agreements/:id",
            "component": "descriptors/pages/AgreementDetail.json"
        },
        {
            "path": "/statements",
            "component": "descriptors/pages/StatementsList.json"
        },
        {
            "path": "/statements/:id",
            "component": "descriptors/pages/StatementDetail.json"
        },
        {
            "path": "/settings",
            "component": "descriptors/pages/SettingsPage.json"
        }
    ]'::jsonb
)
WHERE name = 'SoftwareOne Integration';

-- Show the updated manifest
SELECT id, name, manifest->'routes' as routes, manifest->'components'->0->'props'->>'path' as nav_path
FROM extensions
WHERE name = 'SoftwareOne Integration';