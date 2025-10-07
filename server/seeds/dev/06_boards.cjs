exports.seed = function(knex) {
    return knex('boards').del()
        .then(() => {
            return knex('tenants').select('tenant').first();
        })
        .then((tenant) => {
            if (tenant) {
                return knex('boards').insert([
                    {
                        tenant: tenant.tenant,
                        board_name: 'Urgent Matters',
                        description: 'Critical incidents and high-priority issues',
                        display_order: 1
                    },
                    {
                        tenant: tenant.tenant,
                        board_name: 'General Support',
                        description: 'General inquiries and support requests',
                        is_default: true,
                        display_order: 2
                    },
                    {
                        tenant: tenant.tenant,
                        board_name: 'Technical Issues',
                        description: 'Technical problems and system issues',
                        display_order: 3
                    },
                    {
                        tenant: tenant.tenant,
                        board_name: 'Projects',
                        description: 'Project-related tasks and inquiries',
                        display_order: 4
                    }
                ]);
            }
        });
};