exports.seed = function (knex) {
    return knex('document_types').del()
        .then(async () => {
            const tenant = await knex('tenants').select('tenant').first();
            return knex('document_types').insert([
                { tenant: tenant?.tenant ?? null, type_name: 'Ticket' },
                { tenant: tenant?.tenant ?? null, type_name: 'Schedule' }
            ]);
        });
};
