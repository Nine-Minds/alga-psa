const { getFirstTenantSeedContext } = require('./_tenant.cjs');

exports.seed = async function (knex) {
    // Get the tenant ID
    const context = await getFirstTenantSeedContext(knex);
    if (!context) return;

    const { tenantId, db } = context;
    const entryId = async (title) => (await db.table('schedule_entries')
        .where({ title })
        .select('entry_id')
        .first())?.entry_id ?? null;

    return db.table('schedule_conflicts').insert([
        {
            tenant: tenantId,
            entry_id_1: await entryId('Cheshire Cat Pathways'),
            entry_id_2: await entryId('Through the Looking Glass Expedition'),
            conflict_type: 'Overlap',
            resolved: false,
            resolution_notes: 'Potential overlap in scheduled tasks'
        }
    ]);
};
