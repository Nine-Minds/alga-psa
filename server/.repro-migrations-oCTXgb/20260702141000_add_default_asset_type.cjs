/**
 * Inventory module — default asset type per product (F026).
 *
 * product_inventory_settings.default_asset_type (nullable) is the asset_type applied
 * by createAndLinkDeliveredAsset when a delivered serialized unit becomes a managed
 * asset; the fallback remains 'unknown'.
 */

exports.up = async function up(knex) {
  const hasColumn = await knex.schema.hasColumn('product_inventory_settings', 'default_asset_type');
  if (!hasColumn) {
    await knex.schema.alterTable('product_inventory_settings', (table) => {
      table.text('default_asset_type').nullable();
    });
  }
};

exports.down = async function down(knex) {
  const hasColumn = await knex.schema.hasColumn('product_inventory_settings', 'default_asset_type');
  if (hasColumn) {
    await knex.schema.alterTable('product_inventory_settings', (table) => {
      table.dropColumn('default_asset_type');
    });
  }
};
