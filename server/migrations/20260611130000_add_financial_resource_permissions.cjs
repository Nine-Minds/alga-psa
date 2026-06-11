/**
 * Add RBAC permissions for the 'financial' resource.
 *
 * The v1 financial API controllers (ApiFinancialController — transactions,
 * credits apply/transfer, prepayment invoices, payment methods, tax, reports)
 * authorize against resource 'financial', but no tenant ever had permission
 * rows for that resource, so every documented /api/v1/financial endpoint
 * returned 403 — even for Admins, with nothing to grant through the UI.
 *
 * Admin and Finance MSP roles get the full financial permission set, matching
 * their existing full billing/credit/invoice access.
 */

const FINANCIAL_PERMISSION_DEFS = [
  { resource: 'financial', action: 'create', msp: true, client: false, description: 'Create financial records (transactions, payment methods, prepayment invoices)' },
  { resource: 'financial', action: 'read', msp: true, client: false, description: 'View financial data (transactions, credits, reports)' },
  { resource: 'financial', action: 'update', msp: true, client: false, description: 'Update financial records (apply credits, reconciliation)' },
  { resource: 'financial', action: 'delete', msp: true, client: false, description: 'Delete financial records' },
  { resource: 'financial', action: 'transfer', msp: true, client: false, description: 'Transfer credits between clients' },
];

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
    const permissionIds = [];

    for (const def of FINANCIAL_PERMISSION_DEFS) {
      permissionIds.push(await ensurePermission(knex, tenant, def));
    }

    const roles = await knex('roles')
      .where({ tenant, msp: true })
      .whereIn('role_name', FULL_ACCESS_ROLES)
      .select('role_id');

    for (const role of roles) {
      for (const permissionId of permissionIds) {
        await assignPermission(knex, tenant, role.role_id, permissionId);
      }
    }
  }
};

exports.down = async function down(knex) {
  const tenants = await knex('tenants').select('tenant');
  const actions = FINANCIAL_PERMISSION_DEFS.map((def) => def.action);

  for (const { tenant } of tenants) {
    const permissionIds = await knex('permissions')
      .where({ tenant, resource: 'financial' })
      .whereIn('action', actions)
      .pluck('permission_id');

    if (!permissionIds.length) {
      continue;
    }

    await knex('role_permissions')
      .where({ tenant })
      .whereIn('permission_id', permissionIds)
      .del();

    await knex('permissions')
      .where({ tenant, resource: 'financial' })
      .whereIn('action', actions)
      .del();
  }
};
