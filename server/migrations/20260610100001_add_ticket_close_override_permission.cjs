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
exports.up = async function (knex) {
  const tenants = await knex('tenants').select('tenant');
  if (!tenants.length) return;

  for (const { tenant } of tenants) {
    let permission = await knex('permissions')
      .where({ tenant, resource: 'ticket', action: 'close_override' })
      .first();

    if (!permission) {
      [permission] = await knex('permissions')
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

    const roles = await knex('roles').where({ tenant });
    const adminRoles = roles.filter(
      (r) => r.role_name && r.role_name.toLowerCase() === 'admin' && r.msp !== false
    );

    for (const adminRole of adminRoles) {
      const existing = await knex('role_permissions')
        .where({ tenant, role_id: adminRole.role_id, permission_id: permission.permission_id })
        .first();
      if (!existing) {
        await knex('role_permissions').insert({
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
  const permissions = await knex('permissions')
    .where({ resource: 'ticket', action: 'close_override' })
    .select('tenant', 'permission_id');

  for (const { tenant, permission_id } of permissions) {
    await knex('role_permissions').where({ tenant, permission_id }).del();
    await knex('permissions').where({ tenant, permission_id }).del();
  }
};
