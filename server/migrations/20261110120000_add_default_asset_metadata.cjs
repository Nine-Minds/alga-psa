/**
 * Inventory module — default asset spec metadata per product.
 *
 * product_inventory_settings.default_asset_metadata (jsonb, nullable) carries the
 * per-type spec values captured on the Quick Add Product screen (e.g. os_type /
 * os_version for a workstation). createAndLinkDeliveredAsset merges it over the
 * standard "unknown" fill when a delivered serialized unit becomes a managed asset,
 * so assets generated on delivery start out filled out. Companion of
 * 20260702141000_add_default_asset_type; only meaningful for the five built-in
 * extension-backed asset types.
 */

exports.up = async function up(knex) {
  const hasColumn = await knex.schema.hasColumn('product_inventory_settings', 'default_asset_metadata');
  if (!hasColumn) {
    await knex.schema.alterTable('product_inventory_settings', (table) => {
      table.jsonb('default_asset_metadata').nullable();
    });
  }
};

exports.down = async function down(knex) {
  const hasColumn = await knex.schema.hasColumn('product_inventory_settings', 'default_asset_metadata');
  if (hasColumn) {
    await knex.schema.alterTable('product_inventory_settings', (table) => {
      table.dropColumn('default_asset_metadata');
    });
  }
};
