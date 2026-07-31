const RESOURCE = 'inbound_webhook';
const MIGRATION_TENANT = 'migration:20260511102000_add_inbound_webhook_permissions';
const TENANT_ENUMERATION_REASON = 'enumerate tenants for inbound webhook permission backfill';

const PERMISSIONS = [
  { action: 'create', description: 'Create inbound webhooks' },
  { action: 'read', description: 'View inbound webhooks and deliveries' },
  { action: 'update', description: 'Update inbound webhooks' },
  { action: 'delete', description: 'Delete inbound webhooks' },
  { action: 'replay', description: 'Replay inbound webhook deliveries' },
];

async function loadTenantDb() {
  return require('./utils/tenantDb.cjs').tenantDb;
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const tenantDb = await loadTenantDb();
  const migrationDb = tenantDb(knex, MIGRATION_TENANT);
  const tenants = await migrationDb.unscoped('tenants', TENANT_ENUMERATION_REASON).pluck('tenant');

  for (const tenant of tenants) {
    const db = tenantDb(knex, tenant);
    const adminRole = await db.table('roles')
      .where({ tenant, role_name: 'Admin', msp: true })
      .first('role_id');

    for (const { action, description } of PERMISSIONS) {
      const existingPermission = await db.table('permissions')
        .where({ tenant, resource: RESOURCE, action })
        .first(['permission_id', 'msp', 'client', 'description']);

      let permissionId = existingPermission?.permission_id;

      if (!existingPermission) {
        const [inserted] = await db.table('permissions')
          .insert({
            tenant,
            resource: RESOURCE,
            action,
            msp: true,
            client: false,
            description,
            created_at: knex.fn.now(),
          })
          .returning(['permission_id']);
        permissionId = inserted.permission_id;
      } else if (!existingPermission.msp || existingPermission.client || !existingPermission.description) {
        await db.table('permissions')
          .where({ tenant, permission_id: existingPermission.permission_id })
          .update({
            msp: true,
            client: false,
            description: existingPermission.description || description,
          });
      }

      if (!adminRole || !permissionId) {
        continue;
      }

      const existingAssignment = await db.table('role_permissions')
        .where({ tenant, role_id: adminRole.role_id, permission_id: permissionId })
        .first('tenant');

      if (!existingAssignment) {
        await db.table('role_permissions').insert({
          tenant,
          role_id: adminRole.role_id,
          permission_id: permissionId,
          created_at: knex.fn.now(),
        });
      }
    }
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  const tenantDb = await loadTenantDb();
  const migrationDb = tenantDb(knex, MIGRATION_TENANT);
  const tenants = await migrationDb.unscoped('tenants', TENANT_ENUMERATION_REASON).pluck('tenant');
  const actions = PERMISSIONS.map((permission) => permission.action);

  for (const tenant of tenants) {
    const db = tenantDb(knex, tenant);
    const permissionIds = await db.table('permissions')
      .where({ tenant, resource: RESOURCE })
      .whereIn('action', actions)
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
      .whereIn('action', actions)
      .del();
  }
};
