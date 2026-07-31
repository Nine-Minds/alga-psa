/**
 * Adds extension read/write permissions for all tenants and ensures MSP Admin has them.
 */

const MIGRATION_TENANT = 'migration:20250301120000_add_extension_permissions';
const TENANT_ENUMERATION_REASON = 'enumerate tenants for extension permission backfill';

async function loadTenantDb() {
  return require('./utils/tenantDb.cjs').tenantDb;
}

exports.up = async function up(knex) {
  const tenantDb = await loadTenantDb();
  const migrationDb = tenantDb(knex, MIGRATION_TENANT);
  const tenants = await migrationDb.unscoped('tenants', TENANT_ENUMERATION_REASON).pluck('tenant');
  if (!tenants.length) {
    return;
  }

  for (const tenant of tenants) {
    const db = tenantDb(knex, tenant);
    const adminRole = await db.table('roles')
      .where({ tenant, role_name: 'Admin', msp: true })
      .first('role_id');

    const actions = [
      { action: 'read', description: 'Read extension APIs and storage' },
      { action: 'write', description: 'Write extension APIs and storage' },
    ];

    for (const { action, description } of actions) {
      const existing = await db.table('permissions')
        .where({ tenant, resource: 'extension', action })
        .first(['permission_id', 'msp', 'description']);

      let permissionId = existing?.permission_id;

      if (existing) {
        if (!existing.msp || !existing.description) {
          await db.table('permissions')
            .where({ permission_id: existing.permission_id })
            .update({
              msp: true,
              description: existing.description || description,
            });
        }
      } else {
        const [inserted] = await db.table('permissions')
          .insert({
            permission_id: knex.raw('gen_random_uuid()'),
            tenant,
            resource: 'extension',
            action,
            msp: true,
            client: false,
            description,
            created_at: knex.fn.now(),
          })
          .returning(['permission_id']);
        permissionId = inserted.permission_id;
      }

      if (!permissionId || !adminRole) {
        continue;
      }

      const existingAssignment = await db.table('role_permissions')
        .where({ tenant, role_id: adminRole.role_id, permission_id: permissionId })
        .first();

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

exports.down = async function down(knex) {
  const tenantDb = await loadTenantDb();
  const migrationDb = tenantDb(knex, MIGRATION_TENANT);
  const tenants = await migrationDb.unscoped('tenants', TENANT_ENUMERATION_REASON).pluck('tenant');
  if (!tenants.length) {
    return;
  }

  for (const tenant of tenants) {
    const db = tenantDb(knex, tenant);
    const adminRole = await db.table('roles')
      .where({ tenant, role_name: 'Admin', msp: true })
      .first('role_id');

    const permissions = await db.table('permissions')
      .where({ tenant, resource: 'extension' })
      .whereIn('action', ['read', 'write'])
      .select(['permission_id']);

    for (const permission of permissions) {
      if (adminRole) {
        await db.table('role_permissions')
          .where({ tenant, role_id: adminRole.role_id, permission_id: permission.permission_id })
          .delete();
      }
    }

    await db.table('permissions')
      .where({ tenant, resource: 'extension' })
      .whereIn('action', ['read', 'write'])
      .delete();
  }
};
