const { v4: uuidv4 } = require('uuid');

exports.seed = async function (knex, tenantId) {
    // Use provided tenantId or fall back to first tenant
    if (!tenantId) {
        const tenant = await knex('tenants').select('tenant').first();
        if (!tenant) {
            console.log('No tenant found, skipping project task statuses seed');
            return;
        }
        tenantId = tenant.tenant;
    }

    // Check if project task statuses already exist for this tenant
    const existingStatuses = await knex('statuses')
        .where({
            tenant: tenantId,
            status_type: 'project_task'
        })
        .first();

    if (!existingStatuses) {
        const defaultStatuses = [
            {
                status_id: uuidv4(),
                name: 'To Do',
                status_type: 'project_task',
                order_number: 1,
                is_closed: false,
                is_default: true,
                item_type: 'project_task',
                color: '#6B7280', // Gray
                icon: 'Clipboard',
                tenant: tenantId,
                created_by: null, // No user exists yet during tenant creation
                created_at: knex.fn.now()
            },
            {
                status_id: uuidv4(),
                name: 'In Progress',
                status_type: 'project_task',
                order_number: 2,
                is_closed: false,
                is_default: false,
                item_type: 'project_task',
                color: '#3B82F6', // Blue
                icon: 'PlayCircle',
                tenant: tenantId,
                created_by: null, // No user exists yet during tenant creation
                created_at: knex.fn.now()
            },
            {
                status_id: uuidv4(),
                name: 'Done',
                status_type: 'project_task',
                order_number: 3,
                is_closed: true,
                is_default: false,
                item_type: 'project_task',
                color: '#10B981', // Green
                icon: 'CheckCircle',
                tenant: tenantId,
                created_by: null, // No user exists yet during tenant creation
                created_at: knex.fn.now()
            }
        ];

        await knex('statuses').insert(defaultStatuses);
        console.log(`Created default project task statuses in statuses table for tenant ${tenantId}`);
    } else {
        console.log(`Project task statuses already exist for tenant ${tenantId}`);
    }
};