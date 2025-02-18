exports.seed = function (knex) {
    return knex('tenants').select('tenant').first()
        .then((tenant) => {
            if (!tenant) return;
            return knex('tags').insert([
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
                    tagged_id: knex('tickets')
                        .where({
                            tenant: tenant.tenant,
                            title: 'Missing White Rabbit'
                        })
                        .select('ticket_id')
                        .first(),
                    tagged_type: 'ticket'
                },
                {
                    tenant: tenant.tenant,
                    channel_id: null,
                    tag_text: 'White Rabbit',
                    tagged_id: knex('tickets')
                        .where({
                            tenant: tenant.tenant,
                            title: 'Missing White Rabbit'
                        })
                        .select('ticket_id')
                        .first(),
                    tagged_type: 'ticket'
                }
            ]);
        });
};