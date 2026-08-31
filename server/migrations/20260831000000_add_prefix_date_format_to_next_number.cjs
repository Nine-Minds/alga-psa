/**
 * Optional date-token template spliced between a tenant's static `prefix` and
 * the padded counter (e.g. 'INV-' + '{YYYY}-{MM}-' + '000005'). Kept in its own
 * nullable column so the existing `prefix` stays a pure literal and already
 * issued numbers can never be reinterpreted. NULL (every existing row) means
 * the feature is off and numbering is byte-identical to before.
 */
exports.up = function up(knex) {
  return knex.schema.alterTable('next_number', function (table) {
    table.text('prefix_date_format').nullable();
  });
};

exports.down = function down(knex) {
  return knex.schema.alterTable('next_number', function (table) {
    table.dropColumn('prefix_date_format');
  });
};
