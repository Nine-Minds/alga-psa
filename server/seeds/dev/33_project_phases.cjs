const { getFirstTenantSeedContext } = require('./_tenant.cjs');

exports.seed = async function (knex) {
    const context = await getFirstTenantSeedContext(knex);
    if (!context) return;

    const { tenantId, db } = context;
    const projectId = (projectName) => db.table('projects')
        .where({ project_name: projectName })
        .select('project_id')
        .first();

    return db.table('project_phases').insert([
        {
            tenant: tenantId,
            project_id: projectId('Wonderland Expansion'),
            phase_name: 'Territory Survey',
            description: 'Surveying new areas for expansion',
            start_date: knex.raw("CURRENT_DATE - INTERVAL '2 months'"),
            end_date: knex.raw("CURRENT_DATE - INTERVAL '1 month'"),
            status: 'Completed',
            wbs_code: '1.1',
            order_number: 1
        },
        {
            tenant: tenantId,
            project_id: projectId('Wonderland Expansion'),
            phase_name: 'Infrastructure Planning',
            description: 'Planning new infrastructure for expanded areas',
            start_date: knex.raw("CURRENT_DATE - INTERVAL '1 month'"),
            end_date: knex.raw("CURRENT_DATE + INTERVAL '1 month'"),
            status: 'In Progress',
            wbs_code: '1.2',
            order_number: 2
        },
        {
            tenant: tenantId,
            project_id: projectId('Emerald City Beautification'),
            phase_name: 'Green Space Enhancement',
            description: 'Improving parks and gardens in Emerald City',
            start_date: knex.raw("CURRENT_DATE - INTERVAL '1 month'"),
            end_date: knex.raw("CURRENT_DATE + INTERVAL '2 months'"),
            status: 'In Progress',
            wbs_code: '2.1',
            order_number: 1
        }
    ]);
};
