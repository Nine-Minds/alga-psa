/**
 * Add an additive nullable `catalog_description` snapshot column to
 * `quote_items`.
 *
 * Ticket 2354 — quote output should be able to show a line's catalog
 * description beneath its item name. The catalog description is captured at
 * quote-item creation/selection-change time and stored verbatim so later
 * catalog edits (or catalog deletion) never change existing quote output.
 *
 * - Nullable: existing rows stay `NULL` (no backfill — the current catalog
 *   text is not a historical snapshot).
 * - `NULL` also means "no catalog description captured" for custom/discount
 *   lines and for catalog rows whose description was empty when captured.
 * - No tenant predicate or index is needed: this is a plain attribute of the
 *   already tenant-distributed `quote_items` table and is always read/written
 *   through the existing tenant-scoped rows.
 */

exports.up = async function up(knex) {
  const hasColumn = await knex.schema.hasColumn('quote_items', 'catalog_description');
  if (!hasColumn) {
    await knex.schema.alterTable('quote_items', (table) => {
      table.text('catalog_description').nullable();
    });
  }
};

exports.down = async function down(knex) {
  const hasColumn = await knex.schema.hasColumn('quote_items', 'catalog_description');
  if (hasColumn) {
    await knex.schema.alterTable('quote_items', (table) => {
      table.dropColumn('catalog_description');
    });
  }
};
