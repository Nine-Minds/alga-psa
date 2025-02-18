exports.seed = async function (knex) {
    // Get the tenant ID
    const tenant = await knex('tenants').select('tenant').first();
    if (!tenant) return;

    return knex('schedule_conflicts').insert([
        {
            tenant: tenant.tenant,
            entry_id_1: knex('schedule_entries').where({ tenant: tenant.tenant, title: 'Cheshire Cat Pathways' }).select('entry_id').first(),
            entry_id_2: knex('schedule_entries').where({ tenant: tenant.tenant, title: 'Through the Looking Glass Expedition' }).select('entry_id').first(),
            conflict_type: 'Overlap',
            resolved: false,
            resolution_notes: 'Potential overlap in scheduled tasks'
        }
    ]);
};