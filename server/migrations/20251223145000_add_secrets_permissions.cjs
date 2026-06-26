/**
 * Migration to add secrets permissions (§18.6.1)
 *
 * Creates three permission levels for tenant secrets:
 * - secrets.view: List secret names and metadata
 * - secrets.manage: Create, update, delete secrets
 * - secrets.use: Reference secrets in workflows
 *
 * Admin role gets all permissions.
 * Editor role gets view and use permissions.
 * Viewer role gets no secrets permissions.
 */

const SECRETS_PERMISSIONS = [
  { resource: 'secrets', action: 'view', description: 'View secret names and metadata (not values)' },
  { resource: 'secrets', action: 'manage', description: 'Create, update, and delete secrets' },
  { resource: 'secrets', action: 'use', description: 'Reference secrets in workflows' },
];
const MIGRATION_TENANT = 'migration:20251223145000_add_secrets_permissions';
const TENANT_ENUMERATION_REASON = 'enumerate tenants for secrets permission creation';
const SECRETS_PERMISSION_DISCOVERY_REASON = 'discover secrets permissions for rollback';

async function loadTenantDb() {
  return (await import('@alga-psa/db')).tenantDb;
}

exports.up = async function (knex) {
  const tenantDb = await loadTenantDb();
  const migrationDb = tenantDb(knex, MIGRATION_TENANT);
  // Get all tenants
  const tenants = await migrationDb.unscoped('tenants', TENANT_ENUMERATION_REASON).select('tenant');

  for (const { tenant } of tenants) {
    const db = tenantDb(knex, tenant);
    // Insert permissions for this tenant
    const permissionIds = [];
    for (const perm of SECRETS_PERMISSIONS) {
      const [row] = await db.table('permissions')
        .insert({
          tenant,
          resource: perm.resource,
          action: perm.action,
          description: perm.description,
        })
        .returning('permission_id');
      permissionIds.push({ ...perm, permission_id: row.permission_id });
    }

    // Get Admin and Editor roles for this tenant
    const adminRole = await db.table('roles')
      .where({ tenant, role_name: 'Admin' })
      .first();
    const editorRole = await db.table('roles')
      .where({ tenant, role_name: 'Editor' })
      .first();

    // Assign all secrets permissions to Admin role
    if (adminRole) {
      for (const perm of permissionIds) {
        // Check if already assigned (idempotency)
        const existing = await db.table('role_permissions')
          .where({
            tenant,
            role_id: adminRole.role_id,
            permission_id: perm.permission_id,
          })
          .first();
        if (!existing) {
          await db.table('role_permissions').insert({
            tenant,
            role_id: adminRole.role_id,
            permission_id: perm.permission_id,
          });
        }
      }
    }

    // Assign view and use permissions to Editor role
    if (editorRole) {
      for (const perm of permissionIds) {
        if (perm.action === 'view' || perm.action === 'use') {
          // Check if already assigned (idempotency)
          const existing = await db.table('role_permissions')
            .where({
              tenant,
              role_id: editorRole.role_id,
              permission_id: perm.permission_id,
            })
            .first();
          if (!existing) {
            await db.table('role_permissions').insert({
              tenant,
              role_id: editorRole.role_id,
              permission_id: perm.permission_id,
            });
          }
        }
      }
    }
  }
};

exports.down = async function (knex) {
  const tenantDb = await loadTenantDb();
  const migrationDb = tenantDb(knex, MIGRATION_TENANT);
  // Remove role_permissions for secrets
  const secretsPermissions = await migrationDb.unscoped('permissions', SECRETS_PERMISSION_DISCOVERY_REASON)
    .where({ resource: 'secrets' })
    .select('tenant', 'permission_id');

  for (const perm of secretsPermissions) {
    const db = tenantDb(knex, perm.tenant);
    await db.table('role_permissions')
      .where({
        tenant: perm.tenant,
        permission_id: perm.permission_id,
      })
      .del();

    await db.table('permissions')
      .where({
        tenant: perm.tenant,
        permission_id: perm.permission_id,
      })
      .del();
  }
};
