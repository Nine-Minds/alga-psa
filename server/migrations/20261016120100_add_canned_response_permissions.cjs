/**
 * Provision the `canned_response` permissions (read, create, update, delete) for every tenant.
 *
 * Declared in the unified catalog (server/migrations/utils/permissions/catalog.cjs) with default-role grants.
 * This migration reconciles every existing tenant against that catalog; on a fresh database the earlier
 * reconciliation migrations already run against the current catalog, so it writes nothing.
 * Additive only. See ./utils/permissions/reconcileTenants.cjs.
 */

const { reconcileAllTenants } = require('./utils/permissions/reconcileTenants.cjs');

exports.up = async function up(knex) {
  // migration-lint: allow 8 - retroactive: reconcileAllTenants is the repo-standard permission seeding helper, idempotent per tenant; merged before the lint existed
  await reconcileAllTenants(knex, { label: 'add_canned_response_permissions' });
};

exports.down = async function down() {
  throw new Error(
    'add_canned_response_permissions is irreversible. Removing the permissions and their grants would delete '
    + 'state tenants may have assigned to custom roles since. Retiring a permission requires its own reviewed '
    + 'migration — see server/migrations/utils/permissions/README.md.',
  );
};

exports.config = { transaction: false };
