const { getFirstTenantSeedContext } = require('./_tenant.cjs');

exports.seed = async function (knex) {
    const context = await getFirstTenantSeedContext(knex);
    if (!context) return;

    const { tenantId, db } = context;
    const teamId = async (teamName) => (await db.table('teams')
        .where({ team_name: teamName })
        .select('team_id')
        .first())?.team_id ?? null;
    const userId = async (username) => (await db.table('users')
        .where({ username })
        .select('user_id')
        .first())?.user_id ?? null;

    return db.table('team_members').insert([
        {
            tenant: tenantId,
            team_id: await teamId('Wonderland Team'),
            user_id: await userId('glinda')
        },
        {
            tenant: tenantId,
            team_id: await teamId('Oz Team'),
            user_id: await userId('dorothy')
        },
        {
            tenant: tenantId,
            team_id: await teamId('Oz Team'),
            user_id: await userId('scarecrow')
        }
    ]);
};
