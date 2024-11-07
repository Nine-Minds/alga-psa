exports.up = async function(knex) {
    await knex.schema.alterTable('contacts', (table) => {
        table.text('notes');
    });
};

exports.down = async function(knex) {
    await knex.schema.alterTable('contacts', (table) => {
        table.dropColumn('notes');
    });
};
