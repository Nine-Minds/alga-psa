/**
 * Provision the `recurring_ticket` permissions (read, create, update, delete) for every tenant.
 *
 * The permissions are declared in the unified catalog
 * (server/migrations/utils/permissions/catalog.cjs) — the single source of truth — together with
 * their default-role grants:
 *   PSA:      msp:Admin, msp:Manager, msp:Dispatcher get all four; msp:Technician gets read.
 *   AlgaDesk: msp:Admin gets all four; msp:Agent gets read.
 * This migration reconciles every existing tenant against that catalog so databases provisioned
 * before the catalog entries existed gain the permissions and their grants. On a fresh database the
 * earlier reconciliation migrations already run against the current catalog, so this writes nothing.
 *
 * Additive only: it inserts the missing permissions and default-role grants and never deletes. A
 * tenant whose own shape blocks reconciliation is reported and skipped, never fatal. See
 * ./utils/permissions/reconcileTenants.cjs.
 */

const { reconcileAllTenants } = require('./utils/permissions/reconcileTenants.cjs');

exports.up = async function up(knex) {
  await reconcileAllTenants(knex, { label: 'add_recurring_ticket_permissions' });
};

exports.down = async function down() {
  throw new Error(
    'add_recurring_ticket_permissions is irreversible. Removing the permissions and their grants would delete '
    + 'state tenants may have assigned to custom roles since. Retiring a permission requires its own reviewed '
    + 'migration — see server/migrations/utils/permissions/README.md.',
  );
};

exports.config = { transaction: false };
