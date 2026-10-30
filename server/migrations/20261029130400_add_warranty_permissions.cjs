/**
 * Provision the `warranty` permissions (read, create, update) for every tenant (alga-2026-0002683, C5).
 *
 * Declared in the unified catalog (server/migrations/utils/permissions/catalog.cjs) with default grants to
 * Admin, Manager and Technician. This reconciles every existing tenant against that catalog. Additive only.
 * See ./utils/permissions/reconcileTenants.cjs.
 */

const { reconcileAllTenants } = require('./utils/permissions/reconcileTenants.cjs');

exports.up = async function up(knex) {
  // migration-lint: allow 8 - reconcileAllTenants is the repo-standard, additive, per-tenant-idempotent way to provision a catalog permission (server/migrations/utils/permissions/README.md, "Adding a permission"); the warranty entries are declared in catalog.cjs
  await reconcileAllTenants(knex, { label: 'add_warranty_permissions' });
};

exports.down = async function down() {
  throw new Error(
    'add_warranty_permissions is irreversible. Removing the permissions and their grants would delete '
    + 'state tenants may have assigned to custom roles since. Retiring a permission requires its own reviewed '
    + 'migration - see server/migrations/utils/permissions/README.md.',
  );
};

exports.config = { transaction: false };
