exports.seed = async function (knex) {
    const tenant = await knex('tenants').select('tenant').first();
    if (!tenant) return;

    // Generate project numbers
    const projectNumber1 = await knex.raw(
        `SELECT generate_next_number(:tenant::uuid, 'PROJECT') as number`,
        { tenant: tenant.tenant }
    );
    const projectNumber2 = await knex.raw(
        `SELECT generate_next_number(:tenant::uuid, 'PROJECT') as number`,
        { tenant: tenant.tenant }
    );

    // Insert projects
    const [wonderlandProject, emeraldCityProject] = await knex('projects').insert([
        {
            tenant: tenant.tenant,
            client_id: knex('clients').where({
                tenant: tenant.tenant,
                client_name: 'Wonderland'
            }).select('client_id'),
            project_name: 'Wonderland Expansion',
            description: 'Expanding Wonderland territories and improving infrastructure',
            start_date: knex.raw("CURRENT_DATE - INTERVAL '2 months'"),
            end_date: knex.raw("CURRENT_DATE + INTERVAL '10 months'"),
            wbs_code: '1',
            status: knex('statuses').where({
                tenant: tenant.tenant,
                name: 'Casting in Progress',
                'status_type': 'project'
            }).select('status_id').first(),
            project_number: projectNumber1.rows[0].number
        },
        {
            tenant: tenant.tenant,
            client_id: knex('clients').where({
                tenant: tenant.tenant,
                client_name: 'Emerald City'
            }).select('client_id'),
            project_name: 'Emerald City Beautification',
            description: 'Enhancing the beauty and safety of Emerald City',
            start_date: knex.raw("CURRENT_DATE - INTERVAL '1 month'"),
            end_date: knex.raw("CURRENT_DATE + INTERVAL '5 months'"),
            wbs_code: '2',
            status: knex('statuses').where({
                tenant: tenant.tenant,
                name: 'Casting in Progress',
                'status_type': 'project'
            }).select('status_id').first(),
            project_number: projectNumber2.rows[0].number
        }
    ]).returning('*');
};