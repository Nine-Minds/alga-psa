/**
 * Backfill RBAC permissions for SLA policy management.
 *
 * Adds create/read/update/delete permissions for the sla_policy resource,
 * assigns them to Admin (all), Project Manager (read + update), and
 * Technician (read) roles.
 */

const MIGRATION_TENANT = 'migration:20260306120000_add_sla_policy_permissions';
const TENANT_ENUMERATION_REASON = 'enumerate tenants for SLA policy permission backfill';

async function loadTenantDb() {
  return (await import('@alga-psa/db')).tenantDb;
}

exports.up = async function up(knex) {
  const tenantDb = await loadTenantDb();
  const migrationDb = tenantDb(knex, MIGRATION_TENANT);
  const tenants = await migrationDb.unscoped('tenants', TENANT_ENUMERATION_REASON).select('tenant');

  const permissionDefs = [
    { resource: 'sla_policy', action: 'create', msp: true, client: false, description: 'Create SLA policies' },
    { resource: 'sla_policy', action: 'read', msp: true, client: false, description: 'View SLA policies' },
    { resource: 'sla_policy', action: 'update', msp: true, client: false, description: 'Update SLA policies' },
    { resource: 'sla_policy', action: 'delete', msp: true, client: false, description: 'Delete SLA policies' },
  ];

  // Role → actions mapping (Admin gets all MSP permissions automatically)
  const roleActions = {
    'Project Manager': ['read', 'update'],
    'Technician': ['read'],
  };

  for (const { tenant } of tenants) {
    const db = tenantDb(knex, tenant);

    // Upsert permissions
    for (const def of permissionDefs) {
      const existing = await db.table('permissions')
        .where({ tenant, resource: def.resource, action: def.action, msp: true })
        .first('permission_id');

      if (!existing) {
        await db.table('permissions').insert({
          tenant,
          resource: def.resource,
          action: def.action,
          msp: def.msp,
          client: def.client,
          description: def.description,
        });
      }
    }

    // Grant to Admin role (all sla_policy permissions)
    const adminRole = await db.table('roles')
      .where({ tenant, role_name: 'Admin', msp: true })
      .first('role_id');

    if (adminRole) {
      const allPerms = await db.table('permissions')
        .where({ tenant, resource: 'sla_policy', msp: true })
        .select('permission_id');

      for (const { permission_id } of allPerms) {
        const exists = await db.table('role_permissions')
          .where({ tenant, role_id: adminRole.role_id, permission_id })
          .first('tenant');
        if (!exists) {
          await db.table('role_permissions').insert({
            tenant,
            role_id: adminRole.role_id,
            permission_id,
          });
        }
      }
    }

    // Grant to Project Manager and Technician
    for (const [roleName, actions] of Object.entries(roleActions)) {
      const role = await db.table('roles')
        .where({ tenant, role_name: roleName, msp: true })
        .first('role_id');
      if (!role) continue;

      const perms = await db.table('permissions')
        .where({ tenant, resource: 'sla_policy', msp: true })
        .whereIn('action', actions)
        .select('permission_id');

      for (const { permission_id } of perms) {
        const exists = await db.table('role_permissions')
          .where({ tenant, role_id: role.role_id, permission_id })
          .first('tenant');
        if (!exists) {
          await db.table('role_permissions').insert({
            tenant,
            role_id: role.role_id,
            permission_id,
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
  const actions = ['create', 'read', 'update', 'delete'];

  for (const { tenant } of tenants) {
    const db = tenantDb(knex, tenant);
    const permissionIds = await db.table('permissions')
      .where({ tenant, resource: 'sla_policy' })
      .whereIn('action', actions)
      .pluck('permission_id');

    if (permissionIds.length > 0) {
      await db.table('role_permissions')
        .where({ tenant })
        .whereIn('permission_id', permissionIds)
        .del();

      await db.table('permissions')
        .where({ tenant, resource: 'sla_policy' })
        .whereIn('action', actions)
        .del();
    }
  }
};
