exports.seed = async function (knex) {
    // Get the tenant ID
    const tenant = await knex('tenants').select('tenant').first();
    if (!tenant) return;

    return knex('custom_fields').insert([
        {
            tenant: tenant.tenant,
            field_id: knex.raw('gen_random_uuid()'),
            name: 'Payment Terms',
            type: 'text',
            default_value: JSON.stringify([
                {
                    name: 'Net 30',
                    value: 'net_30'
                },
                {
                    name: 'Net 45',
                    value: 'net_45'
                },
                {
                    name: 'Net 60',
                    value: 'net_60'
                }
            ])
        },
        {
            tenant: tenant.tenant,
            field_id: knex.raw('gen_random_uuid()'),
            name: 'Customer PO',
            type: 'text',
            default_value: null
        },
        {
            tenant: tenant.tenant,
            field_id: knex.raw('gen_random_uuid()'),
            name: 'Discount',
            type: 'number',
            default_value: '0'
        }
    ]);
};