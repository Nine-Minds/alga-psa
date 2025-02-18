/* eslint-disable no-undef */
exports.seed = async function (knex) {
    // Get the tenant ID
    const tenant = await knex('tenants').select('tenant').first();
    if (!tenant) return;

    return knex('invoice_annotations').insert([
        {
            tenant: tenant.tenant,
            annotation_id: knex.raw('gen_random_uuid()'),
            invoice_id: knex('invoices').where({ tenant: tenant.tenant, invoice_number: 'INV-003' }).select('invoice_id').first(),
            user_id: knex('users').where({ tenant: tenant.tenant, username: 'glinda' }).select('user_id').first(),
            content: 'Customer requested itemized breakdown of Rabbit Tracking hours.',
            is_internal: true
        },
        {
            tenant: tenant.tenant,
            annotation_id: knex.raw('gen_random_uuid()'),
            invoice_id: knex('invoices').where({ tenant: tenant.tenant, invoice_number: 'INV-004' }).select('invoice_id').first(),
            user_id: knex('users').where({ tenant: tenant.tenant, username: 'dorothy' }).select('user_id').first(),
            content: 'Applied 5% discount as per agreement.',
            is_internal: false
        }
    ]);
};