'use strict';

/**
 * Billing profiles — spend-by-profile report permission (F060, slice S4).
 *
 * Spend by billing profile is its own permission rather than a reuse of
 * `billing:read`: it exposes how one client's spend divides across its
 * separately-billed sites or entities, which an MSP may well want to grant to
 * account managers who do not otherwise touch billing configuration — and may
 * equally want to withhold from staff who do.
 *
 * Follows the marketing-permission precedent (20260719102000): per-tenant
 * insert with an idempotent upsert, granted to Admin, and reversible.
 */

const MIGRATION_TENANT = 'migration:20260819000000_add_billing_profile_report_permission';
const TENANT_ENUMERATION_REASON = 'enumerate tenants for billing-profile report permission backfill';

const RESOURCE = 'billing_profile_report';
const PERMISSIONS = [
  { action: 'read', description: 'View spend broken down by billing profile' },
];

async function loadTenantDb() {
  return require('./utils/tenantDb.cjs').tenantDb;
}

exports.up = async function up(knex) {
  const tenantDb = await loadTenantDb();
  const migrationDb = tenantDb(knex, MIGRATION_TENANT);
  const tenants = await migrationDb.unscoped('tenants', TENANT_ENUMERATION_REASON).select('tenant');

  for (const { tenant } of tenants) {
    const db = tenantDb(knex, tenant);
    const permissionIds = [];

    for (const definition of PERMISSIONS) {
      let permission = await db.table('permissions')
        .where({ tenant, resource: RESOURCE, action: definition.action })
        .first(['permission_id', 'description', 'msp', 'client']);

      if (!permission) {
        const [inserted] = await db.table('permissions')
          .insert({
            tenant,
            resource: RESOURCE,
            action: definition.action,
            msp: true,
            client: false,
            description: definition.description,
          })
          .returning(['permission_id', 'description', 'msp', 'client']);
        permission = inserted;
      } else if (!permission.msp || permission.client || !permission.description) {
        await db.table('permissions')
          .where({ tenant, permission_id: permission.permission_id })
          .update({
            msp: true,
            client: false,
            description: permission.description || definition.description,
            updated_at: knex.fn.now(),
          });
      }

      permissionIds.push(permission.permission_id);
    }

    // Granted to Admin and to the billing-facing roles that already hold
    // billing read, so the report is reachable on day one without an
    // administrator having to discover a new permission first.
    const roles = await db.table('roles')
      .where({ tenant, msp: true })
      .whereIn('role_name', ['Admin', 'Finance', 'Manager'])
      .select('role_id');

    for (const role of roles) {
      for (const permissionId of permissionIds) {
        const existing = await db.table('role_permissions')
          .where({ tenant, role_id: role.role_id, permission_id: permissionId })
          .first('tenant');

        if (!existing) {
          await db.table('role_permissions').insert({
            tenant,
            role_id: role.role_id,
            permission_id: permissionId,
          });
        }
      }
    }
  }
};

exports.down = async function down(knex) {
  const tenantDb = await loadTenantDb();
  const migrationDb = tenantDb(knex, MIGRATION_TENANT);
  const tenants = await migrationDb.unscoped('tenants', TENANT_ENUMERATION_REASON).select('tenant');

  for (const { tenant } of tenants) {
    const db = tenantDb(knex, tenant);
    const permissionIds = await db.table('permissions')
      .where({ tenant, resource: RESOURCE })
      .whereIn('action', PERMISSIONS.map(({ action }) => action))
      .pluck('permission_id');

    if (permissionIds.length === 0) {
      continue;
    }

    await db.table('role_permissions')
      .where({ tenant })
      .whereIn('permission_id', permissionIds)
      .del();

    await db.table('permissions')
      .where({ tenant, resource: RESOURCE })
      .whereIn('action', PERMISSIONS.map(({ action }) => action))
      .del();
  }
};
