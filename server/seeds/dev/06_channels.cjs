exports.seed = function(knex) {
    return knex('channels').del()
        .then(() => {
            return knex('tenants').select('tenant').first();
        })
        .then((tenant) => {
            if (tenant) {
                return knex('channels').insert([
                    {
                        tenant: tenant.tenant,
                        channel_name: 'Urgent Matters',
                        description: 'Critical incidents and high-priority issues',
                        display_order: 1
                    },
                    {
                        tenant: tenant.tenant,
                        channel_name: 'General Support',
                        description: 'General inquiries and support requests',
                        is_default: true,
                        display_order: 2
                    },
                    {
                        tenant: tenant.tenant,
                        channel_name: 'Technical Issues',
                        description: 'Technical problems and system issues',
                        display_order: 3
                    },
                    {
                        tenant: tenant.tenant,
                        channel_name: 'Projects',
                        description: 'Project-related tasks and inquiries',
                        display_order: 4
                    }
                ]);
            }
        });
};