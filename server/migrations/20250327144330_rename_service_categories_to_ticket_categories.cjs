/**
 * ⚠️ NO-OP — despite its filename, this migration renames nothing.
 *
 * The rename it advertises never happened. The actual table layout is:
 *   - `service_categories` STILL EXISTS (service/billing categories).
 *   - `ticket_categories` DOES NOT EXIST — never created.
 *   - Ticket categories live in the `categories` table (created in
 *     202409071803_initial_schema.cjs).
 *
 * So: for ticket categories query `categories`; for service categories query
 * `service_categories`. Never query `ticket_categories`. (This trap caused a
 * 500 in CategoryService, which previously queried the non-existent table.)
 */

exports.up = function(knex) {
    // Return a resolved promise for empty migration
    return Promise.resolve();
};

exports.down = function(knex) {
    // Return a resolved promise for empty migration
    return Promise.resolve();
};
