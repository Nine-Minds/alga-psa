
/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Get all tenants
  const tenants = await knex('tenants').select('tenant');
  if (!tenants.length) return;

  // For each tenant, add the client role if it doesn't exist
  for (const { tenant } of tenants) {
    // Check if client role already exists
    const existingRole = await knex('roles')
      .where({ tenant, role_name: 'client' })
      .first();
    
    if (!existingRole) {
      await knex('roles').insert({
        tenant,
        role_id: knex.raw('gen_random_uuid()'),
        role_name: 'client',
        description: 'Client user role'
      });
    }

    // Get the client role
    const clientRole = await knex('roles')
      .where({ tenant, role_name: 'client' })
      .first();

    if (clientRole) {
      // Get basic permissions for client role
      const clientPermissions = await knex('permissions')
        .where({ tenant })
        .where(function() {
          this.where('resource', 'project').andWhere('action', 'read')
            .orWhere(function() {
              this.where('resource', 'profile').whereIn('action', ['read', 'update']);
            })
            .orWhere(function() {
              this.where('resource', 'asset').andWhere('action', 'read');
            })
            .orWhere(function() {
              this.where('resource', 'ticket').whereIn('action', ['create', 'read', 'update']);
            });
        });

      // Assign permissions to client role
      for (const perm of clientPermissions) {
        const exists = await knex('role_permissions')
          .where({
            tenant,
            role_id: clientRole.role_id,
            permission_id: perm.permission_id
          })
          .first();

        if (!exists) {
          await knex('role_permissions').insert({
            tenant,
            role_id: clientRole.role_id,
            permission_id: perm.permission_id
          });
        }
      }
    }
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Get all tenants
  const tenants = await knex('tenants').select('tenant');
  if (!tenants.length) return;

  for (const { tenant } of tenants) {
    // Remove role permissions for client role
    await knex('role_permissions')
      .where('tenant', tenant)
      .whereIn('role_id', function() {
        this.select('role_id')
          .from('roles')
          .where('tenant', tenant)
          .where('role_name', 'client');
      })
      .delete();

    // Remove client role
    await knex('roles')
      .where('tenant', tenant)
      .where('role_name', 'client')
      .delete();
  }
};
