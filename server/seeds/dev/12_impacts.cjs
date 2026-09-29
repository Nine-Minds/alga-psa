const { getFirstTenantSeedContext } = require('./_tenant.cjs');

exports.seed = async function(knex) {
    const context = await getFirstTenantSeedContext(knex);
    if (!context) return;

    const { tenantId, db } = context;
    const glindaUserId = (await db.table('users')
        .where({ username: 'glinda' })
        .select('user_id')
        .first())?.user_id ?? null;

    return db.table('impacts').insert([
        {
            tenant: tenantId,
            impact_name: 'Individual Inconvenience',
            created_by: glindaUserId
        },
        {
            tenant: tenantId,
            impact_name: 'Local Disruption',
            created_by: glindaUserId
        },
        {
            tenant: tenantId,
            impact_name: 'Realm-Wide Repercussions',
            created_by: glindaUserId
        }
    ]);
};
