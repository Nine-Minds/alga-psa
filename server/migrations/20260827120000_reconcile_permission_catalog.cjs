/**
 * One-time reconciliation of every existing tenant against the unified
 * permission catalog (server/migrations/utils/permissions).
 *
 * Additive only: it inserts missing catalog permissions, refreshes
 * catalog-owned descriptions and adds missing default-role grants. It never
 * deletes a role, a permission or a grant, and it never creates a role.
 *
 * 20260827091000 already runs the same reconciliation, so on a fresh database
 * this one writes nothing. It earns its place on databases provisioned from
 * main before this branch: those recorded 091000 against the earlier,
 * msp-only catalog and will never run it again, and only this migration
 * teaches them the identities that catalog never knew — every credential:*,
 * cycle_count:*, marketing:*, import_export:*, vendor_bill:*,
 * billing.recurring_service_periods:*, billing_profile_report:read, the MSP
 * settings pair, the client-portal contact pair and ticket:delete — plus their
 * default-role grants and the catalog-owned descriptions the role editor shows.
 *
 * There is deliberately no third pass. An earlier revision added one for
 * databases that had run a mid-branch version of this file against the
 * pre-audit catalog; the branch never reached a shared environment, so it was
 * a guaranteed no-op everywhere and is gone. A developer database in that state
 * converges on its next seed run.
 *
 * No database-wide transaction — each tenant gets its own. A tenant whose own
 * shape blocks reconciliation is reported and skipped, never fatal: this
 * migration cannot abort a deployment because of one drifted tenant. See
 * ./utils/permissions/reconcileTenants.cjs.
 */

const { reconcileAllTenants } = require('./utils/permissions/reconcileTenants.cjs');

exports.up = async function up(knex) {
  await reconcileAllTenants(knex, { label: 'reconcile_permission_catalog' });
};

exports.down = async function down() {
  throw new Error(
    'reconcile_permission_catalog is irreversible. Removing the permissions and grants it added would delete '
    + 'state tenants may have assigned to custom roles since. Retiring a permission requires its own reviewed '
    + 'migration — see server/migrations/utils/permissions/README.md.',
  );
};

exports.config = { transaction: false };
