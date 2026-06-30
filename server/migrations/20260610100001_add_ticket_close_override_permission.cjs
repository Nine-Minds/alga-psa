/**
 * Adds the ticket:close_override permission (2026-06-10).
 *
 * Holders may close a ticket despite unmet board close rules; every override
 * is written to ticket_audit_logs with the skipped conditions. Granted to
 * each tenant's MSP Admin role by default. New tenants receive it via
 * ee/server/seeds/onboarding/psa/02_permissions.cjs.
 *
 * Idempotent: skips tenants that already have the permission.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
const MIGRATION_TENANT = 'migration:20260610100001_add_ticket_close_override_permission';
const TENANT_ENUMERATION_REASON = 'enumerate tenants for ticket close override permission backfill';
const PERMISSION_DISCOVERY_REASON = 'discover ticket close override permissions for rollback';

async function loadTenantDb() {
  return require('./utils/tenantDb.cjs').tenantDb;
}

exports.up = async function (knex) {
  const tenantDb = await loadTenantDb();
  const migrationDb = tenantDb(knex, MIGRATION_TENANT);
  const tenants = await migrationDb.unscoped('tenants', TENANT_ENUMERATION_REASON).select('tenant');
  if (!tenants.length) return;

  for (const { tenant } of tenants) {
    const db = tenantDb(knex, tenant);
    let permission = await db.table('permissions')
      .where({ tenant, resource: 'ticket', action: 'close_override' })
      .first();

    if (!permission) {
      [permission] = await db.table('permissions')
        .insert({
          tenant,
          permission_id: knex.raw('gen_random_uuid()'),
          resource: 'ticket',
          action: 'close_override',
          msp: true,
          client: false,
          description: 'Override ticket close rules',
          created_at: new Date(),
        })
        .returning('*');
    }

    const roles = await db.table('roles').where({ tenant });
    const adminRoles = roles.filter(
      (r) => r.role_name && r.role_name.toLowerCase() === 'admin' && r.msp !== false
    );

    for (const adminRole of adminRoles) {
      const existing = await db.table('role_permissions')
        .where({ tenant, role_id: adminRole.role_id, permission_id: permission.permission_id })
        .first();
      if (!existing) {
        await db.table('role_permissions').insert({
          tenant,
          role_id: adminRole.role_id,
          permission_id: permission.permission_id,
        });
      }
    }
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  const tenantDb = await loadTenantDb();
  const migrationDb = tenantDb(knex, MIGRATION_TENANT);
  const permissions = await migrationDb.unscoped('permissions', PERMISSION_DISCOVERY_REASON)
    .where({ resource: 'ticket', action: 'close_override' })
    .select('tenant', 'permission_id');

  for (const { tenant, permission_id } of permissions) {
    const db = tenantDb(knex, tenant);
    await db.table('role_permissions').where({ tenant, permission_id }).del();
    await db.table('permissions').where({ tenant, permission_id }).del();
  }
};
