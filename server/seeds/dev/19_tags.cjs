exports.seed = async function (knex) {
    const tenant = await knex('tenants').select('tenant').first();
    if (!tenant) return;

    // First, create tag definitions
    const tagDefinitions = await knex('tag_definitions').insert([
        {
            tenant: tenant.tenant,
            channel_id: knex('channels')
                .where({
                    tenant: tenant.tenant,
                    channel_name: 'Urgent Matters'
                })
                .select('channel_id')
                .first(),
            tag_text: 'Urgent',
            tagged_type: 'ticket'
        },
        {
            tenant: tenant.tenant,
            channel_id: null,
            tag_text: 'White Rabbit',
            tagged_type: 'ticket'
        }
    ]).returning(['tenant', 'tag_id', 'tag_text', 'tagged_type']);

    // Then, create tag mappings
    const ticketId = await knex('tickets')
        .where({
            tenant: tenant.tenant,
            title: 'Missing White Rabbit'
        })
        .select('ticket_id')
        .first();

    if (ticketId && tagDefinitions.length > 0) {
        await knex('tag_mappings').insert(
            tagDefinitions.map(tagDef => ({
                tenant: tenant.tenant,
                tag_id: tagDef.tag_id,
                tagged_id: ticketId.ticket_id,
                tagged_type: 'ticket'
            }))
        );
    }
};