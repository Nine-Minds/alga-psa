/* eslint-disable no-undef */
const { getFirstTenantSeedContext } = require('./_tenant.cjs');

exports.seed = async function (knex) {
    // Get the tenant ID
    const context = await getFirstTenantSeedContext(knex);
    if (!context) return;

    const { tenantId, db } = context;
    const invoiceId = (invoiceNumber) => db.table('invoices')
        .where({ invoice_number: invoiceNumber })
        .select('invoice_id')
        .first();
    const userId = (username) => db.table('users')
        .where({ username })
        .select('user_id')
        .first();

    return db.table('invoice_annotations').insert([
        {
            tenant: tenantId,
            annotation_id: knex.raw('gen_random_uuid()'),
            invoice_id: invoiceId('INV-003'),
            user_id: userId('glinda'),
            content: 'Customer requested itemized breakdown of Rabbit Tracking hours.',
            is_internal: true
        },
        {
            tenant: tenantId,
            annotation_id: knex.raw('gen_random_uuid()'),
            invoice_id: invoiceId('INV-004'),
            user_id: userId('dorothy'),
            content: 'Applied 5% discount as per agreement.',
            is_internal: false
        }
    ]);
};
