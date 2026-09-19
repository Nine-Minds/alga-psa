exports.up = function (knex) {
    return knex.schema.table('time_periods', function (table) {
        table.dropColumn('type_id');
    });
};

exports.down = function (knex) {
    return knex.schema.table('time_periods', function (table) {
        table.uuid('type_id');
    });
};