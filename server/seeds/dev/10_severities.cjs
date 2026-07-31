const { getFirstTenantSeedContext } = require('./_tenant.cjs');

exports.seed = async function(knex) {
    const context = await getFirstTenantSeedContext(knex);
    if (!context) return;

    const { tenantId, db } = context;
    const glindaUserId = db.table('users')
        .where({ username: 'glinda' })
        .select('user_id')
        .first();

    return db.table('severities').insert([
        {
            tenant: tenantId,
            severity_name: 'Trifling Trouble',
            created_by: glindaUserId
        },
        {
            tenant: tenantId,
            severity_name: 'Moderate Muddle',
            created_by: glindaUserId
        },
        {
            tenant: tenantId,
            severity_name: 'Serious Snarl',
            created_by: glindaUserId
        }
    ]);
};
