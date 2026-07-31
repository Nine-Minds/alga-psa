const { getFirstTenantSeedContext } = require('./_tenant.cjs');

exports.seed = async function (knex) {
    const context = await getFirstTenantSeedContext(knex);
    if (!context) return;

    const { tenantId, db } = context;
    const teamId = (teamName) => db.table('teams')
        .where({ team_name: teamName })
        .select('team_id')
        .first();
    const userId = (username) => db.table('users')
        .where({ username })
        .select('user_id')
        .first();

    return db.table('team_members').insert([
        {
            tenant: tenantId,
            team_id: teamId('Wonderland Team'),
            user_id: userId('glinda')
        },
        {
            tenant: tenantId,
            team_id: teamId('Oz Team'),
            user_id: userId('dorothy')
        },
        {
            tenant: tenantId,
            team_id: teamId('Oz Team'),
            user_id: userId('scarecrow')
        }
    ]);
};
