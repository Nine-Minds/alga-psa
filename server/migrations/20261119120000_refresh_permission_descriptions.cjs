/**
 * Refresh permission descriptions from the catalog. Descriptions only.
 *
 * The Settings > Security > Permissions matrix shows each permission's
 * description as its tooltip. The catalog descriptions were rewritten to name
 * the screens each permission unlocks (./utils/permissions/catalog.cjs).
 *
 * This deliberately does not call reconcileAllTenants: that sync also inserts
 * missing permissions and re-adds missing default-role grants, which would undo
 * grants a tenant removed on purpose. Here only `permissions.description` is
 * written, and only on rows that already exist and differ from the catalog.
 * No permission row is inserted or deleted and `role_permissions` is not touched.
 */

const { PRODUCTS, getProductPermissions } = require('./utils/permissions/catalog.cjs');

exports.up = async function up(knex) {
  const tenants = await knex('tenants').select('tenant', 'product_code');

  for (const { tenant, product_code: product } of tenants) {
    if (!PRODUCTS.includes(product)) continue;

    for (const entry of getProductPermissions(product)) {
      // migration-lint: allow 8 - description-only refresh of existing catalog permissions per tenant; no inserts, deletes or grant changes
      await knex('permissions')
        .where({
          tenant,
          resource: entry.resource,
          action: entry.action,
          msp: entry.msp,
          client: entry.client,
        })
        .whereRaw('description IS DISTINCT FROM ?', [entry.description])
        .update({ description: entry.description });
    }
  }
};

exports.down = async function down() {
  // Descriptions are display text; the previous wording is not restored.
};
