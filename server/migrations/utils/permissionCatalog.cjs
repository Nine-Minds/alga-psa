const { ALL_MSP, PERMISSIONS, ROLE_GRANTS } = require('./permissionCatalogData.cjs');

const RETIRED = [
  { resource: 'client_documents', action: 'read' },
  { resource: 'credit', action: 'reconcile' },
];

function normalizeProductCode(productCode) {
  return String(productCode || 'psa').toLowerCase() === 'algadesk' ? 'algadesk' : 'psa';
}

function permissionKey(permission) {
  return `${permission.resource}:${permission.action}:${Boolean(permission.msp)}:${Boolean(permission.client)}`;
}

function permissionMatchesGrant(permission, grant) {
  const [resource, action, scope] = grant.split(':');
  return permission.resource === resource
    && permission.action === action
    && (scope === 'msp' ? permission.msp : permission.client);
}

async function reconcileTenantPermissions(knex, tenant, productCode = 'psa') {
  const existingPermissions = await knex('permissions')
    .where({ tenant })
    .select('permission_id', 'resource', 'action', 'msp', 'client');
  const existingKeys = new Set(existingPermissions.map(permissionKey));
  const missingPermissions = PERMISSIONS
    .filter((permission) => !existingKeys.has(permissionKey(permission)))
    .map((permission) => ({
      tenant,
      permission_id: knex.raw('gen_random_uuid()'),
      ...permission,
      created_at: new Date(),
    }));

  if (missingPermissions.length > 0) await knex('permissions').insert(missingPermissions);

  for (const retired of RETIRED) {
    const permissionIds = await knex('permissions')
      .where({ tenant, ...retired })
      .pluck('permission_id');
    if (permissionIds.length === 0) continue;
    await knex('role_permissions')
      .where({ tenant })
      .whereIn('permission_id', permissionIds)
      .delete();
    await knex('permissions').where({ tenant, ...retired }).delete();
  }

  const roles = await knex('roles')
    .where({ tenant })
    .select('role_id', 'role_name', 'msp', 'client');
  const permissions = await knex('permissions')
    .where({ tenant })
    .select('permission_id', 'resource', 'action', 'msp', 'client');
  const grants = ROLE_GRANTS[normalizeProductCode(productCode)];

  for (const role of roles) {
    const roleGrants = role.msp ? grants.msp[role.role_name] : grants.client[role.role_name];
    const permissionIds = roleGrants === ALL_MSP
      ? permissions.filter((permission) => permission.msp).map((permission) => permission.permission_id)
      : Array.isArray(roleGrants)
        ? permissions
          .filter((permission) => roleGrants.some((grant) => permissionMatchesGrant(permission, grant)))
          .map((permission) => permission.permission_id)
        : [];
    if (permissionIds.length === 0) continue;

    const existingRolePermissionIds = new Set(await knex('role_permissions')
      .where({ tenant, role_id: role.role_id })
      .whereIn('permission_id', permissionIds)
      .pluck('permission_id'));
    const missingRolePermissions = permissionIds
      .filter((permissionId) => !existingRolePermissionIds.has(permissionId))
      .map((permissionId) => ({ tenant, role_id: role.role_id, permission_id: permissionId }));
    if (missingRolePermissions.length > 0) await knex('role_permissions').insert(missingRolePermissions);
  }
}

async function reconcileAllTenants(knex) {
  const tenants = await knex('tenants').select('tenant', 'product_code');
  for (const row of tenants) await reconcileTenantPermissions(knex, row.tenant, row.product_code);
}

async function reconcileSeedTenants(knex, { tenantId, productCode, firstOnly = false } = {}) {
  if (tenantId) {
    await reconcileTenantPermissions(knex, tenantId, productCode);
    return;
  }
  let query = knex('tenants').select('tenant', 'product_code');
  if (productCode === 'algadesk') query = query.where({ product_code: 'algadesk' });
  if (firstOnly) query = query.first();
  const result = await query;
  const tenants = firstOnly ? (result ? [result] : []) : result;
  for (const row of tenants) await reconcileTenantPermissions(knex, row.tenant, productCode || row.product_code);
}

module.exports = {
  PERMISSIONS,
  ROLE_GRANTS,
  RETIRED,
  reconcileTenantPermissions,
  reconcileAllTenants,
  reconcileSeedTenants,
};
