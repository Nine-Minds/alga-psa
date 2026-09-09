/* eslint-disable no-undef */
const { getFirstTenantSeedContext } = require('./_tenant.cjs');

exports.seed = async function (knex) {
    // Get the tenant ID
    const context = await getFirstTenantSeedContext(knex);
    if (!context) return;

    const { tenantId, db } = context;
    const invoiceId = async (invoiceNumber) => (await db.table('invoices')
        .where({ invoice_number: invoiceNumber })
        .select('invoice_id')
        .first())?.invoice_id ?? null;
    const userId = async (username) => (await db.table('users')
        .where({ username })
        .select('user_id')
        .first())?.user_id ?? null;

    return db.table('invoice_annotations').insert([
        {
            tenant: tenantId,
            annotation_id: knex.raw('gen_random_uuid()'),
            invoice_id: await invoiceId('INV-003'),
            user_id: await userId('glinda'),
            content: 'Customer requested itemized breakdown of Rabbit Tracking hours.',
            is_internal: true
        },
        {
            tenant: tenantId,
            annotation_id: knex.raw('gen_random_uuid()'),
            invoice_id: await invoiceId('INV-004'),
            user_id: await userId('dorothy'),
            content: 'Applied 5% discount as per agreement.',
            is_internal: false
        }
    ]);
};
