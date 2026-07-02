/**
 * Adds an RMM-specific permission for raw remote command execution.
 *
 * Workflow publishers may still use Tactical RMM command actions, but only
 * when the workflow actor also has this explicit MSP permission. Existing
 * tenants grant it to MSP Admin roles by default so current admin workflows
 * keep working while non-RMM workflow publishers are blocked.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const tenants = await knex('tenants').select('tenant');

  for (const { tenant } of tenants) {
    let permission = await knex('permissions')
      .where({ tenant, resource: 'rmm', action: 'execute_command' })
      .first();

    if (!permission) {
      [permission] = await knex('permissions')
        .insert({
          tenant,
          permission_id: knex.raw('gen_random_uuid()'),
          resource: 'rmm',
          action: 'execute_command',
          msp: true,
          client: false,
          description: 'Execute raw RMM remote commands',
          created_at: knex.fn.now(),
        })
        .returning('*');
    }

    const adminRoles = await knex('roles')
      .where({ tenant, msp: true })
      .whereRaw('lower(role_name) = ?', ['admin']);

    for (const adminRole of adminRoles) {
      const existing = await knex('role_permissions')
        .where({ tenant, role_id: adminRole.role_id, permission_id: permission.permission_id })
        .first();

      if (!existing) {
        await knex('role_permissions').insert({
          tenant,
          role_id: adminRole.role_id,
          permission_id: permission.permission_id,
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
  const permissions = await knex('permissions')
    .where({ resource: 'rmm', action: 'execute_command' })
    .select('tenant', 'permission_id');

  for (const { tenant, permission_id } of permissions) {
    await knex('role_permissions').where({ tenant, permission_id }).del();
    await knex('permissions').where({ tenant, permission_id }).del();
  }
};
