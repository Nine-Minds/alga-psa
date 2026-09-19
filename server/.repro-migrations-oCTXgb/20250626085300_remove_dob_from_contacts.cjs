exports.up = async function(knex) {
  const exists = await knex.schema.hasColumn('contacts', 'date_of_birth');
  if (exists) {
    await knex.schema.table('contacts', (table) => {
      table.dropColumn('date_of_birth');
    });
  }
};

exports.down = async function(knex) {
  await knex.schema.table('contacts', (table) => {
    table.timestamp('date_of_birth');
  });
};
