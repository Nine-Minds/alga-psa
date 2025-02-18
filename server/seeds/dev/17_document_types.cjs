exports.seed = function (knex) {
    return knex('document_types').del()
        .then(() => {
            return knex('document_types').insert([
                { tenant: knex('tenants').select('tenant').first(), type_name: 'Ticket' },
                { tenant: knex('tenants').select('tenant').first(), type_name: 'Schedule' }
            ]);
        });
};