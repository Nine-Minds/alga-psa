exports.seed = function (knex) {
    return knex('tenants').select('tenant').first()
        .then((tenant) => {
            if (!tenant) return;
            return knex('approval_thresholds').insert([
                {
                    tenant: tenant.tenant,
                    type: 'OVERTIME',
                    threshold: 40,
                    approval_level_id: knex('approval_levels').where({ 
                        tenant: tenant.tenant, 
                        name: 'Team Lead' 
                    }).select('id').first()
                },
                {
                    tenant: tenant.tenant,
                    type: 'HIGH_VALUE',
                    threshold: 1000,
                    approval_level_id: knex('approval_levels').where({ 
                        tenant: tenant.tenant, 
                        name: 'Manager' 
                    }).select('id').first()
                }
            ]);
        });
};