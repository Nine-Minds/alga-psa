const { getFirstTenantSeedContext } = require('./_tenant.cjs');

exports.seed = async function (knex) {
    const context = await getFirstTenantSeedContext(knex);
    if (!context) return;

    const { tenantId, db } = context;
    const ticketId = (title) => db.table('tickets')
        .where({ title })
        .select('ticket_id')
        .first();

    // Create schedule entries
    const entries = [
        {
            tenant: tenantId,
            title: 'Cheshire Cat Pathways',
            work_item_id: ticketId('Missing White Rabbit'),
            scheduled_start: knex.raw("CURRENT_TIMESTAMP - INTERVAL '1 day'"),
            scheduled_end: knex.raw("CURRENT_TIMESTAMP + INTERVAL '1 day'"),
            status: 'Scheduled',
            notes: 'Planning road network for Wonderland expansion',
            work_item_type: 'project_task'
        },
        {
            tenant: tenantId,
            title: 'Through the Looking Glass Expedition',
            work_item_id: ticketId('Missing White Rabbit'),
            scheduled_start: knex.raw("CURRENT_TIMESTAMP + INTERVAL '2 days'"),
            scheduled_end: knex.raw("CURRENT_TIMESTAMP + INTERVAL '2 days' + INTERVAL '2 hours'"),
            status: 'Scheduled',
            notes: 'Surveying uncharted areas in Wonderland',
            work_item_type: 'ticket'
        },
        {
            tenant: tenantId,
            title: 'Emerald City Garden Enchantment',
            work_item_id: ticketId('Enhance Emerald City Gardens'),
            scheduled_start: knex.raw("CURRENT_TIMESTAMP + INTERVAL '3 days'"),
            scheduled_end: knex.raw("CURRENT_TIMESTAMP + INTERVAL '3 days' + INTERVAL '3 hours'"),
            status: 'Scheduled',
            notes: 'Enhancing Emerald City gardens with magical flora',
            work_item_type: 'ticket'
        }
    ];

    // Insert schedule entries and get their IDs
    const [firstEntry, secondEntry, thirdEntry] = await db.table('schedule_entries')
        .insert(entries)
        .returning(['tenant', 'entry_id']);

    // Get user ID for glinda
    const glinda = await db.table('users')
        .where({ username: 'glinda' })
        .select('user_id')
        .first();

    // Create assignee relationships
    await db.table('schedule_entry_assignees').insert([
        {
            tenant: tenantId,
            entry_id: firstEntry.entry_id,
            user_id: glinda.user_id
        },
        {
            tenant: tenantId,
            entry_id: secondEntry.entry_id,
            user_id: glinda.user_id
        },
        {
            tenant: tenantId,
            entry_id: thirdEntry.entry_id,
            user_id: glinda.user_id
        }
    ]);
};
