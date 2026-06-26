/**
 * Add RBAC permissions for the reports workspace.
 *
 * Admin roles get full report-management permissions. Existing operational MSP
 * roles get read access so canned reports remain available after the gate is
 * enforced.
 */

const REPORT_PERMISSION_DEFS = [
  { resource: 'reports', action: 'create', msp: true, client: false, description: 'Create reports' },
  { resource: 'reports', action: 'read', msp: true, client: false, description: 'View reports' },
  { resource: 'reports', action: 'update', msp: true, client: false, description: 'Update reports' },
  { resource: 'reports', action: 'delete', msp: true, client: false, description: 'Delete reports' },
];

const REPORT_READ_ROLES = ['Finance', 'Manager', 'Technician', 'Project Manager', 'Dispatcher'];
const MIGRATION_TENANT = 'migration:20260511120000_add_reports_rbac_permissions';
const TENANT_ENUMERATION_REASON = 'enumerate tenants for reports RBAC permission backfill';

async function loadTenantDb() {
  return (await import('@alga-psa/db')).tenantDb;
}

async function ensurePermission(knex, db, tenant, def) {
  const existing = await db.table('permissions')
    .where({ tenant, resource: def.resource, action: def.action })
    .first();

  if (existing) {
    if (existing.msp !== def.msp || existing.client !== def.client || existing.description !== def.description) {
      await db.table('permissions')
        .where({ tenant, permission_id: existing.permission_id })
        .update({
          msp: def.msp,
          client: def.client,
          description: def.description,
          updated_at: knex.fn.now(),
        });
    }

    return existing.permission_id;
  }

  const [inserted] = await db.table('permissions')
    .insert({
      tenant,
      resource: def.resource,
      action: def.action,
      msp: def.msp,
      client: def.client,
      description: def.description,
      created_at: knex.fn.now(),
    })
    .returning('permission_id');

  return inserted.permission_id;
}

async function assignPermission(knex, db, tenant, roleId, permissionId) {
  const existing = await db.table('role_permissions')
    .where({ tenant, role_id: roleId, permission_id: permissionId })
    .first('tenant');

  if (existing) {
    return;
  }

  await db.table('role_permissions').insert({
    tenant,
    role_id: roleId,
    permission_id: permissionId,
    created_at: knex.fn.now(),
  });
}

exports.up = async function up(knex) {
  const tenantDb = await loadTenantDb();
  const migrationDb = tenantDb(knex, MIGRATION_TENANT);
  const tenants = await migrationDb.unscoped('tenants', TENANT_ENUMERATION_REASON).select('tenant');

  for (const { tenant } of tenants) {
    const db = tenantDb(knex, tenant);
    const permissionIdsByAction = new Map();

    for (const def of REPORT_PERMISSION_DEFS) {
      permissionIdsByAction.set(def.action, await ensurePermission(knex, db, tenant, def));
    }

    const adminRole = await db.table('roles')
      .where({ tenant, role_name: 'Admin', msp: true })
      .first('role_id');

    if (adminRole) {
      for (const permissionId of permissionIdsByAction.values()) {
        await assignPermission(knex, db, tenant, adminRole.role_id, permissionId);
      }
    }

    const readPermissionId = permissionIdsByAction.get('read');
    const readRoles = await db.table('roles')
      .where({ tenant, msp: true })
      .whereIn('role_name', REPORT_READ_ROLES)
      .select('role_id');

    for (const role of readRoles) {
      await assignPermission(knex, db, tenant, role.role_id, readPermissionId);
    }
  }
};

exports.down = async function down(knex) {
  const tenantDb = await loadTenantDb();
  const migrationDb = tenantDb(knex, MIGRATION_TENANT);
  const tenants = await migrationDb.unscoped('tenants', TENANT_ENUMERATION_REASON).select('tenant');
  const actions = REPORT_PERMISSION_DEFS.map((def) => def.action);

  for (const { tenant } of tenants) {
    const db = tenantDb(knex, tenant);
    const permissionIds = await db.table('permissions')
      .where({ tenant, resource: 'reports' })
      .whereIn('action', actions)
      .pluck('permission_id');

    if (!permissionIds.length) {
      continue;
    }

    await db.table('role_permissions')
      .where({ tenant })
      .whereIn('permission_id', permissionIds)
      .del();

    await db.table('permissions')
      .where({ tenant, resource: 'reports' })
      .whereIn('action', actions)
      .del();
  }
};
