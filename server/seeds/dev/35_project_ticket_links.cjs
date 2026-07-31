const { getFirstTenantSeedContext } = require('./_tenant.cjs');

exports.seed = async function (knex) {
    const context = await getFirstTenantSeedContext(knex);
    if (!context) return;

    const { tenantId, db } = context;
    const projectId = (projectName) => db.table('projects')
        .where({ project_name: projectName })
        .select('project_id')
        .first();
    const phaseId = (phaseName) => db.table('project_phases')
        .where({ phase_name: phaseName })
        .select('phase_id')
        .first();
    const taskId = (taskName) => db.table('project_tasks')
        .where({ task_name: taskName })
        .select('task_id')
        .first();
    const ticketId = (title) => db.table('tickets')
        .where({ title })
        .select('ticket_id')
        .first();

    return db.table('project_ticket_links').insert([
        {
            tenant: tenantId,
            project_id: projectId('Wonderland Expansion'),
            phase_id: phaseId('Territory Survey'),
            task_id: taskId('Map New Areas'),
            ticket_id: ticketId('Survey Uncharted Areas in Wonderland')
        },
        {
            tenant: tenantId,
            project_id: projectId('Emerald City Beautification'),
            phase_id: phaseId('Green Space Enhancement'),
            task_id: taskId('Plant Magical Flowers'),
            ticket_id: ticketId('Enhance Emerald City Gardens')
        }
    ]);
};
