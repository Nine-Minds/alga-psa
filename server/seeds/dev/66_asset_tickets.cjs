exports.seed = async function(knex) {
    // Get necessary references
    const tenant = await knex('tenants').select('tenant').first();
    const [glinda, scarecrow, madhatter] = await knex('users')
        .whereIn('username', ['glinda', 'scarecrow', 'madhatter'])
        .select('user_id', 'username');
    
    const [emeraldCity, wonderland] = await knex('companies')
        .whereIn('company_name', ['Emerald City', 'Wonderland'])
        .select('company_id', 'company_name');

    const statuses = await knex('statuses')
        .whereIn('name', ['Curious Beginning', 'Unfolding Adventure'])
        .select('status_id', 'name');
    
    const mainCategory = await knex('categories')
        .where({ category_name: 'Realm Maintenance' })
        .first();
    
    const subCategory = await knex('categories')
        .where({ category_name: 'Magical Infrastructure' })
        .first();

    const board = await knex('boards')
        .where({ board_name: 'Urgent Matters' })
        .first();

    const priority = await knex('priorities')
        .where({ priority_name: 'Enchanted Emergency' })
        .first();

    const severity = await knex('severities')
        .where({ severity_name: 'Moderate Muddle' })
        .first();

    const urgency = await knex('urgencies')
        .where({ urgency_name: 'Tick-Tock Task' })
        .first();

    const impact = await knex('impacts')
        .where({ impact_name: 'Local Disruption' })
        .first();

    if (tenant && glinda && emeraldCity && wonderland && mainCategory && subCategory) {
        const now = new Date();
        const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
        const oneDayAgo = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
        const oneMonthFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
        const twoWeeksFromNow = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

        // Create new asset-related tickets
        const [ticket1, ticket2] = await knex('tickets').insert([
            {
                tenant: tenant.tenant,
                title: 'Ruby Slippers Server Power Fluctuation',
                ticket_number: 'TIC1006',
                company_id: emeraldCity.company_id,
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
                tenant: tenant.tenant,
                title: 'Tea Time Server Performance Issues',
                ticket_number: 'TIC1007',
                company_id: wonderland.company_id,
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
        const assets = await knex('assets')
            .whereIn('name', ['Ruby Slippers Server', 'Mad Hatter Tea Time Server'])
            .select('asset_id', 'name');

        // Create asset ticket associations
        await knex('asset_ticket_associations').insert([
            {
                tenant: tenant.tenant,
                asset_id: assets.find(a => a.name === 'Ruby Slippers Server').asset_id,
                ticket_id: ticket1.ticket_id,
                association_type: 'primary',
                notes: 'Server experiencing magical power fluctuations',
                created_by: glinda.user_id,
                created_at: now.toISOString()
            },
            {
                tenant: tenant.tenant,
                asset_id: assets.find(a => a.name === 'Mad Hatter Tea Time Server').asset_id,
                ticket_id: ticket2.ticket_id,
                association_type: 'primary',
                notes: 'Performance issues during tea time peak hours',
                created_by: glinda.user_id,
                created_at: now.toISOString()
            }
        ]);

        // Create service history entries
        await knex('asset_service_history').insert([
            {
                tenant: tenant.tenant,
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
                tenant: tenant.tenant,
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
