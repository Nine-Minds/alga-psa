const { getFirstTenantSeedContext } = require('./_tenant.cjs');

exports.seed = async function(knex) {
    // Get necessary references
    const context = await getFirstTenantSeedContext(knex);
    if (!context) return;

    const { tenantId, db } = context;
    const [glinda, scarecrow, madhatter] = await db.table('users')
        .whereIn('username', ['glinda', 'scarecrow', 'madhatter'])
        .select('user_id', 'username');
    
    const [emeraldCity, wonderland] = await db.table('clients')
        .whereIn('client_name', ['Emerald City', 'Wonderland'])
        .select('client_id', 'client_name');

    const mainCategory = await db.table('categories')
        .where({ category_name: 'Realm Maintenance' })
        .first();
    
    const subCategory = await db.table('categories')
        .where({ category_name: 'Magical Infrastructure' })
        .first();

    const board = await db.table('boards')
        .where({ board_name: 'Urgent Matters' })
        .first();

    const statuses = board ? await db.table('statuses')
        .where({ board_id: board.board_id })
        .whereIn('name', ['Curious Beginning', 'Unfolding Adventure'])
        .select('status_id', 'name') : [];

    const priority = await db.table('priorities')
        .where({ priority_name: 'Enchanted Emergency' })
        .first();

    const severity = await db.table('severities')
        .where({ severity_name: 'Moderate Muddle' })
        .first();

    const urgency = await db.table('urgencies')
        .where({ urgency_name: 'Tick-Tock Task' })
        .first();

    const impact = await db.table('impacts')
        .where({ impact_name: 'Local Disruption' })
        .first();

    if (glinda && emeraldCity && wonderland && mainCategory && subCategory) {
        const now = new Date();
        const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
        const oneDayAgo = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
        const oneMonthFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
        const twoWeeksFromNow = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

        // Create new asset-related tickets
        const [ticket1, ticket2] = await db.table('tickets').insert([
            {
                tenant: tenantId,
                title: 'Ruby Slippers Server Power Fluctuation',
                ticket_number: 'TIC1006',
                client_id: emeraldCity.client_id,
                status_id: statuses.find(s => s.name === 'Curious Beginning').status_id,
                board_id: board.board_id,
                category_id: mainCategory.category_id,
                subcategory_id: subCategory.category_id,
                priority_id: priority.priority_id,
                severity_id: severity.severity_id,
                urgency_id: urgency.urgency_id,
                impact_id: impact.impact_id,
                entered_by: glinda.user_id,
                assigned_to: scarecrow.user_id,
                entered_at: now.toISOString()
            },
            {
                tenant: tenantId,
                title: 'Tea Time Server Performance Issues',
                ticket_number: 'TIC1007',
                client_id: wonderland.client_id,
                status_id: statuses.find(s => s.name === 'Unfolding Adventure').status_id,
                board_id: board.board_id,
                category_id: mainCategory.category_id,
                subcategory_id: subCategory.category_id,
                priority_id: priority.priority_id,
                severity_id: severity.severity_id,
                urgency_id: urgency.urgency_id,
                impact_id: impact.impact_id,
                entered_by: glinda.user_id,
                assigned_to: madhatter.user_id,
                entered_at: now.toISOString()
            }
        ]).returning(['ticket_id', 'title']);

        // Get asset references
        const assets = await db.table('assets')
            .whereIn('name', ['Ruby Slippers Server', 'Mad Hatter Tea Time Server'])
            .select('asset_id', 'name');

        // Create asset ticket associations
        await db.table('asset_ticket_associations').insert([
            {
                tenant: tenantId,
                asset_id: assets.find(a => a.name === 'Ruby Slippers Server').asset_id,
                ticket_id: ticket1.ticket_id,
                association_type: 'primary',
                notes: 'Server experiencing magical power fluctuations',
                created_by: glinda.user_id,
                created_at: now.toISOString()
            },
            {
                tenant: tenantId,
                asset_id: assets.find(a => a.name === 'Mad Hatter Tea Time Server').asset_id,
                ticket_id: ticket2.ticket_id,
                association_type: 'primary',
                notes: 'Performance issues during tea time peak hours',
                created_by: glinda.user_id,
                created_at: now.toISOString()
            }
        ]);

        // Create service history entries
        await db.table('asset_service_history').insert([
            {
                tenant: tenantId,
                asset_id: assets.find(a => a.name === 'Ruby Slippers Server').asset_id,
                ticket_id: ticket1.ticket_id,
                service_type: 'repair',
                description: 'Stabilized magical power crystal alignment',
                service_details: {
                    power_level_before: '65%',
                    power_level_after: '98%',
                    crystals_realigned: true,
                    magical_interference: 'minimal'
                },
                service_date: twoDaysAgo.toISOString(),
                next_service_date: oneMonthFromNow.toISOString(),
                performed_by: scarecrow.user_id,
                created_at: twoDaysAgo.toISOString()
            },
            {
                tenant: tenantId,
                asset_id: assets.find(a => a.name === 'Mad Hatter Tea Time Server').asset_id,
                ticket_id: ticket2.ticket_id,
                service_type: 'maintenance',
                description: 'Optimized tea time processing algorithms',
                service_details: {
                    performance_before: '75%',
                    performance_after: '95%',
                    tea_types_optimized: ['Earl Grey', 'Chamomile', 'Wonderland Special'],
                    unbirthday_handling: 'improved'
                },
                service_date: oneDayAgo.toISOString(),
                next_service_date: twoWeeksFromNow.toISOString(),
                performed_by: madhatter.user_id,
                created_at: oneDayAgo.toISOString()
            }
        ]);
    }
};
