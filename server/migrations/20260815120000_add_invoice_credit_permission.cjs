/**
 * Seed the `invoice:credit` permission and grant it to Admin and Finance MSP
 * roles.
 *
 * `POST /api/v1/invoices/{id}/credit` (ApiInvoiceController.applyCredit) is the
 * REST half of the credit draw-down feature's manual fallback when auto-apply
 * is off, but it gates on resource 'invoice' action 'credit' — a permission no
 * tenant ever had, so the endpoint returned 403 for everyone with nothing to
 * grant through the UI.
 *
 * Mirrors 20260611140000_add_financial_resource_permissions.cjs: Admin and
 * Finance MSP roles get the permission, matching their existing full
 * invoice/credit access.
 */

const PERMISSION_DEF = {
  resource: 'invoice',
  action: 'credit',
  msp: true,
  client: false,
  description: 'Apply credits to invoices',
};

const FULL_ACCESS_ROLES = ['Admin', 'Finance'];

async function ensurePermission(knex, tenant, def) {
  const existing = await knex('permissions')
    .where({ tenant, resource: def.resource, action: def.action })
    .first();

  if (existing) {
    if (existing.msp !== def.msp || existing.client !== def.client || existing.description !== def.description) {
      await knex('permissions')
        .where({ tenant, permission_id: existing.permission_id })
        .update({
          msp: def.msp,
          client: def.client,
          description: def.description,
          updated_at: knex.fn.now(),
        });
    }

    return existing.permission_id;
  }

  const [inserted] = await knex('permissions')
    .insert({
      tenant,
      resource: def.resource,
      action: def.action,
      msp: def.msp,
      client: def.client,
      description: def.description,
      created_at: knex.fn.now(),
    })
    .returning('permission_id');

  return inserted.permission_id;
}

async function assignPermission(knex, tenant, roleId, permissionId) {
  const existing = await knex('role_permissions')
    .where({ tenant, role_id: roleId, permission_id: permissionId })
    .first('tenant');

  if (existing) {
    return;
  }

  await knex('role_permissions').insert({
    tenant,
    role_id: roleId,
    permission_id: permissionId,
    created_at: knex.fn.now(),
  });
}

exports.up = async function up(knex) {
  const tenants = await knex('tenants').select('tenant');

  for (const { tenant } of tenants) {
    const permissionId = await ensurePermission(knex, tenant, PERMISSION_DEF);

    const roles = await knex('roles')
      .where({ tenant, msp: true })
      .whereIn('role_name', FULL_ACCESS_ROLES)
      .select('role_id');

    for (const role of roles) {
      await assignPermission(knex, tenant, role.role_id, permissionId);
    }
  }
};

exports.down = async function down(knex) {
  const tenants = await knex('tenants').select('tenant');

  for (const { tenant } of tenants) {
    const permissionIds = await knex('permissions')
      .where({ tenant, resource: 'invoice', action: 'credit' })
      .pluck('permission_id');

    if (!permissionIds.length) {
      continue;
    }

    await knex('role_permissions')
      .where({ tenant })
      .whereIn('permission_id', permissionIds)
      .del();

    await knex('permissions')
      .where({ tenant, resource: 'invoice', action: 'credit' })
      .del();
  }
};
