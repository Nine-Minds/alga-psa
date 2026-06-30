const { getFirstTenantSeedContext } = require('./_tenant.cjs');

exports.seed = async function(knex) {
    const context = await getFirstTenantSeedContext(knex);
    if (!context) return;

    const { tenantId, db } = context;
    const glindaUserId = db.table('users')
        .where({ username: 'glinda' })
        .select('user_id')
        .first();

    return db.table('priorities').insert([
        {
            tenant: tenantId,
            priority_name: 'Whimsical Wish',
            order_number: 1,
            created_by: glindaUserId
        },
        {
            tenant: tenantId,
            priority_name: 'Curious Conundrum',
            order_number: 2,
            created_by: glindaUserId
        },
        {
            tenant: tenantId,
            priority_name: 'Enchanted Emergency',
            order_number: 3,
            created_by: glindaUserId
        }
    ]);
};
