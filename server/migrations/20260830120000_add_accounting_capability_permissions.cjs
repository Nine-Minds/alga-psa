/**
 * Provision the five `accounting_integrations` capability permissions for every
 * tenant, splitting the accounting-integration actions that a single
 * `billing_settings:update` grant used to gate into purpose-specific
 * capabilities.
 *
 * The permissions are declared in the unified catalog
 * (server/migrations/utils/permissions/catalog.cjs) — the single source of
 * truth — together with their default-role grants:
 *
 *   - `accounting_integrations:connections_manage` → msp:Admin only
 *     (OAuth client credentials, connect/disconnect, default-company selection)
 *   - `accounting_integrations:catalog_read` → msp:Admin, msp:Finance
 *   - `accounting_integrations:mappings_manage` → msp:Admin, msp:Finance
 *   - `accounting_integrations:exports_execute` → msp:Admin, msp:Finance
 *   - `accounting_integrations:remote_mutate` → msp:Admin only
 *
 * This migration reconciles every existing tenant against that catalog so
 * databases provisioned before the catalog entry existed gain the permissions
 * and their grants. On a fresh database the earlier reconciliation migrations
 * already run against the current catalog, so this writes nothing.
 *
 * What existing roles gain and lose:
 *
 *   - msp:Admin gains all five capabilities. Nothing is lost.
 *   - msp:Finance gains `catalog_read`, `mappings_manage` and `exports_execute`.
 *     Finance keeps every existing permission (including `billing_settings:update`,
 *     which still gates the non-accounting billing settings and is deliberately
 *     untouched) and does NOT receive `connections_manage` or `remote_mutate`, so
 *     a Finance user can read catalogs, reconcile mappings and run exports but can
 *     neither administer connections nor drive remote destructive operations.
 *   - Every other default role gains nothing. None of these capabilities is
 *     granted to Manager/Dispatcher/Project Manager/Technician or any client role.
 *   - Custom roles gain nothing, silently or otherwise: catalog synchronization
 *     grants only to exact default-role identities (see
 *     ./utils/permissions/README.md), so no `billing_settings:update` holder is
 *     ever mapped onto the new high-impact capabilities. A custom role that needs
 *     a capability must be granted it explicitly through the role editor.
 *
 * Additive only: it inserts the missing permissions and default-role grants and
 * never deletes. A tenant whose own shape blocks reconciliation is reported and
 * skipped, never fatal. See ./utils/permissions/reconcileTenants.cjs.
 */

const { reconcileAllTenants } = require('./utils/permissions/reconcileTenants.cjs');

exports.up = async function up(knex) {
  await reconcileAllTenants(knex, { label: 'add_accounting_capability_permissions' });
};

exports.down = async function down() {
  throw new Error(
    'add_accounting_capability_permissions is irreversible. Removing the permissions and their grants would delete '
    + 'state tenants may have assigned to custom roles since. Retiring a permission requires its own reviewed '
    + 'migration — see server/migrations/utils/permissions/README.md.',
  );
};

exports.config = { transaction: false };
