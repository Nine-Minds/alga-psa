exports.seed = function (knex) {
    return knex('next_number').del()
        .then(() => {
            return knex('next_number').insert([
                { tenant: knex('tenants').select('tenant').first(), entity_type: 'TICKET', last_number: 1010, initial_value: 1000, prefix: 'TIC' },
            ]);
        });
};