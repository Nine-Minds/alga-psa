/**
 * Reconcile REST API permissions required by controllers into existing tenants.
 * The catalog grants team, role, permission-administration, and metadata access
 * to the MSP Admin role only. Reconciliation is additive and preserves custom
 * role assignments and all other tenant permission state.
 */

const { reconcileAllTenants } = require('./utils/permissions/reconcileTenants.cjs');

exports.up = async function up(knex) {
  // migration-lint: allow 8 - reconcileAllTenants is the standard additive, per-tenant-idempotent path for catalog permissions; these REST permissions are declared in catalog.cjs
  await reconcileAllTenants(knex, { label: 'backfill_rest_api_permissions' });
};

exports.down = async function down() {
  throw new Error(
    'backfill_rest_api_permissions is irreversible. Removing permissions could erase custom-role state; '
    + 'retire permissions only through a separately reviewed migration.',
  );
};

exports.config = { transaction: false };
