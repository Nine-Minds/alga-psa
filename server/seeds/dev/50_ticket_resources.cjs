const { getFirstTenantSeedContext } = require('./_tenant.cjs');

exports.seed = async function (knex) {
    const context = await getFirstTenantSeedContext(knex);
    if (!context) return;

    const { tenantId, db } = context;

    return db.table('ticket_resources').insert([
        {
            tenant: tenantId,
            ticket_id: db.table('tickets').where({ title: 'Enhance Emerald City Gardens' }).select('ticket_id').first(),
            assigned_to: db.table('users').where({ username: 'scarecrow' }).select('user_id').first(),
            additional_user_id: db.table('users').where({ username: 'glinda' }).select('user_id').first(),
            role: 'Consultant',
            assigned_at: knex.raw("CURRENT_TIMESTAMP - INTERVAL '3 days' - INTERVAL '4 hours'")
        }
    ]);
};
