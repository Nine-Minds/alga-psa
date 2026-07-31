const { getFirstTenantSeedContext } = require('./_tenant.cjs');

exports.seed = async function (knex) {
    // Get the tenant ID
    const context = await getFirstTenantSeedContext(knex);
    if (!context) return;

    const { tenantId, db } = context;
    return db.table('policies').insert([
        {
            tenant: tenantId,
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
            tenant: tenantId,
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
            tenant: tenantId,
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
            tenant: tenantId,
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
