const MIGRATION_TENANT = 'migration:20260127120000_backfill_email_process_permission';
const TENANT_ENUMERATION_REASON = 'enumerate tenants for email process permission backfill';

async function loadTenantDb() {
  return require('./utils/tenantDb.cjs').tenantDb;
}

exports.up = async function (knex) {
  const tenantDb = await loadTenantDb();
  const migrationDb = tenantDb(knex, MIGRATION_TENANT);
  const tenants = await migrationDb.unscoped('tenants', TENANT_ENUMERATION_REASON).select('tenant');
  if (!tenants.length) return;

  const permission = {
    resource: 'email',
    action: 'process',
    msp: true,
    client: false,
    description: 'Process outbound email'
  };

  for (const { tenant } of tenants) {
    const db = tenantDb(knex, tenant);
    const existing = await db.table('permissions')
      .where({ tenant, resource: permission.resource, action: permission.action })
      .select('permission_id')
      .limit(1);

    if (!existing.length) {
      await db.table('permissions').insert({
        tenant,
        permission_id: knex.raw('gen_random_uuid()'),
        created_at: new Date(),
        ...permission
      });
    }

    const adminRole = await db.table('roles')
      .where({ tenant, role_name: 'Admin', msp: true })
      .first();

    if (!adminRole) continue;

    const permRow = await db.table('permissions')
      .where({ tenant, resource: permission.resource, action: permission.action })
      .first();

    if (!permRow?.permission_id) continue;

    const hasRolePerm = await db.table('role_permissions')
      .where({ tenant, role_id: adminRole.role_id, permission_id: permRow.permission_id })
      .first();

    if (!hasRolePerm) {
      await db.table('role_permissions').insert({
        tenant,
        role_id: adminRole.role_id,
        permission_id: permRow.permission_id
      });
    }
  }
};

exports.down = async function (knex) {
  const tenantDb = await loadTenantDb();
  const migrationDb = tenantDb(knex, MIGRATION_TENANT);
  const tenants = await migrationDb.unscoped('tenants', TENANT_ENUMERATION_REASON).select('tenant');
  if (!tenants.length) return;

  for (const { tenant } of tenants) {
    const db = tenantDb(knex, tenant);
    const perms = await db.table('permissions')
      .where({ tenant, resource: 'email', action: 'process' })
      .select('permission_id');

    const permIds = perms.map((p) => p.permission_id);
    if (!permIds.length) continue;

    await db.table('role_permissions')
      .where({ tenant })
      .whereIn('permission_id', permIds)
      .del();

    await db.table('permissions')
      .where({ tenant, resource: 'email', action: 'process' })
      .del();
  }
};
