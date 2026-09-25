/**
 * Provision the named-list-view permissions for every tenant.
 *
 * Declared in the unified catalog (server/migrations/utils/permissions/catalog.cjs)
 * with their default-role grants:
 *
 *   - `list_view:share`  → publish a view as shared with every user of the list.
 *                          PSA: msp:Admin, msp:Manager, msp:Dispatcher.
 *                          AlgaDesk: msp:Admin.
 *   - `list_view:manage` → edit or delete *other users'* shared views.
 *                          msp:Admin only, both products.
 *
 * No permission is needed to save, edit or delete one's own private views; the
 * list's own read permission gates those.
 *
 * Additive only: inserts the missing permissions and default-role grants and
 * never deletes. A tenant whose own shape blocks reconciliation is reported and
 * skipped, never fatal. See ./utils/permissions/reconcileTenants.cjs.
 */

const { reconcileAllTenants } = require('./utils/permissions/reconcileTenants.cjs');

exports.up = async function up(knex) {
  await reconcileAllTenants(knex, { label: 'add_list_view_permissions' });
};

exports.down = async function down() {
  throw new Error(
    'add_list_view_permissions is irreversible. Removing the permissions and their grants would delete '
    + 'state tenants may have assigned to custom roles since. Retiring a permission requires its own reviewed '
    + 'migration — see server/migrations/utils/permissions/README.md.',
  );
};

exports.config = { transaction: false };
