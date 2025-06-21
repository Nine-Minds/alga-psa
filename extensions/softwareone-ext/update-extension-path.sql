-- Update the extension's main entry point to the correct path
UPDATE extensions 
SET main_entry_point = '/extensions/softwareone-ext/dist/index.js',
    updated_at = CURRENT_TIMESTAMP
WHERE name = 'SoftwareOne Integration';

-- Update component paths in the manifest
UPDATE extensions 
SET manifest = jsonb_set(
    jsonb_set(
        jsonb_set(
            jsonb_set(
                jsonb_set(
                    jsonb_set(
                        manifest,
                        '{components,0,component}',
                        '"/extensions/softwareone-ext/dist/components/NavItem.js"'
                    ),
                    '{components,1,component}',
                    '"/extensions/softwareone-ext/dist/pages/SettingsPage.js"'
                ),
                '{components,2,component}',
                '"/extensions/softwareone-ext/dist/pages/AgreementsList.js"'
            ),
            '{components,3,component}',
            '"/extensions/softwareone-ext/dist/pages/AgreementDetail.js"'
        ),
        '{components,4,component}',
        '"/extensions/softwareone-ext/dist/pages/StatementsList.js"'
    ),
    '{components,5,component}',
    '"/extensions/softwareone-ext/dist/pages/StatementDetail.js"'
),
    updated_at = CURRENT_TIMESTAMP
WHERE name = 'SoftwareOne Integration';

-- Update API handler paths in the manifest
UPDATE extensions 
SET manifest = jsonb_set(
    jsonb_set(
        manifest,
        '{api,endpoints,0,handler}',
        '"/extensions/softwareone-ext/dist/handlers/runSync.js"'
    ),
    '{api,endpoints,1,handler}',
    '"/extensions/softwareone-ext/dist/handlers/activateAgreement.js"'
),
    updated_at = CURRENT_TIMESTAMP
WHERE name = 'SoftwareOne Integration';

-- Verify the update
SELECT id, name, main_entry_point, is_enabled FROM extensions WHERE name = 'SoftwareOne Integration';