exports.seed = async function (knex) {
    // Get the tenant ID
    const tenant = await knex('tenants').select('tenant').first();
    if (!tenant) return;

    return knex('ticket_resources').insert([
        {
            tenant: tenant.tenant,
            ticket_id: knex('tickets').where({ tenant: tenant.tenant, title: 'Enhance Emerald City Gardens' }).select('ticket_id').first(),
            assigned_to: knex('users').where({ tenant: tenant.tenant, username: 'scarecrow' }).select('user_id').first(),
            additional_user_id: knex('users').where({ tenant: tenant.tenant, username: 'glinda' }).select('user_id').first(),
            role: 'Consultant',
            assigned_at: knex.raw("CURRENT_TIMESTAMP - INTERVAL '3 days' - INTERVAL '4 hours'")
        }
    ]);
};