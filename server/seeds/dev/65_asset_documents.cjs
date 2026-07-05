const { getFirstTenantSeedContext } = require('./_tenant.cjs');

exports.seed = async function(knex) {
    const context = await getFirstTenantSeedContext(knex);
    if (!context) return;

    const { tenantId, db } = context;

    // Get necessary references
    const docType = await db.table('document_types').where({ type_name: 'Manual' }).first();
    const glinda = await db.table('users').where({ username: 'glinda' }).first();
    const assets = await db.table('assets').select('asset_id', 'name');

    if (docType && glinda) {
        const now = new Date().toISOString();

        // Create new documents
        const [doc1, doc2, doc3, doc4] = await db.table('documents').insert([
            {
                tenant: tenantId,
                document_name: 'Ruby Slippers Server Manual',
                type_id: docType.type_id,
                user_id: glinda.user_id,
                created_by: glinda.user_id,
                entered_at: now,
                content: `Ruby Slippers Server Configuration Guide
                    
                    1. Power Management
                    - Ensure magical power crystals are properly aligned
                    - Monitor ruby energy signature levels
                    - Maintain optimal temperature at 20°C
                    
                    2. Performance Optimization
                    - Regular defragmentation of enchanted storage
                    - Memory crystal cleansing procedure
                    - Backup spell configuration
                    
                    3. Troubleshooting
                    - Common magical interference patterns
                    - Emergency power redirection procedures
                    - Crystal realignment steps`
            },
            {
                tenant: tenantId,
                document_name: 'Looking Glass Workstation Guide',
                type_id: docType.type_id,
                user_id: glinda.user_id,
                created_by: glinda.user_id,
                entered_at: now,
                content: `Looking Glass Setup and Maintenance
                    
                    1. Mirror Alignment
                    - Proper reflection angle calibration
                    - Reality distortion prevention
                    - Wonderland portal stability checks
                    
                    2. Display Configuration
                    - Reality-to-screen mapping
                    - Through-the-glass rendering settings
                    - Multi-dimensional display scaling
                    
                    3. Safety Protocols
                    - Emergency reality anchor procedures
                    - Looking glass crack prevention
                    - Reality sync maintenance`
            },
            {
                tenant: tenantId,
                document_name: 'Tea Time Server Procedures',
                type_id: docType.type_id,
                user_id: glinda.user_id,
                created_by: glinda.user_id,
                entered_at: now,
                content: `Mad Hatter's Tea Time Server Guide
                    
                    1. Tea Time Optimization
                    - Server clock synchronization with tea time
                    - Optimal tea temperature monitoring
                    - Unbirthday celebration handling
                    
                    2. Performance Metrics
                    - Teacup/second processing rate
                    - Dormouse awakening prevention
                    - March Hare request routing
                    
                    3. Maintenance Schedule
                    - Daily tea refreshing
                    - Weekly cup rotation
                    - Monthly riddle database update`
            },
            {
                tenant: tenantId,
                document_name: 'Crystal Ball Workstation Setup',
                type_id: docType.type_id,
                user_id: glinda.user_id,
                created_by: glinda.user_id,
                entered_at: now,
                content: `Crystal Ball Configuration Manual
                    
                    1. Initial Setup
                    - Crystal clarity optimization
                    - Future-sight resolution settings
                    - Temporal sync configuration
                    
                    2. Maintenance
                    - Daily crystal polishing procedure
                    - Vision calibration steps
                    - Prophecy cache clearing
                    
                    3. Troubleshooting
                    - Dealing with cloudy visions
                    - Timeline desynchronization fixes
                    - Emergency fortune recovery`
            }
        ]).returning(['document_id', 'document_name']);

        // Create document associations
        await db.table('asset_document_associations').insert([
            {
                tenant: tenantId,
                asset_id: assets.find(a => a.name === 'Ruby Slippers Server').asset_id,
                document_id: doc1.document_id,
                notes: 'Official server documentation and procedures',
                created_by: glinda.user_id,
                created_at: now
            },
            {
                tenant: tenantId,
                asset_id: assets.find(a => a.name === 'Looking Glass Workstation').asset_id,
                document_id: doc2.document_id,
                notes: 'Essential setup and maintenance procedures',
                created_by: glinda.user_id,
                created_at: now
            },
            {
                tenant: tenantId,
                asset_id: assets.find(a => a.name === 'Mad Hatter Tea Time Server').asset_id,
                document_id: doc3.document_id,
                notes: 'Critical tea time server procedures',
                created_by: glinda.user_id,
                created_at: now
            },
            {
                tenant: tenantId,
                asset_id: assets.find(a => a.name === 'Crystal Ball Workstation').asset_id,
                document_id: doc4.document_id,
                notes: 'Workstation setup and maintenance guide',
                created_by: glinda.user_id,
                created_at: now
            }
        ]);
    }
};
