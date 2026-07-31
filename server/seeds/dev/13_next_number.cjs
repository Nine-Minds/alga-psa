const { getFirstTenantSeedContext } = require('./_tenant.cjs');

exports.seed = async function (knex) {
    const context = await getFirstTenantSeedContext(knex);
    if (!context) return;

    const { tenantId, db } = context;

    return db.table('next_number').del()
        .then(() => {
            return db.table('next_number').insert([
                { tenant: tenantId, entity_type: 'TICKET', last_number: 1010, initial_value: 1000, prefix: 'TIC' },
                { tenant: tenantId, entity_type: 'PROJECT', last_number: 0, initial_value: 1, prefix: 'PROJECT', padding_length: 4 },
                { tenant: tenantId, entity_type: 'INVOICE', last_number: 0, initial_value: 1, prefix: 'INV-', padding_length: 6 },
                { tenant: tenantId, entity_type: 'QUOTE', last_number: 0, initial_value: 1, prefix: 'QUO-', padding_length: 4 },
            ]);
        });
};
