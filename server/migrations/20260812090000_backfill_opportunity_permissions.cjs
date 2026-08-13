// Re-run of 20260712105000_add_opportunity_permissions for tenants created after
// that migration ran: the onboarding permission seeds lacked the opportunities
// resource until 2026-08-12, so those tenants (notably appliances, where migrations
// run against an empty database before the tenant exists) have no opportunity
// permissions at all and the Opportunities page fails RBAC even for Admin.
const MIGRATION_TENANT = 'migration:20260812090000_backfill_opportunity_permissions';
const TENANT_ENUMERATION_REASON = 'enumerate tenants for opportunity permission backfill';

const PERMISSIONS = [
  { action: 'create', description: 'Create opportunities' },
  { action: 'read', description: 'View opportunities' },
  { action: 'update', description: 'Update opportunities' },
  { action: 'delete', description: 'Delete opportunities' },
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
        .where({ tenant, resource: 'opportunities', action: definition.action })
        .first(['permission_id', 'description', 'msp', 'client']);

      if (!permission) {
        const [inserted] = await db.table('permissions')
          .insert({
            tenant,
            resource: 'opportunities',
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

    const adminRoles = await db.table('roles')
      .where({ tenant, msp: true })
      .whereIn('role_name', ['Admin'])
      .select('role_id');

    for (const role of adminRoles) {
      for (const permissionId of permissionIds) {
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

// No-op: rolling back would also strip the grants made by 20260712105000 and
// the onboarding seeds, since the rows are indistinguishable.
exports.down = async function down() {};
