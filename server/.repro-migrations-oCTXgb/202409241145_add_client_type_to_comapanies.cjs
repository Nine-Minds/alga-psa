exports.up = async function(knex) {
    await knex.schema.alterTable('companies', (table) => {
        table.text('client_type');
    });
};

exports.down = async function(knex) {
    await knex.schema.alterTable('companies', (table) => {
        table.dropColumn('client_type');
    });
};