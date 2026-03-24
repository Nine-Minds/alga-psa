exports.seed = async function (knex) {
    const tenant = await knex('tenants').select('tenant').first();
    if (!tenant) return;

    const boards = await knex('boards')
        .where({ tenant: tenant.tenant })
        .select('board_id');

    const createdBy = knex('users')
        .where({
            tenant: tenant.tenant,
            username: 'glinda'
        })
        .select('user_id');

    const ticketStatusTemplates = [
        {
            order_number: 1,
            name: 'Curious Beginning',
            status_type: 'ticket',
            is_default: true
        },
        {
            order_number: 2,
            name: 'Unfolding Adventure',
            status_type: 'ticket'
        },
        {
            order_number: 3,
            name: 'Awaiting Wisdom',
            status_type: 'ticket'
        },
        {
            order_number: 4,
            name: 'Magical Resolution',
            status_type: 'ticket'
        },
        {
            order_number: 5,
            name: 'Enchanted Closure',
            status_type: 'ticket'
        }
    ];

    const ticketStatuses = boards.flatMap((board) =>
        ticketStatusTemplates.map((status) => ({
            tenant: tenant.tenant,
            board_id: board.board_id,
            created_by: createdBy,
            ...status
        }))
    );

    return knex('statuses').insert([
                ...ticketStatuses,
                {
                    tenant: tenant.tenant,
                    order_number: 1,
                    name: 'Initiating Spell',
                    created_by: createdBy,
                    status_type: 'project'
                },
                {
                    tenant: tenant.tenant,
                    order_number: 2,
                    name: 'Casting in Progress',
                    created_by: createdBy,
                    status_type: 'project'
                },
                {
                    tenant: tenant.tenant,
                    order_number: 3,
                    name: 'Magical Review',
                    created_by: createdBy,
                    status_type: 'project'
                },
                {
                    tenant: tenant.tenant,
                    order_number: 4,
                    name: 'Enchantment Complete',
                    created_by: createdBy,
                    status_type: 'project'
                },
                {
                    tenant: tenant.tenant,
                    order_number: 5,
                    name: 'Spell Archived',
                    created_by: createdBy,
                    status_type: 'project'
                },
                {
                    tenant: tenant.tenant,
                    order_number: 1,
                    name: 'Incantation Pending',
                    created_by: createdBy,
                    status_type: 'project_task',
                    color: '#6B7280', // Gray
                    icon: 'Clipboard'
                },
                {
                    tenant: tenant.tenant,
                    order_number: 2,
                    name: 'Brewing Potion',
                    created_by: createdBy,
                    status_type: 'project_task',
                    color: '#F59E0B', // Amber
                    icon: 'Hourglass'
                },
                {
                    tenant: tenant.tenant,
                    order_number: 3,
                    name: 'Wand-Waving',
                    created_by: createdBy,
                    status_type: 'project_task',
                    color: '#3B82F6', // Blue
                    icon: 'PlayCircle'
                },
                {
                    tenant: tenant.tenant,
                    order_number: 4,
                    name: 'Spell Testing',
                    created_by: createdBy,
                    status_type: 'project_task',
                    color: '#8B5CF6', // Purple
                    icon: 'Activity'
                },
                {
                    tenant: tenant.tenant,
                    order_number: 5,
                    name: 'Magic Accomplished',
                    created_by: createdBy,
                    status_type: 'project_task',
                    color: '#10B981', // Green
                    icon: 'CheckCircle'
                },
                {
                    tenant: tenant.tenant,
                    order_number: 1,
                    name: 'Crystal Ball Awaiting',
                    created_by: createdBy,
                    status_type: 'interaction'
                },
                {
                    tenant: tenant.tenant,
                    order_number: 2,
                    name: 'Yellow Brick Chat',
                    created_by: createdBy,
                    status_type: 'interaction'
                },
                {
                    tenant: tenant.tenant,
                    order_number: 3,
                    name: 'Emerald Communication',
                    created_by: createdBy,
                    status_type: 'interaction',
                    is_closed: true,
                    is_default: true
                },
                {
                    tenant: tenant.tenant,
                    order_number: 4,
                    name: 'Tornado Interrupted',
                    created_by: createdBy,
                    status_type: 'interaction',
                    is_closed: true
                }
            ]);
};
