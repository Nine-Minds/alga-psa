exports.up = async function(knex) {
    await knex.schema.alterTable('contacts', (table) => {
        table.text('notes');
    });

    await knex.schema.alterTable('companies', (table) => {
        table.text('notes');
    });
};

exports.down = async function(knex) {
    await knex.schema.alterTable('contacts', (table) => {
        table.dropColumn('notes');
    });

    await knex.schema.alterTable('companies', (table) => {
        table.dropColumn('notes');
    });
};
