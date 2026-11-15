/**
 * Provision the permissions behind the admin-only API endpoints for every tenant:
 *   metadata:read                      (GET /api/v1/meta/*)
 *   role:read|create|update|delete     (/api/v1/roles, /api/v1/rbac/audit)
 *   webhook:read|create|update|delete|test|retry|system_settings|analytics|bulk_update|
 *           manage_subscriptions|verify|manage_security|export|trigger  (/api/v1/webhooks)
 *
 * The permissions are declared in the unified catalog
 * (server/migrations/utils/permissions/catalog.cjs) with their default-role grants:
 *   PSA:        msp:Admin only.
 *   AlgaDesk:   msp:Admin only.
 *   Co-managed: msp:Admin gets metadata:read only (the one of these surfaces it can reach).
 * Before this, nothing declared them, so no role could hold them and every API key, Admin
 * included, got 403 on these endpoints. This migration reconciles every existing tenant against
 * the catalog; on a fresh database the earlier reconciliation migrations already run against the
 * current catalog, so this writes nothing.
 *
 * Additive only: it inserts the missing permissions and default-role grants and never deletes. A
 * tenant whose own shape blocks reconciliation is reported and skipped, never fatal. See
 * ./utils/permissions/reconcileTenants.cjs.
 */

const { reconcileAllTenants } = require('./utils/permissions/reconcileTenants.cjs');

exports.up = async function up(knex) {
  // migration-lint: allow 8 - reconcileAllTenants is the repo-standard, additive, per-tenant-idempotent way to provision catalog permissions and their default grants (server/migrations/utils/permissions/README.md, "Adding a permission"); metadata:read, role:* and webhook:* are declared in catalog.cjs
  await reconcileAllTenants(knex, { label: 'add_api_admin_permissions' });
};

exports.down = async function down() {
  throw new Error(
    'add_api_admin_permissions is irreversible. Removing the permissions and their grants would delete '
    + 'state tenants may have assigned to custom roles since. Retiring a permission requires its own reviewed '
    + 'migration — see server/migrations/utils/permissions/README.md.',
  );
};

exports.config = { transaction: false };
