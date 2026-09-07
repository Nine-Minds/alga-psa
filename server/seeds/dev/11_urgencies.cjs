const { getFirstTenantSeedContext } = require('./_tenant.cjs');

exports.seed = async function(knex) {
    const context = await getFirstTenantSeedContext(knex);
    if (!context) return;

    const { tenantId, db } = context;
    const glindaUserId = (await db.table('users')
        .where({ username: 'glinda' })
        .select('user_id')
        .first())?.user_id ?? null;

    return db.table('urgencies').insert([
        {
            tenant: tenantId,
            urgency_name: 'Leisurely Lark',
            created_by: glindaUserId
        },
        {
            tenant: tenantId,
            urgency_name: 'Tick-Tock Task',
            created_by: glindaUserId
        },
        {
            tenant: tenantId,
            urgency_name: 'Hare-Paced Hustle',
            created_by: glindaUserId
        }
    ]);
};
