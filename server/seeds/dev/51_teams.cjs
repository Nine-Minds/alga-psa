exports.seed = async function (knex) {
    // Get the tenant ID
    const tenant = await knex('tenants').select('tenant').first();
    if (!tenant) return;

    return knex('teams').insert([
        {
            tenant: tenant.tenant,
            team_id: knex.raw('gen_random_uuid()'),
            team_name: 'Wonderland Team',
            manager_id: knex('users').where({ tenant: tenant.tenant, username: 'glinda' }).select('user_id').first()
        },
        {
            tenant: tenant.tenant,
            team_id: knex.raw('gen_random_uuid()'),
            team_name: 'Oz Team',
            manager_id: knex('users').where({ tenant: tenant.tenant, username: 'dorothy' }).select('user_id').first()
        }
    ]);
};