/**
 * Keep every non-seat MSP user's access to the commercial lookups (getServices,
 * getEligibleContractLinesForUI) when those lookups start requiring `service:read`
 * (co-managed seat slice S13, F031).
 *
 * Before S13 any signed-in user could call them, so the project task and phase forms, the time-entry
 * contract-line preview and the availability settings worked for every internal role. The catalog now
 * grants `service:read` to every standard MSP role that uses them (Admin, Dispatcher, Finance, Manager,
 * Project Manager, Technician), and this migration:
 *
 *   1. reconciles every tenant against the catalog (additive; creates the permission row where missing and
 *      grants the standard roles), then
 *   2. grants `service:read` to every other MSP-scoped role the tenant has, custom roles included,
 *      EXCEPT the Seat Technician role (`CO_MANAGED_SEAT_ROLE`), which is deliberately commercial-blind.
 *
 * Only tenants that have the `service:read` permission row (PSA tenants) are touched in step 2; the
 * service catalog is not part of the AlgaDesk or co-managed products. Additive and idempotent: it never
 * removes a grant, and a rerun writes nothing. Roles created after this migration receive the permission
 * only if an administrator grants it, which is the intended new behaviour.
 */

const { reconcileAllTenants } = require('./utils/permissions/reconcileTenants.cjs');

// Pinned to CO_MANAGED_SEAT_ROLE.role_name (packages/co-managed/src/seatRole.ts) by a unit test.
const SEAT_ROLE_NAME = 'Seat Technician';
const MIGRATION_TENANT = 'migration:20261113140000_grant_service_read_to_msp_roles';
const TENANT_ENUMERATION_REASON = 'enumerate tenants to grant service:read to existing MSP roles';

async function grantServiceReadToMspRoles(knex, db, tenant) {
  const permission = await db.table('permissions')
    .where({ tenant, resource: 'service', action: 'read', msp: true, client: false })
    .first('permission_id');
  if (!permission) return 0;

  const roles = await db.table('roles')
    .where({ tenant, msp: true, client: false })
    .whereNot({ role_name: SEAT_ROLE_NAME })
    .select('role_id');

  let granted = 0;
  for (const { role_id: roleId } of roles) {
    const existing = await db.table('role_permissions')
      .where({ tenant, role_id: roleId, permission_id: permission.permission_id })
      .first('tenant');
    if (existing) continue;
    // migration-lint: allow 8 - additive backfill of one catalog permission (service:read) onto existing MSP roles, idempotent (checked above); custom roles are outside the catalog's default-role grants, so reconcileAllTenants cannot reach them
    await db.table('role_permissions').insert({
      tenant, role_id: roleId, permission_id: permission.permission_id, created_at: knex.fn.now(),
    });
    granted += 1;
  }
  return granted;
}

exports.up = async function up(knex) {
  const tenantDb = require('./utils/tenantDb.cjs').tenantDb;

  // migration-lint: allow 8 - reconcileAllTenants is the repo-standard, additive, per-tenant-idempotent way to provision a catalog permission and its default grants (server/migrations/utils/permissions/README.md, "Adding a permission"); service:read is declared in catalog.cjs
  await reconcileAllTenants(knex, { label: 'grant_service_read_to_msp_roles' });

  const tenants = await tenantDb(knex, MIGRATION_TENANT).unscoped('tenants', TENANT_ENUMERATION_REASON).select('tenant');
  for (const { tenant } of tenants) {
    await knex.transaction(async (trx) => {
      await grantServiceReadToMspRoles(trx, tenantDb(trx, tenant), tenant);
    });
  }
};

exports.down = async function down() {
  throw new Error(
    'grant_service_read_to_msp_roles is irreversible. Removing the grants would lock internal users out of '
    + 'the service lookups they use. Retiring a permission requires its own reviewed migration - see '
    + 'server/migrations/utils/permissions/README.md.',
  );
};

exports.config = { transaction: false };
