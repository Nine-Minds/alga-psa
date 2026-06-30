const { getFirstTenantSeedContext } = require('./_tenant.cjs');

exports.seed = async function(knex) {
    const context = await getFirstTenantSeedContext(knex);
    if (!context) return;

    const { tenantId, db } = context;
    const glindaUserId = db.table('users')
        .where({ username: 'glinda' })
        .select('user_id')
        .first();

    return db.table('interaction_types').insert([
        {
            tenant: tenantId,
            type_name: 'Phone Call',
            display_order: 1,
            created_by: glindaUserId
        },
        {
            tenant: tenantId,
            type_name: 'Email',
            display_order: 2,
            created_by: glindaUserId
        },
        {
            tenant: tenantId,
            type_name: 'In-Person Meeting',
            display_order: 3,
            created_by: glindaUserId
        },
        {
            tenant: tenantId,
            type_name: 'Chat/Instant Message',
            display_order: 4,
            created_by: glindaUserId
        }
    ]);
};
