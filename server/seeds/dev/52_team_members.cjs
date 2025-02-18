exports.seed = async function (knex) {
    // Get the tenant ID
    const tenant = await knex('tenants').select('tenant').first();
    if (!tenant) return;

    return knex('team_members').insert([
        {
            tenant: tenant.tenant,
            team_id: knex('teams').where({ tenant: tenant.tenant, team_name: 'Wonderland Team' }).select('team_id').first(),
            user_id: knex('users').where({ tenant: tenant.tenant, username: 'glinda' }).select('user_id').first()
        },
        {
            tenant: tenant.tenant,
            team_id: knex('teams').where({ tenant: tenant.tenant, team_name: 'Oz Team' }).select('team_id').first(),
            user_id: knex('users').where({ tenant: tenant.tenant, username: 'dorothy' }).select('user_id').first()
        },
        {
            tenant: tenant.tenant,
            team_id: knex('teams').where({ tenant: tenant.tenant, team_name: 'Oz Team' }).select('team_id').first(),
            user_id: knex('users').where({ tenant: tenant.tenant, username: 'scarecrow' }).select('user_id').first()
        }
    ]);
};