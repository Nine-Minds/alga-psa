/**
 * Provision the `accounting_catalog:read` permission for every tenant.
 *
 * The permission is declared in the unified catalog
 * (server/migrations/utils/permissions/catalog.cjs) — the single source of
 * truth — together with its default-role grants (msp:Admin and msp:Finance on
 * PSA). This migration reconciles every existing tenant against that catalog
 * so databases provisioned before the catalog entry existed gain the
 * permission and its grants. On a fresh database the earlier reconciliation
 * migrations already run against the current catalog, so this writes nothing.
 *
 * Additive only: it inserts the missing permission and default-role grants and
 * never deletes. A tenant whose own shape blocks reconciliation is reported
 * and skipped, never fatal. See ./utils/permissions/reconcileTenants.cjs.
 */

const { reconcileAllTenants } = require('./utils/permissions/reconcileTenants.cjs');

exports.up = async function up(knex) {
  await reconcileAllTenants(knex, { label: 'add_accounting_catalog_read_permission' });
};

exports.down = async function down() {
  throw new Error(
    'add_accounting_catalog_read_permission is irreversible. Removing the permission and its grants would '
    + 'delete state tenants may have assigned to custom roles since. Retiring a permission requires its own '
    + 'reviewed migration — see server/migrations/utils/permissions/README.md.',
  );
};

exports.config = { transaction: false };
