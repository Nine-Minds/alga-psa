exports.seed = function (knex) {
    return knex('tenants').select('tenant').first()
        .then((tenant) => {
            if (!tenant) return;
            return knex('resources').insert([
                {
                    tenant: tenant.tenant,
                    user_id: knex('users').where({ 
                        tenant: tenant.tenant, 
                        username: 'glinda' 
                    }).select('user_id').first(),
                    availability: JSON.stringify([
                        {
                            monday: true,
                            tuesday: true,
                            wednesday: true,
                            thursday: true,
                            friday: true
                        }
                    ]),
                    skills: ['magic', 'project management', 'customer service'],
                    max_daily_capacity: 8,
                    max_weekly_capacity: 40
                }
            ]);
        });
};