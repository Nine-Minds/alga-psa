exports.up = async function(knex) {
  await knex.schema.alterTable('companies', function(table) {
    table.boolean('is_tax_exempt').notNullable().defaultTo(false);
    table.string('tax_exemption_certificate', 255);
  });
};

exports.down = async function(knex) {
  await knex.schema.alterTable('companies', function(table) {
    table.dropColumn('is_tax_exempt');
    table.dropColumn('tax_exemption_certificate');
  });
};
