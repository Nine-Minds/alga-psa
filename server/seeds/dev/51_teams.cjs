const { getFirstTenantSeedContext } = require('./_tenant.cjs');

exports.seed = async function (knex) {
    // Get the tenant ID
    const context = await getFirstTenantSeedContext(knex);
    if (!context) return;

    const { tenantId, db } = context;
    const managerId = (username) => db.table('users')
        .where({ username })
        .select('user_id')
        .first();

    return db.table('teams').insert([
        {
            tenant: tenantId,
            team_id: knex.raw('gen_random_uuid()'),
            team_name: 'Wonderland Team',
            manager_id: managerId('glinda')
        },
        {
            tenant: tenantId,
            team_id: knex.raw('gen_random_uuid()'),
            team_name: 'Oz Team',
            manager_id: managerId('dorothy')
        }
    ]);
};
