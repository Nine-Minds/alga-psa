exports.seed = function (knex) {
    return knex('tenants').select('tenant').first()
        .then((tenant) => {
            if (!tenant) return;
            return knex('tickets').insert([
                {
                    tenant: tenant.tenant,
                    title: 'Missing White Rabbit',
                    ticket_number: 'TIC1001',
                    company_id: knex('companies')
                        .where({
                            tenant: tenant.tenant,
                            company_name: 'Emerald City'
                        })
                        .select('company_id')
                        .first(),
                    contact_name_id: knex('contacts')
                        .where({ tenant: tenant.tenant })
                        .whereRaw("full_name ILIKE '%alice%'")
                        .select('contact_name_id')
                        .first(),
                    status_id: knex('statuses')
                        .where({
                            tenant: tenant.tenant,
                            name: 'Curious Beginning'
                        })
                        .select('status_id')
                        .first(),
                    channel_id: knex('channels')
                        .where({
                            tenant: tenant.tenant,
                            channel_name: 'Urgent Matters'
                        })
                        .select('channel_id')
                        .first(),
                    category_id: knex('categories')
                        .where({
                            tenant: tenant.tenant,
                            category_name: 'Magical Artifacts'
                        })
                        .select('category_id')
                        .first(),
                    subcategory_id: knex('categories')
                        .where({
                            tenant: tenant.tenant,
                            category_name: 'Enchanted Accessories'
                        })
                        .select('category_id')
                        .first(),
                    priority_id: knex('priorities')
                        .where({
                            tenant: tenant.tenant,
                            priority_name: 'Enchanted Emergency'
                        })
                        .select('priority_id')
                        .first(),
                    severity_id: knex('severities')
                        .where({
                            tenant: tenant.tenant,
                            severity_name: 'Serious Snarl'
                        })
                        .select('severity_id')
                        .first(),
                    urgency_id: knex('urgencies')
                        .where({
                            tenant: tenant.tenant,
                            urgency_name: 'Hare-Paced Hustle'
                        })
                        .select('urgency_id')
                        .first(),
                    impact_id: knex('impacts')
                        .where({
                            tenant: tenant.tenant,
                            impact_name: 'Realm-Wide Repercussions'
                        })
                        .select('impact_id')
                        .first(),
                    entered_by: knex('users')
                        .where({
                            tenant: tenant.tenant,
                            username: 'glinda'
                        })
                        .select('user_id')
                        .first(),
                    assigned_to: knex('users')
                        .where({
                            tenant: tenant.tenant,
                            username: 'tinman'
                        })
                        .select('user_id')
                        .first(),
                    entered_at: knex.fn.now()
                },
                {
                    tenant: tenant.tenant,
                    title: 'Survey Uncharted Areas in Wonderland',
                    ticket_number: 'TIC1002',
                    company_id: knex('companies')
                        .where({
                            tenant: tenant.tenant,
                            company_name: 'Wonderland'
                        })
                        .select('company_id')
                        .first(),
                    contact_name_id: knex('contacts')
                        .where({ tenant: tenant.tenant })
                        .whereRaw("full_name ILIKE '%alice%'")
                        .select('contact_name_id')
                        .first(),
                    status_id: knex('statuses')
                        .where({
                            tenant: tenant.tenant,
                            name: 'Awaiting Wisdom'
                        })
                        .select('status_id')
                        .first(),
                    channel_id: knex('channels')
                        .where({
                            tenant: tenant.tenant,
                            channel_name: 'Urgent Matters'
                        })
                        .select('channel_id')
                        .first(),
                    category_id: knex('categories')
                        .where({
                            tenant: tenant.tenant,
                            category_name: 'Character Assistance'
                        })
                        .select('category_id')
                        .first(),
                    subcategory_id: knex('categories')
                        .where({
                            tenant: tenant.tenant,
                            category_name: 'Quest Guidance'
                        })
                        .select('category_id')
                        .first(),
                    priority_id: knex('priorities')
                        .where({
                            tenant: tenant.tenant,
                            priority_name: 'Enchanted Emergency'
                        })
                        .select('priority_id')
                        .first(),
                    severity_id: knex('severities')
                        .where({
                            tenant: tenant.tenant,
                            severity_name: 'Moderate Muddle'
                        })
                        .select('severity_id')
                        .first(),
                    urgency_id: knex('urgencies')
                        .where({
                            tenant: tenant.tenant,
                            urgency_name: 'Tick-Tock Task'
                        })
                        .select('urgency_id')
                        .first(),
                    impact_id: knex('impacts')
                        .where({
                            tenant: tenant.tenant,
                            impact_name: 'Local Disruption'
                        })
                        .select('impact_id')
                        .first(),
                    entered_by: knex('users')
                        .where({
                            tenant: tenant.tenant,
                            username: 'glinda'
                        })
                        .select('user_id')
                        .first(),
                    assigned_to: knex('users')
                        .where({
                            tenant: tenant.tenant,
                            username: 'madhatter'
                        })
                        .select('user_id')
                        .first(),
                    entered_at: knex.raw("CURRENT_TIMESTAMP - INTERVAL '2 months'")
                },
                {
                    tenant: tenant.tenant,
                    title: 'Enhance Emerald City Gardens',
                    ticket_number: 'TIC1003',
                    company_id: knex('companies')
                        .where({
                            tenant: tenant.tenant,
                            company_name: 'Emerald City'
                        })
                        .select('company_id')
                        .first(),
                    contact_name_id: knex('contacts')
                        .where({ tenant: tenant.tenant })
                        .whereRaw("full_name ILIKE '%dorothy%'")
                        .select('contact_name_id')
                        .first(),
                    status_id: knex('statuses')
                        .where({
                            tenant: tenant.tenant,
                            name: 'Unfolding Adventure'
                        })
                        .select('status_id')
                        .first(),
                    channel_id: knex('channels')
                        .where({
                            tenant: tenant.tenant,
                            channel_name: 'Projects'
                        })
                        .select('channel_id')
                        .first(),
                    category_id: knex('categories')
                        .where({
                            tenant: tenant.tenant,
                            category_name: 'Realm Maintenance'
                        })
                        .select('category_id')
                        .first(),
                    subcategory_id: knex('categories')
                        .where({
                            tenant: tenant.tenant,
                            category_name: 'Magical Infrastructure'
                        })
                        .select('category_id')
                        .first(),
                    priority_id: knex('priorities')
                        .where({
                            tenant: tenant.tenant,
                            priority_name: 'Curious Conundrum'
                        })
                        .select('priority_id')
                        .first(),
                    severity_id: knex('severities')
                        .where({
                            tenant: tenant.tenant,
                            severity_name: 'Moderate Muddle'
                        })
                        .select('severity_id')
                        .first(),
                    urgency_id: knex('urgencies')
                        .where({
                            tenant: tenant.tenant,
                            urgency_name: 'Tick-Tock Task'
                        })
                        .select('urgency_id')
                        .first(),
                    impact_id: knex('impacts')
                        .where({
                            tenant: tenant.tenant,
                            impact_name: 'Local Disruption'
                        })
                        .select('impact_id')
                        .first(),
                    entered_by: knex('users')
                        .where({
                            tenant: tenant.tenant,
                            username: 'glinda'
                        })
                        .select('user_id')
                        .first(),
                    assigned_to: knex('users')
                        .where({
                            tenant: tenant.tenant,
                            username: 'scarecrow'
                        })
                        .select('user_id')
                        .first(),
                    entered_at: knex.raw("CURRENT_TIMESTAMP - INTERVAL '1 month'")
                }
            ]);
        });
};
