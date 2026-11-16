/**
 * Provision permission:read|create|update|delete for every tenant, for msp:Admin only
 * (PSA and AlgaDesk; nothing for co-managed). These gate the /api/v1/permissions and
 * /api/v1/permission-checks endpoints (ApiPermissionController, resource 'permission').
 *
 * The permissions are declared in the unified catalog
 * (server/migrations/utils/permissions/catalog.cjs). Before this, nothing declared them, so no
 * role could hold them and every API key, Admin included, got 403 on those endpoints. This
 * follows PR #4380 (add_api_admin_permissions), which did the same for role:*. This migration
 * reconciles every existing tenant against the catalog; on a fresh database the earlier
 * reconciliation migrations already run against the current catalog, so it writes nothing.
 *
 * Additive only: it inserts the missing permissions and default-role grants and never deletes. A
 * tenant whose own shape blocks reconciliation is reported and skipped, never fatal. See
 * ./utils/permissions/reconcileTenants.cjs.
 */

const { reconcileAllTenants } = require('./utils/permissions/reconcileTenants.cjs');

exports.up = async function up(knex) {
  // migration-lint: allow 8 - reconcileAllTenants is the repo-standard, additive, per-tenant-idempotent way to provision catalog permissions and their default grants (server/migrations/utils/permissions/README.md, "Adding a permission"); permission:* is declared in catalog.cjs
  await reconcileAllTenants(knex, { label: 'add_permission_catalog_resource' });
};

exports.down = async function down() {
  throw new Error(
    'add_permission_catalog_resource is irreversible. Removing the permissions and their grants would delete '
    + 'state tenants may have assigned to custom roles since. Retiring a permission requires its own reviewed '
    + 'migration — see server/migrations/utils/permissions/README.md.',
  );
};

exports.config = { transaction: false };
