exports.up = async function(knex) {
  await knex.schema.table('contacts', (table) => {
    table.dropColumn('date_of_birth');
  });
};

exports.down = async function(knex) {
  await knex.schema.table('contacts', (table) => {
    table.timestamp('date_of_birth');
  });
};
