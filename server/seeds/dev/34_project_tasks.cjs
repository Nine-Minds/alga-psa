const { getFirstTenantSeedContext } = require('./_tenant.cjs');

exports.seed = async function (knex) {
    const context = await getFirstTenantSeedContext(knex);
    if (!context) return;

    const { tenantId, db } = context;
    const glindaUserId = db.table('users')
        .where({ username: 'glinda' })
        .select('user_id')
        .first();
    const phaseId = (phaseName) => db.table('project_phases')
        .where({ phase_name: phaseName })
        .select('phase_id')
        .first();
    const statusId = (name) => db.table('statuses')
        .where({ name })
        .select('status_id')
        .first();

    return db.table('project_tasks').insert([
        {
            tenant: tenantId,
            phase_id: phaseId('Territory Survey'),
            task_name: 'Map New Areas',
            description: 'Create detailed maps of newly discovered areas',
            assigned_to: glindaUserId,
            estimated_hours: 40,
            actual_hours: 35,
            status_id: statusId('Magic Accomplished'),
            wbs_code: '1.1.1'
        },
        {
            tenant: tenantId,
            phase_id: phaseId('Infrastructure Planning'),
            task_name: 'Design Road Network',
            description: 'Planning road network for Wonderland expansion',
            assigned_to: glindaUserId,
            estimated_hours: 60,
            actual_hours: null,
            status_id: statusId('Wand-Waving'),
            wbs_code: '1.2.1'
        },
        {
            tenant: tenantId,
            phase_id: phaseId('Green Space Enhancement'),
            task_name: 'Plant Magical Flowers',
            description: 'Plant new species of magical flowers in Emerald City parks',
            assigned_to: glindaUserId,
            estimated_hours: 20,
            actual_hours: 15,
            status_id: statusId('Brewing Potion'),
            wbs_code: '2.1.1'
        }
    ]);
};
