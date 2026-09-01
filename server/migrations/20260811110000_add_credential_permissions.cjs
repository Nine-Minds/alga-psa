/**
 * Seeds the RBAC permissions for the `credential` resource (Credentials Vault).
 *
 * Resource: credential
 * Actions:  create, read, update, delete, reveal
 *
 * Default grant matrix (idempotent, enumerated per tenant like the opportunity
 * permission migration):
 *
 *   Admin                — all five actions
 *   Technician           — all five actions
 *   Manager, Project Manager, Dispatcher — read + reveal (viewing only)
 *   Finance and client roles            — none
 *
 * `credential:reveal` is deliberately a separate action so "can see a row
 * exists" and "can unmask the value" are independently grantable. Audit and
 * per-item ACLs are enforced in code on top of these role grants.
 */

const MIGRATION_TENANT = 'migration:20260811110000_add_credential_permissions';
const TENANT_ENUMERATION_REASON = 'enumerate tenants for credential permission seed';

const PERMISSIONS = [
  { action: 'create', description: 'Create credentials in the vault' },
  { action: 'read', description: 'View credential metadata and the credentials vault' },
  { action: 'update', description: 'Update credentials and their access grants' },
  { action: 'delete', description: 'Delete credentials from the vault' },
  { action: 'reveal', description: 'Reveal the plaintext value of a credential' },
];

const FULL_ACCESS_ROLES = ['Admin', 'Technician'];
const VIEW_ACCESS_ROLES = ['Manager', 'Project Manager', 'Dispatcher'];

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
        .where({ tenant, resource: 'credential', action: definition.action })
        .first(['permission_id', 'description', 'msp', 'client']);

      if (!permission) {
        const [inserted] = await db.table('permissions')
          .insert({
            tenant,
            resource: 'credential',
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

    const roles = await db.table('roles')
      .where({ tenant, msp: true })
      .whereIn('role_name', [...FULL_ACCESS_ROLES, ...VIEW_ACCESS_ROLES])
      .select('role_id', 'role_name');

    for (const role of roles) {
      const fullAccess = FULL_ACCESS_ROLES.includes(role.role_name);
      const viewOnly = VIEW_ACCESS_ROLES.includes(role.role_name);
      if (!fullAccess && !viewOnly) {
        continue;
      }

      const grantedPermissionIds = fullAccess
        ? permissionIds
        : permissionIds.filter((_, index) => ['read', 'reveal'].includes(PERMISSIONS[index].action));

      for (const permissionId of grantedPermissionIds) {
        const existingRolePermission = await db.table('role_permissions')
          .where({ tenant, role_id: role.role_id, permission_id: permissionId })
          .first('tenant');

        if (!existingRolePermission) {
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
      .where({ tenant, resource: 'credential' })
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
      .where({ tenant, resource: 'credential' })
      .whereIn('action', PERMISSIONS.map(({ action }) => action))
      .del();
  }
};
