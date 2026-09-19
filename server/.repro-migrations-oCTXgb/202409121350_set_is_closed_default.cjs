exports.up = function(knex) {
    return knex.schema
        .alterTable('tickets', function(table) {
            table.boolean('is_closed').notNullable().defaultTo(false).alter();
        });
};

exports.down = function(knex) {
    return knex.schema
        .alterTable('tickets', function(table) {
            table.boolean('is_closed').alter();
        });
};
