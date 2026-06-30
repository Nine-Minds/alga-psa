const { getFirstTenantSeedContext } = require('./_tenant.cjs');

exports.seed = async function (knex) {
    const context = await getFirstTenantSeedContext(knex);
    if (!context) return;

    const { tenantId, db } = context;
    // First, create tag definitions
    const tagDefinitions = await db.table('tag_definitions').insert([
        {
            tenant: tenantId,
            board_id: db.table('boards')
                .where({
                    board_name: 'Urgent Matters'
                })
                .select('board_id')
                .first(),
            tag_text: 'Urgent',
            tagged_type: 'ticket'
        },
        {
            tenant: tenantId,
            board_id: null,
            tag_text: 'White Rabbit',
            tagged_type: 'ticket'
        }
    ]).returning(['tenant', 'tag_id', 'tag_text', 'tagged_type']);

    // Then, create tag mappings
    const ticketId = await db.table('tickets')
        .where({
            title: 'Missing White Rabbit'
        })
        .select('ticket_id')
        .first();

    if (ticketId && tagDefinitions.length > 0) {
        await db.table('tag_mappings').insert(
            tagDefinitions.map(tagDef => ({
                tenant: tenantId,
                tag_id: tagDef.tag_id,
                tagged_id: ticketId.ticket_id,
                tagged_type: 'ticket'
            }))
        );
    }
};
