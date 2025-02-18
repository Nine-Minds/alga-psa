exports.seed = function (knex) {   
    return knex('permissions').del()
        .then(() => {
            return knex('permissions').insert([
                {
                    tenant: knex('tenants').select('tenant').first(),
                    resource: 'ticket',
                    action: 'create'
                },
                {
                    tenant: knex('tenants').select('tenant').first(),
                    resource: 'ticket',
                    action: 'read'
                },
                {
                    tenant: knex('tenants').select('tenant').first(),
                    resource: 'ticket',
                    action: 'update'
                },
                {
                    tenant: knex('tenants').select('tenant').first(),
                    resource: 'ticket',
                    action: 'delete'
                },
                {
                    tenant: knex('tenants').select('tenant').first(),
                    resource: 'user',
                    action: 'create'
                },
                {
                    tenant: knex('tenants').select('tenant').first(),
                    resource: 'user',
                    action: 'read'
                },
                {
                    tenant: knex('tenants').select('tenant').first(),
                    resource: 'user',
                    action: 'update'
                },
                {
                    tenant: knex('tenants').select('tenant').first(),
                    resource: 'user',
                    action: 'delete'
                }                
            ]);
        });
};