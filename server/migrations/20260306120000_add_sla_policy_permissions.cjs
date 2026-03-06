/**
 * Backfill RBAC permissions for SLA policy management.
 *
 * Adds create/read/update/delete permissions for the sla_policy resource,
 * assigns them to Admin (all), Project Manager (read + update), and
 * Technician (read) roles.
 */

exports.up = async function up(knex) {
  const tenants = await knex('tenants').select('tenant');

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
    // Upsert permissions
    for (const def of permissionDefs) {
      const existing = await knex('permissions')
        .where({ tenant, resource: def.resource, action: def.action, msp: true })
        .first('permission_id');

      if (!existing) {
        await knex('permissions').insert({
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
    const adminRole = await knex('roles')
      .where({ tenant, role_name: 'Admin', msp: true })
      .first('role_id');

    if (adminRole) {
      const allPerms = await knex('permissions')
        .where({ tenant, resource: 'sla_policy', msp: true })
        .select('permission_id');

      for (const { permission_id } of allPerms) {
        const exists = await knex('role_permissions')
          .where({ tenant, role_id: adminRole.role_id, permission_id })
          .first('tenant');
        if (!exists) {
          await knex('role_permissions').insert({
            tenant,
            role_id: adminRole.role_id,
            permission_id,
          });
        }
      }
    }

    // Grant to Project Manager and Technician
    for (const [roleName, actions] of Object.entries(roleActions)) {
      const role = await knex('roles')
        .where({ tenant, role_name: roleName, msp: true })
        .first('role_id');
      if (!role) continue;

      const perms = await knex('permissions')
        .where({ tenant, resource: 'sla_policy', msp: true })
        .whereIn('action', actions)
        .select('permission_id');

      for (const { permission_id } of perms) {
        const exists = await knex('role_permissions')
          .where({ tenant, role_id: role.role_id, permission_id })
          .first('tenant');
        if (!exists) {
          await knex('role_permissions').insert({
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
  const tenants = await knex('tenants').select('tenant');
  const actions = ['create', 'read', 'update', 'delete'];

  for (const { tenant } of tenants) {
    const permissionIds = await knex('permissions')
      .where({ tenant, resource: 'sla_policy' })
      .whereIn('action', actions)
      .pluck('permission_id');

    if (permissionIds.length > 0) {
      await knex('role_permissions')
        .where({ tenant })
        .whereIn('permission_id', permissionIds)
        .del();

      await knex('permissions')
        .where({ tenant, resource: 'sla_policy' })
        .whereIn('action', actions)
        .del();
    }
  }
};
