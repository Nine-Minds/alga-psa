const { getFirstTenantSeedContext } = require('./_tenant.cjs');

exports.seed = async function(knex) {
    const context = await getFirstTenantSeedContext(knex);
    if (!context) return;

    const { tenantId, db } = context;
    const glindaUserId = db.table('users')
        .where({ username: 'glinda' })
        .select('user_id')
        .first();

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
