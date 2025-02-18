exports.seed = async function (knex) {
    // Get the tenant ID
    const tenant = await knex('tenants').select('tenant').first();
    if (!tenant) return;

    return knex('policies').insert([
        {
            tenant: tenant.tenant,
            policy_name: 'Admin Full Access',
            resource: 'all',
            action: 'all',
            conditions: JSON.stringify([
                {
                    userAttribute: 'roles',
                    operator: 'contains',
                    resourceAttribute: 'Admin'
                }
            ])
        },
        {
            tenant: tenant.tenant,
            policy_name: 'Manager Ticket Access',
            resource: 'ticket',
            action: 'read',
            conditions: JSON.stringify([
                {
                    userAttribute: 'roles',
                    operator: 'contains',
                    resourceAttribute: 'Manager'
                }
            ])
        },
        {
            tenant: tenant.tenant,
            policy_name: 'Technician Ticket View',
            resource: 'ticket',
            action: 'read',
            conditions: JSON.stringify([
                {
                    userAttribute: 'roles',
                    operator: 'contains',
                    resourceAttribute: 'Technician'
                }
            ])
        },
        {
            tenant: tenant.tenant,
            policy_name: 'High Priority Ticket Edit',
            resource: 'ticket',
            action: 'update',
            conditions: JSON.stringify([
                {
                    userAttribute: 'roles',
                    operator: 'contains',
                    resourceAttribute: 'Technician'
                },
                {
                    userAttribute: 'department',
                    operator: '==',
                    resourceAttribute: 'priority'
                }
            ])
        }
    ]);
};