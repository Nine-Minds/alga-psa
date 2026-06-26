/**
 * Backfill RBAC permissions for the service catalog.
 *
 * Products are implemented as a subset of the service catalog (`service_catalog.item_kind = 'product'`),
 * so we reuse the `service:*` RBAC resource for both services and products.
 */

const MIGRATION_TENANT = 'migration:20260102213000_add_service_catalog_permissions';
const TENANT_ENUMERATION_REASON = 'enumerate tenants for service catalog permission backfill';

async function loadTenantDb() {
  return (await import('@alga-psa/db')).tenantDb;
}

exports.up = async function up(knex) {
  const tenantDb = await loadTenantDb();
  const migrationDb = tenantDb(knex, MIGRATION_TENANT);
  const tenants = await migrationDb.unscoped('tenants', TENANT_ENUMERATION_REASON).select('tenant');

  const permissionDefs = [
    { resource: 'service', action: 'create', msp: true, client: false, description: 'Create services/products in the service catalog' },
    { resource: 'service', action: 'read', msp: true, client: false, description: 'View services/products in the service catalog' },
    { resource: 'service', action: 'update', msp: true, client: false, description: 'Update services/products in the service catalog' },
    { resource: 'service', action: 'delete', msp: true, client: false, description: 'Archive/delete services/products in the service catalog' },
  ];

  for (const { tenant } of tenants) {
    const db = tenantDb(knex, tenant);
    // Insert any missing permissions for this tenant
    for (const def of permissionDefs) {
      const existing = await db.table('permissions')
        .where({ tenant, resource: def.resource, action: def.action })
        .first(['permission_id', 'msp', 'client', 'description']);

      if (!existing) {
        await db.table('permissions').insert({
          tenant,
          resource: def.resource,
          action: def.action,
          msp: def.msp,
          client: def.client,
          description: def.description,
        });
      } else {
        // Keep existing permissions, but ensure MSP flag/description are set.
        const nextMsp = Boolean(existing.msp) || def.msp;
        const nextClient = Boolean(existing.client) || def.client;
        const nextDescription = existing.description || def.description;

        if (nextMsp !== existing.msp || nextClient !== existing.client || nextDescription !== existing.description) {
          await db.table('permissions')
            .where({ tenant, permission_id: existing.permission_id })
            .update({
              msp: nextMsp,
              client: nextClient,
              description: nextDescription,
              updated_at: knex.fn.now(),
            });
        }
      }
    }

    // Ensure MSP Admin role gets these permissions (Admin is defined as "all MSP permissions")
    // but role_permissions may already be missing them on existing tenants.
    const adminRole = await db.table('roles')
      .where({ tenant, role_name: 'Admin', msp: true })
      .first(['role_id']);
    if (!adminRole) continue;

    const perms = await db.table('permissions')
      .where({ tenant, resource: 'service' })
      .whereIn('action', permissionDefs.map((d) => d.action))
      .select(['permission_id']);

    for (const { permission_id } of perms) {
      const existingRp = await db.table('role_permissions')
        .where({ tenant, role_id: adminRole.role_id, permission_id })
        .first('tenant');
      if (existingRp) continue;
      await db.table('role_permissions').insert({
        tenant,
        role_id: adminRole.role_id,
        permission_id,
      });
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
      .where({ tenant, resource: 'service' })
      .whereIn('action', actions)
      .pluck('permission_id');

    if (permissionIds.length > 0) {
      await db.table('role_permissions')
        .where({ tenant })
        .whereIn('permission_id', permissionIds)
        .del();

      await db.table('permissions')
        .where({ tenant, resource: 'service' })
        .whereIn('action', actions)
        .del();
    }
  }
};
