exports.up = function(knex) {
  return knex.raw('CREATE EXTENSION IF NOT EXISTS btree_gist')
    .then(() => {
      return knex.schema.alterTable('tax_rates', function(table) {
        table.unique(['tenant', 'region', 'start_date', 'end_date']);
      })
      .then(() => {
        return knex.raw(`
          ALTER TABLE tax_rates
          ADD CONSTRAINT tax_rates_no_overlap
          EXCLUDE USING gist (
            tenant WITH =,
            region WITH =,
            daterange(start_date, end_date, '[)') WITH &&
          )
        `);
      });
    });
};

exports.down = function(knex) {
  return knex.schema.alterTable('tax_rates', function(table) {
    table.dropUnique(['tenant', 'region', 'start_date', 'end_date']);
  })
  .then(() => knex.raw('ALTER TABLE tax_rates DROP CONSTRAINT IF EXISTS tax_rates_no_overlap'))
  .then(() => knex.raw('DROP EXTENSION IF EXISTS btree_gist'));
};