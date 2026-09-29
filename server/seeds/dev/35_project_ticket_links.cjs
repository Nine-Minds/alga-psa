const { getFirstTenantSeedContext } = require('./_tenant.cjs');

exports.seed = async function (knex) {
    const context = await getFirstTenantSeedContext(knex);
    if (!context) return;

    const { tenantId, db } = context;
    const projectId = async (projectName) => (await db.table('projects')
        .where({ project_name: projectName })
        .select('project_id')
        .first())?.project_id ?? null;
    const phaseId = async (phaseName) => (await db.table('project_phases')
        .where({ phase_name: phaseName })
        .select('phase_id')
        .first())?.phase_id ?? null;
    const taskId = async (taskName) => (await db.table('project_tasks')
        .where({ task_name: taskName })
        .select('task_id')
        .first())?.task_id ?? null;
    const ticketId = async (title) => (await db.table('tickets')
        .where({ title })
        .select('ticket_id')
        .first())?.ticket_id ?? null;

    return db.table('project_ticket_links').insert([
        {
            tenant: tenantId,
            project_id: await projectId('Wonderland Expansion'),
            phase_id: await phaseId('Territory Survey'),
            task_id: await taskId('Map New Areas'),
            ticket_id: await ticketId('Survey Uncharted Areas in Wonderland')
        },
        {
            tenant: tenantId,
            project_id: await projectId('Emerald City Beautification'),
            phase_id: await phaseId('Green Space Enhancement'),
            task_id: await taskId('Plant Magical Flowers'),
            ticket_id: await ticketId('Enhance Emerald City Gardens')
        }
    ]);
};
