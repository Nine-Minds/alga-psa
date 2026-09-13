/**
 * Add an optional per-rate tax cap.
 *
 * `cap_amount` is the maximum tax a single rate may charge for one
 * calculation, expressed in the smallest currency unit (the same unit as the
 * invoice line net amount). It is nullable so every existing rate keeps its
 * current uncapped behaviour; a stored 0 is a real cap that charges no tax.
 *
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.up = function(knex) {
  return knex.schema.alterTable('tax_rates', function(table) {
    table.bigInteger('cap_amount').nullable()
      .comment('Maximum tax this rate may charge per calculation, in the smallest currency unit. Null means uncapped.');
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('tax_rates', function(table) {
    table.dropColumn('cap_amount');
  });
};
