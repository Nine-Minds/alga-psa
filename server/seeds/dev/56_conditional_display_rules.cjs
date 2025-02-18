/* eslint-disable no-undef */
exports.seed = async function (knex) {
    // Get the tenant ID
    const tenant = await knex('tenants').select('tenant').first();
    if (!tenant) return;

    return knex('conditional_display_rules').insert([
        {
            tenant: tenant.tenant,
            rule_id: knex.raw('gen_random_uuid()'),
            template_id: knex('invoice_templates').where({ tenant: tenant.tenant, name: 'Detailed Template' }).select('template_id').first(),
            condition: JSON.stringify([
                {
                    field: 'total_amount',
                    operator: '>',
                    value: 5000
                }
            ]),
            action: 'show',
            target: 'discount_field',
            format: null
        },
        {
            tenant: tenant.tenant,
            rule_id: knex.raw('gen_random_uuid()'),
            template_id: knex('invoice_templates').where({ tenant: tenant.tenant, name: 'Standard Template' }).select('template_id').first(),
            condition: JSON.stringify([
                {
                    field: 'is_overdue',
                    operator: '==',
                    value: true
                }
            ]),
            action: 'format',
            target: 'total_amount',
            format: JSON.stringify({
                color: 'red',
                'font-weight': 'bold'
            })
        }
    ]);
};