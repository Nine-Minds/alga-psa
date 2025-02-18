exports.seed = function (knex) {
    return knex('tenants').select('tenant').first()
        .then((tenant) => {
            if (!tenant) return;
            return knex('schedules').insert([
                {
                    tenant: tenant.tenant,
                    ticket_id: knex('tickets')
                        .where({
                            tenant: tenant.tenant,
                            title: 'Missing White Rabbit'
                        })
                        .select('ticket_id')
                        .first(),
                    user_id: knex('users')
                        .where({
                            tenant: tenant.tenant,
                            username: 'glinda'
                        })
                        .select('user_id')
                        .first(),
                    contact_name_id: knex('contacts')
                        .where({ tenant: tenant.tenant })
                        .whereRaw("full_name ILIKE '%alice%'")
                        .select('contact_name_id')
                        .first(),
                    company_id: knex('companies')
                        .where({
                            tenant: tenant.tenant,
                            company_name: 'Wonderland'
                        })
                        .select('company_id')
                        .first(),
                    status: 'In Progress',
                    scheduled_start: knex.raw("CURRENT_TIMESTAMP - INTERVAL '3 hours'"),
                    scheduled_end: knex.raw("CURRENT_TIMESTAMP + INTERVAL '1 hour'"),
                    actual_start: knex.raw("CURRENT_TIMESTAMP - INTERVAL '2 hours'"),
                    duration_minutes: 120,
                    description: 'searching for rabbit'
                }
            ]);
        });
};