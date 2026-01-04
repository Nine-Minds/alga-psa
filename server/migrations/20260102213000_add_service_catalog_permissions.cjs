/**
 * Backfill RBAC permissions for the service catalog.
 *
 * Products are implemented as a subset of the service catalog (`service_catalog.item_kind = 'product'`),
 * so we reuse the `service:*` RBAC resource for both services and products.
 */

exports.up = async function up(knex) {
  const tenants = await knex('tenants').select('tenant');

  const permissionDefs = [
    { resource: 'service', action: 'create', msp: true, client: false, description: 'Create services/products in the service catalog' },
    { resource: 'service', action: 'read', msp: true, client: false, description: 'View services/products in the service catalog' },
    { resource: 'service', action: 'update', msp: true, client: false, description: 'Update services/products in the service catalog' },
    { resource: 'service', action: 'delete', msp: true, client: false, description: 'Archive/delete services/products in the service catalog' },
  ];

  for (const { tenant } of tenants) {
    // Insert any missing permissions for this tenant
    for (const def of permissionDefs) {
      const existing = await knex('permissions')
        .where({ tenant, resource: def.resource, action: def.action })
        .first(['permission_id', 'msp', 'client', 'description']);

      if (!existing) {
        await knex('permissions').insert({
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
          await knex('permissions')
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
    const adminRole = await knex('roles')
      .where({ tenant, role_name: 'Admin', msp: true })
      .first(['role_id']);
    if (!adminRole) continue;

    const perms = await knex('permissions')
      .where({ tenant, resource: 'service' })
      .whereIn('action', permissionDefs.map((d) => d.action))
      .select(['permission_id']);

    for (const { permission_id } of perms) {
      const existingRp = await knex('role_permissions')
        .where({ tenant, role_id: adminRole.role_id, permission_id })
        .first('tenant');
      if (existingRp) continue;
      await knex('role_permissions').insert({
        tenant,
        role_id: adminRole.role_id,
        permission_id,
      });
    }
  }
};

exports.down = async function down(knex) {
  const tenants = await knex('tenants').select('tenant');
  const actions = ['create', 'read', 'update', 'delete'];

  for (const { tenant } of tenants) {
    const permissionIds = await knex('permissions')
      .where({ tenant, resource: 'service' })
      .whereIn('action', actions)
      .pluck('permission_id');

    if (permissionIds.length > 0) {
      await knex('role_permissions')
        .where({ tenant })
        .whereIn('permission_id', permissionIds)
        .del();

      await knex('permissions')
        .where({ tenant, resource: 'service' })
        .whereIn('action', actions)
        .del();
    }
  }
};
