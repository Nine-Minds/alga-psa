/**
 * Stock locations — optional physical address.
 *
 * A warehouse/office has a street address an engineer drives to; a Vehicle location does not, so all
 * columns are nullable. Kept as plain columns ON stock_locations (NOT a client_locations FK): a stock
 * location is operational inventory geography, distinct from a client account's billing/shipping
 * addresses, and Vehicle locations have no address at all. The column shape mirrors client_locations
 * for UI consistency. A future optional client_location_id link can be added if "this location IS our
 * HQ billing address" ever needs to stay in sync.
 */

exports.up = async function up(knex) {
  await knex.schema.alterTable('stock_locations', (table) => {
    table.text('address_line1').nullable();
    table.text('address_line2').nullable();
    table.text('city').nullable();
    table.text('state_province').nullable();
    table.text('postal_code').nullable();
    table.text('country_code').nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('stock_locations', (table) => {
    table.dropColumn('address_line1');
    table.dropColumn('address_line2');
    table.dropColumn('city');
    table.dropColumn('state_province');
    table.dropColumn('postal_code');
    table.dropColumn('country_code');
  });
};
