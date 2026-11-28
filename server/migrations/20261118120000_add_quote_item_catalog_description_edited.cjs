/**
 * Add `catalog_description_edited` to `quote_items` (alga-2026-0002804).
 *
 * A user can now edit a catalog-backed line's product description
 * (`catalog_description`) on that line. This flag records the divergence:
 * at the line's last explicit write, its text differed from the product's
 * catalog text. The server derives it; callers never send it.
 *
 * - NOT NULL DEFAULT false: existing rows become `false`, which is correct
 *   because none of them can have been edited. A constant default is a
 *   metadata-only change on PostgreSQL 11+, so no table rewrite.
 * - No tenant predicate or index is needed: this is a plain attribute of the
 *   already tenant-distributed `quote_items` table (ALTER TABLE ADD COLUMN
 *   propagates to the shards), always read/written through the existing
 *   tenant-scoped rows.
 */

exports.up = async function up(knex) {
  const hasColumn = await knex.schema.hasColumn('quote_items', 'catalog_description_edited');
  if (!hasColumn) {
    await knex.schema.alterTable('quote_items', (table) => {
      table.boolean('catalog_description_edited').notNullable().defaultTo(false);
    });
  }
};

exports.down = async function down(knex) {
  const hasColumn = await knex.schema.hasColumn('quote_items', 'catalog_description_edited');
  if (hasColumn) {
    await knex.schema.alterTable('quote_items', (table) => {
      table.dropColumn('catalog_description_edited');
    });
  }
};
