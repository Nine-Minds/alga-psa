const WORKFLOW_PERMISSIONS = [
  { resource: 'workflow', action: 'read', msp: true, client: false, description: 'Read workflows' },
  { resource: 'workflow', action: 'view', msp: true, client: false, description: 'View workflows' },
  { resource: 'workflow', action: 'manage', msp: true, client: false, description: 'Manage workflows' },
  { resource: 'workflow', action: 'publish', msp: true, client: false, description: 'Publish workflows' },
  { resource: 'workflow', action: 'admin', msp: true, client: false, description: 'Administer workflows' },
];
const MIGRATION_TENANT = 'migration:20260424200000_ensure_workflow_permissions_for_newer_tenants';
const TENANT_ENUMERATION_REASON = 'enumerate tenants for newer-tenant workflow permission repair';

async function loadTenantDb() {
  return (await import('@alga-psa/db')).tenantDb;
}

exports.up = async function up(knex) {
  const tenantDb = await loadTenantDb();
  const migrationDb = tenantDb(knex, MIGRATION_TENANT);
  const tenants = await migrationDb.unscoped('tenants', TENANT_ENUMERATION_REASON).select('tenant');
  if (!tenants.length) return;

  for (const { tenant } of tenants) {
    const db = tenantDb(knex, tenant);
    const existingPerms = await db.table('permissions')
      .where({ tenant, resource: 'workflow' })
      .select('permission_id', 'action');

    const existingActions = new Set(existingPerms.map((permission) => permission.action));
    const permissionsToInsert = WORKFLOW_PERMISSIONS
      .filter((permission) => !existingActions.has(permission.action))
      .map((permission) => ({
        tenant,
        permission_id: knex.raw('gen_random_uuid()'),
        created_at: new Date(),
        ...permission,
    }));

    if (permissionsToInsert.length > 0) {
      await db.table('permissions').insert(permissionsToInsert);
    }

    // Keep pre-existing rows aligned with the current MSP-only workflow permission contract.
    await db.table('permissions')
      .where({ tenant, resource: 'workflow' })
      .whereIn('action', WORKFLOW_PERMISSIONS.map((permission) => permission.action))
      .update({ msp: true, client: false });

    const adminRole = await db.table('roles')
      .where({ tenant, msp: true })
      .whereRaw('LOWER(role_name) = ?', ['admin'])
      .first('role_id');

    if (!adminRole) continue;

    const workflowPermissionRows = await db.table('permissions')
      .where({ tenant, resource: 'workflow', msp: true })
      .whereIn('action', WORKFLOW_PERMISSIONS.map((permission) => permission.action))
      .select('permission_id');

    if (!workflowPermissionRows.length) continue;

    const existingRolePerms = await db.table('role_permissions')
      .where({ tenant, role_id: adminRole.role_id })
      .whereIn('permission_id', workflowPermissionRows.map((permission) => permission.permission_id))
      .select('permission_id');

    const existingRolePermIds = new Set(existingRolePerms.map((rolePermission) => rolePermission.permission_id));
    const rolePermissionsToInsert = workflowPermissionRows
      .filter((permission) => !existingRolePermIds.has(permission.permission_id))
      .map((permission) => ({
        tenant,
        role_id: adminRole.role_id,
        permission_id: permission.permission_id,
    }));

    if (rolePermissionsToInsert.length > 0) {
      await db.table('role_permissions').insert(rolePermissionsToInsert);
    }
  }
};

exports.down = async function down() {
  // Deliberately no-op: workflow permissions are a baseline entitlement also
  // created by earlier migrations. This migration repairs tenants created after
  // those migrations ran, so rollback cannot safely distinguish repaired rows
  // from rows that predated this migration.
};
