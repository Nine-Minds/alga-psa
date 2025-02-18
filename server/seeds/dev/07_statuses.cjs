exports.seed = function (knex) {
    return knex('tenants').select('tenant').first()
        .then((tenant) => {
            if (!tenant) return;
            return knex('statuses').insert([
                {
                    tenant: tenant.tenant,
                    order_number: 1,
                    name: 'Curious Beginning',
                    created_by: knex('users')
                        .where({
                            tenant: tenant.tenant,
                            username: 'glinda'
                        })
                        .select('user_id'),
                    status_type: 'ticket'
                },
                {
                    tenant: tenant.tenant,
                    order_number: 2,
                    name: 'Unfolding Adventure',
                    created_by: knex('users')
                        .where({
                            tenant: tenant.tenant,
                            username: 'glinda'
                        })
                        .select('user_id'),
                    status_type: 'ticket'
                },
                {
                    tenant: tenant.tenant,
                    order_number: 3,
                    name: 'Awaiting Wisdom',
                    created_by: knex('users')
                        .where({
                            tenant: tenant.tenant,
                            username: 'glinda'
                        })
                        .select('user_id'),
                    status_type: 'ticket'
                },
                {
                    tenant: tenant.tenant,
                    order_number: 4,
                    name: 'Magical Resolution',
                    created_by: knex('users')
                        .where({
                            tenant: tenant.tenant,
                            username: 'glinda'
                        })
                        .select('user_id'),
                    status_type: 'ticket'
                },
                {
                    tenant: tenant.tenant,
                    order_number: 5,
                    name: 'Enchanted Closure',
                    created_by: knex('users')
                        .where({
                            tenant: tenant.tenant,
                            username: 'glinda'
                        })
                        .select('user_id'),
                    status_type: 'ticket'
                },
                {
                    tenant: tenant.tenant,
                    order_number: 1,
                    name: 'Initiating Spell',
                    created_by: knex('users')
                        .where({
                            tenant: tenant.tenant,
                            username: 'glinda'
                        })
                        .select('user_id'),
                    status_type: 'project'
                },
                {
                    tenant: tenant.tenant,
                    order_number: 2,
                    name: 'Casting in Progress',
                    created_by: knex('users')
                        .where({
                            tenant: tenant.tenant,
                            username: 'glinda'
                        })
                        .select('user_id'),
                    status_type: 'project'
                },
                {
                    tenant: tenant.tenant,
                    order_number: 3,
                    name: 'Magical Review',
                    created_by: knex('users')
                        .where({
                            tenant: tenant.tenant,
                            username: 'glinda'
                        })
                        .select('user_id'),
                    status_type: 'project'
                },
                {
                    tenant: tenant.tenant,
                    order_number: 4,
                    name: 'Enchantment Complete',
                    created_by: knex('users')
                        .where({
                            tenant: tenant.tenant,
                            username: 'glinda'
                        })
                        .select('user_id'),
                    status_type: 'project'
                },
                {
                    tenant: tenant.tenant,
                    order_number: 5,
                    name: 'Spell Archived',
                    created_by: knex('users')
                        .where({
                            tenant: tenant.tenant,
                            username: 'glinda'
                        })
                        .select('user_id'),
                    status_type: 'project'
                },
                {
                    tenant: tenant.tenant,
                    order_number: 1,
                    name: 'Incantation Pending',
                    created_by: knex('users')
                        .where({
                            tenant: tenant.tenant,
                            username: 'glinda'
                        })
                        .select('user_id'),
                    status_type: 'project_task'
                },
                {
                    tenant: tenant.tenant,
                    order_number: 2,
                    name: 'Brewing Potion',
                    created_by: knex('users')
                        .where({
                            tenant: tenant.tenant,
                            username: 'glinda'
                        })
                        .select('user_id'),
                    status_type: 'project_task'
                },
                {
                    tenant: tenant.tenant,
                    order_number: 3,
                    name: 'Wand-Waving',
                    created_by: knex('users')
                        .where({
                            tenant: tenant.tenant,
                            username: 'glinda'
                        })
                        .select('user_id'),
                    status_type: 'project_task'
                },
                {
                    tenant: tenant.tenant,
                    order_number: 4,
                    name: 'Spell Testing',
                    created_by: knex('users')
                        .where({
                            tenant: tenant.tenant,
                            username: 'glinda'
                        })
                        .select('user_id'),
                    status_type: 'project_task'
                },
                {
                    tenant: tenant.tenant,
                    order_number: 5,
                    name: 'Magic Accomplished',
                    created_by: knex('users')
                        .where({
                            tenant: tenant.tenant,
                            username: 'glinda'
                        })
                        .select('user_id'),
                    status_type: 'project_task'
                }
            ]);
        });
};