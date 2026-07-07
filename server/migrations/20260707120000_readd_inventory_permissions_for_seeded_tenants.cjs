/**
 * Re-run the inventory permission backfill for tenants that were provisioned
 * AFTER migration 20260626100600_add_inventory_permissions ran.
 *
 * That migration backfills inventory permission rows (and the MSP Admin grants)
 * for every tenant that exists at migration time. On appliance/on-prem (CE) and
 * fresh hosted installs the bootstrap order is: run all migrations against an
 * EMPTY database, then create the first tenant via the onboarding seeds
 * (ee/server/seeds/onboarding/psa). So 20260626100600 was recorded as applied
 * without inserting anything (its `if (!tenants.length) return` short-circuits),
 * and the onboarding/dev permission seeds had no inventory permission defs —
 * leaving the default Admin (and every other role) with no sales_order /
 * stock_location / inventory / vendor / purchase_order / stock_transfer grants.
 * Every inventory server action then failed the RBAC check, e.g. Add Sales Order
 * Save returned HTTP 200 but persisted no row ("Permission denied: sales_order
 * create required") and the Sales Orders list rendered empty.
 * The same gap applies to any tenant created between 20260626100600 and the
 * onboarding/dev seed fix that ships alongside this migration.
 *
 * The permission seeds now include the inventory defs, so tenants created from
 * this build onward are correct; this migration repairs tenants that were
 * already provisioned. Same idempotent logic as 20260626100600: safe to re-run
 * and a no-op for tenants that already have the rows.
 *
 * Uses raw knex (every query passes `tenant` explicitly) so the migration runner
 * does not load the @alga-psa/db ESM package.
 */

const RESOURCES = ['inventory', 'vendor', 'purchase_order', 'sales_order', 'stock_transfer', 'stock_location'];
const ACTIONS = ['create', 'read', 'update', 'delete'];

function buildPermissions() {
  const perms = [];
  for (const resource of RESOURCES) {
    for (const action of ACTIONS) {
      perms.push({ resource, action, msp: true, client: false, description: `${action} ${resource}` });
    }
  }
  return perms;
}

exports.up = async function up(knex) {
  const tenants = await knex('tenants').select('tenant');
  if (!tenants.length) return;

  const newPermissions = buildPermissions();

  for (const { tenant } of tenants) {
    const existingPerms = await knex('permissions').where({ tenant }).select('resource', 'action');
    const existingMap = new Set(existingPerms.map((p) => `${p.resource}:${p.action}`));

    const permissionsToAdd = newPermissions
      .filter((p) => !existingMap.has(`${p.resource}:${p.action}`))
      .map((p) => ({
        tenant,
        permission_id: knex.raw('gen_random_uuid()'),
        ...p,
        created_at: new Date(),
      }));

    if (permissionsToAdd.length > 0) {
      await knex('permissions').insert(permissionsToAdd);
    }

    const adminRole = await knex('roles')
      .where({ tenant, msp: true, client: false })
      .whereRaw("LOWER(role_name) = 'admin'")
      .first();

    if (adminRole) {
      const invPerms = await knex('permissions')
        .where({ tenant, msp: true })
        .whereIn('resource', RESOURCES)
        .select('permission_id');

      const existingRolePerms = await knex('role_permissions')
        .where({ tenant, role_id: adminRole.role_id })
        .select('permission_id');
      const existingRolePermIds = new Set(existingRolePerms.map((rp) => rp.permission_id));

      const rolePermissionsToAdd = invPerms
        .filter((p) => !existingRolePermIds.has(p.permission_id))
        .map((p) => ({ tenant, role_id: adminRole.role_id, permission_id: p.permission_id }));

      if (rolePermissionsToAdd.length > 0) {
        await knex('role_permissions').insert(rolePermissionsToAdd);
      }
    }
  }
};

exports.down = async function down() {
  // Intentionally a no-op: the inventory permission rows may predate this
  // migration (created by 20260626100600 or the permission seeds), so deleting
  // them here could strip grants this migration did not create.
};
