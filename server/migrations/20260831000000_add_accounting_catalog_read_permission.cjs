/**
 * Reconcile the accounting catalog-read permission for every tenant.
 *
 * Main originally introduced this migration with the temporary
 * `accounting_catalog:read` name. The accounting capability split merged at
 * the same time and provides the final `accounting_integrations:catalog_read`
 * permission in the unified catalog instead. Keep this published migration
 * filename and make it reconcile the final catalog so both migration histories
 * converge without provisioning a second overlapping permission.
 *
 * Additive only: it inserts the missing permission and default-role grants and
 * never deletes. A tenant whose own shape blocks reconciliation is reported
 * and skipped, never fatal. See ./utils/permissions/reconcileTenants.cjs.
 */

const { reconcileAllTenants } = require('./utils/permissions/reconcileTenants.cjs');

exports.up = async function up(knex) {
  await reconcileAllTenants(knex, { label: 'reconcile_accounting_catalog_read_capability' });
};

exports.down = async function down() {
  throw new Error(
    'reconcile_accounting_catalog_read_capability is irreversible. Removing the permission and its grants would '
    + 'delete state tenants may have assigned to custom roles since. Retiring a permission requires its own '
    + 'reviewed migration — see server/migrations/utils/permissions/README.md.',
  );
};

exports.config = { transaction: false };
