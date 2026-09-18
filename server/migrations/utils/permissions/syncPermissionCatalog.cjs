/**
 * Additive permission-catalog synchronization.
 *
 * The comparison core (`buildCatalogPlan`) is shared by the writer here and by
 * the read-only audit in ./auditPermissionCatalog.cjs, so dry-run and apply can
 * never implement different definitions of drift.
 *
 * Invariants, enforced by tests:
 *   - no DELETE is ever issued against roles, permissions or role_permissions;
 *   - permissions/roles/grants outside the catalog are reported, never changed;
 *   - a rerun writes nothing;
 *   - each tenant is applied atomically;
 *   - with `{ onDrift: 'skip' }`, a tenant this cannot safely reconcile is
 *     reported and left untouched instead of failing the whole run.
 */

const crypto = require('crypto');

const { tenantDb } = require('../tenantDb.cjs');
const {
  PRODUCTS,
  catalogVersion,
  getProductPermissions,
  permissionIdentity,
} = require('./catalog.cjs');
const { compileRoleGrants, getDefaultRoles } = require('./roleGrants.cjs');
const { assertCatalogIsValid } = require('./catalogValidation.cjs');

const PERMISSION_COLUMNS = ['permission_id', 'resource', 'action', 'msp', 'client', 'description'];
const ROLE_COLUMNS = ['role_id', 'role_name', 'msp', 'client'];

// AlgaDesk -> AlgaPSA is the only supported product transition. The upgrade
// backfills the PSA seeds (and therefore this catalog) before it flips
// product_code, so the target catalog must be applicable to a tenant that is
// still recorded as the source product. Every other mismatch is a caller bug.
const SUPPORTED_PRODUCT_TRANSITIONS = { algadesk: ['psa'] };

/**
 * A tenant whose own shape stops it from being reconciled: no tenants row, a
 * missing or unknown product_code, a missing or duplicated default role.
 *
 * Callers that own the tenant they just created (seeds, onboarding, the
 * integration suite) let this throw. Fleet-wide callers pass
 * `{ onDrift: 'skip' }` so one historical tenant cannot abort a deployment —
 * drift is reported and that tenant is left untouched.
 */
class TenantCatalogDriftError extends Error {
  constructor(tenantId, reasons) {
    super(`Permission catalog synchronization failed:\n  - ${reasons.join('\n  - ')}`);
    this.name = 'TenantCatalogDriftError';
    this.tenantId = tenantId;
    this.reasons = reasons;
  }
}

function assertProduct(product) {
  if (!PRODUCTS.includes(product)) {
    throw new Error(`Unknown product "${product}"; expected one of ${PRODUCTS.join(', ')}`);
  }
}

/**
 * Pure comparison. Everything the writer does is decided here.
 *
 * @param {object} input
 * @param {string} input.tenantId
 * @param {string} input.product
 * @param {object[]} input.permissions tenant `permissions` rows
 * @param {object[]} input.roles tenant `roles` rows
 * @param {object[]} input.rolePermissions tenant `role_permissions` rows
 */
function buildCatalogPlan({ tenantId, product, permissions, roles, rolePermissions }) {
  assertProduct(product);

  const entries = getProductPermissions(product);
  const entryByIdentity = new Map(entries.map((entry) => [permissionIdentity(entry), entry]));
  const rowByIdentity = new Map();
  const duplicateIdentities = [];

  for (const row of permissions) {
    const identity = permissionIdentity(row);
    if (rowByIdentity.has(identity)) {
      duplicateIdentities.push(identity);
      continue;
    }
    rowByIdentity.set(identity, row);
  }

  const missingPermissions = [];
  const descriptionUpdates = [];
  for (const entry of entries) {
    const identity = permissionIdentity(entry);
    const row = rowByIdentity.get(identity);
    if (!row) {
      missingPermissions.push(entry);
    } else if (row.description !== entry.description) {
      descriptionUpdates.push({
        identity,
        permissionId: row.permission_id,
        from: row.description ?? null,
        to: entry.description,
      });
    }
  }

  const unknownPermissions = [...rowByIdentity.keys()].filter((identity) => !entryByIdentity.has(identity));

  const grantsByRole = new Map();
  for (const grant of rolePermissions) {
    if (!grantsByRole.has(grant.role_id)) grantsByRole.set(grant.role_id, new Set());
    grantsByRole.get(grant.role_id).add(grant.permission_id);
  }

  const compiled = compileRoleGrants(product);
  const roleResolution = [];
  const missingGrants = [];
  const errors = [];
  let extraGrants = 0;

  for (const role of getDefaultRoles(product)) {
    const matches = roles.filter((candidate) =>
      candidate.role_name === role.roleName
      && candidate.msp === role.msp
      && candidate.client === role.client);

    if (matches.length === 0) {
      roleResolution.push({ roleKey: role.key, status: role.legacy ? 'legacy-absent' : 'missing', roleId: null });
      if (!role.legacy) {
        errors.push(
          `Tenant ${tenantId} has no ${product} default role (role_name="${role.roleName}", msp=${role.msp}, client=${role.client}). `
          + 'Run the supported onboarding recovery for this tenant before reconciling permissions; catalog sync never creates roles.',
        );
      }
      continue;
    }
    if (matches.length > 1) {
      roleResolution.push({ roleKey: role.key, status: 'ambiguous', roleId: null });
      errors.push(
        `Tenant ${tenantId} has ${matches.length} roles matching the ${product} default role identity `
        + `(role_name="${role.roleName}", msp=${role.msp}, client=${role.client}). Resolve the duplicate before reconciling permissions.`,
      );
      continue;
    }

    const [match] = matches;
    roleResolution.push({ roleKey: role.key, status: 'resolved', roleId: match.role_id });

    const desired = compiled.get(role.key).identities;
    const held = grantsByRole.get(match.role_id) || new Set();
    const desiredPermissionIds = new Set();
    const missing = [];

    for (const identity of desired) {
      const row = rowByIdentity.get(identity);
      if (row) {
        desiredPermissionIds.add(row.permission_id);
        if (!held.has(row.permission_id)) missing.push(identity);
      } else {
        // Inserted in the same transaction; its id is resolved by the writer.
        missing.push(identity);
      }
    }

    for (const permissionId of held) {
      if (!desiredPermissionIds.has(permissionId)) extraGrants += 1;
    }

    if (missing.length > 0) {
      missingGrants.push({ roleKey: role.key, roleId: match.role_id, identities: missing });
    }
  }

  const customRoles = roles.filter((candidate) => !getDefaultRoles(product).some((role) =>
    candidate.role_name === role.roleName
    && candidate.msp === role.msp
    && candidate.client === role.client)).length;

  return {
    tenantId,
    product,
    catalogVersion: catalogVersion(),
    counts: {
      permissions: permissions.length,
      roles: roles.length,
      rolePermissions: rolePermissions.length,
    },
    missingPermissions,
    descriptionUpdates,
    missingGrants,
    roleResolution,
    unknownPermissions,
    duplicateIdentities,
    customRoles,
    extraGrants,
    errors,
  };
}

async function readTenantState(conn, tenantId) {
  const db = tenantDb(conn, tenantId);
  const [tenant, permissions, roles, rolePermissions] = await Promise.all([
    db.table('tenants').where({ tenant: tenantId }).first('tenant', 'product_code'),
    db.table('permissions').where({ tenant: tenantId }).select(...PERMISSION_COLUMNS),
    db.table('roles').where({ tenant: tenantId }).select(...ROLE_COLUMNS),
    db.table('role_permissions').where({ tenant: tenantId }).select('role_id', 'permission_id'),
  ]);
  return { db, tenant, permissions, roles, rolePermissions };
}

function resolveProduct(tenant, tenantId, requestedProduct) {
  if (!tenant) {
    throw new TenantCatalogDriftError(tenantId, [
      `Cannot synchronize the permission catalog: tenant ${tenantId} does not exist`,
    ]);
  }
  const tenantProduct = tenant.product_code;
  if (!PRODUCTS.includes(tenantProduct)) {
    throw new TenantCatalogDriftError(tenantId, [
      `Cannot synchronize the permission catalog for tenant ${tenantId}: product_code "${tenantProduct ?? 'null'}" is missing or invalid`,
    ]);
  }
  if (requestedProduct && requestedProduct !== tenantProduct) {
    if (!(SUPPORTED_PRODUCT_TRANSITIONS[tenantProduct] || []).includes(requestedProduct)) {
      throw new TenantCatalogDriftError(tenantId, [
        `Refusing to apply the "${requestedProduct}" permission catalog to tenant ${tenantId} (product_code "${tenantProduct}")`,
      ]);
    }
    // Supported transition: the upgrade backfills the target catalog before the
    // product_code flip commits, and never removes the source product's state.
    return requestedProduct;
  }
  return tenantProduct;
}

/**
 * Read-only comparison for one tenant.
 *
 * @param {import('knex').Knex} conn
 * @param {string} tenantId
 * @param {string} [product] expected product; the tenant's own product_code when omitted
 */
async function compareTenantCatalog(conn, tenantId, product) {
  const { tenant, permissions, roles, rolePermissions } = await readTenantState(conn, tenantId);
  const resolved = resolveProduct(tenant, tenantId, product);
  return buildCatalogPlan({ tenantId, product: resolved, permissions, roles, rolePermissions });
}

async function applyPermissions(conn, tenantId, plan) {
  const db = tenantDb(conn, tenantId);
  const inserted = [];

  if (plan.missingPermissions.length > 0) {
    const rows = plan.missingPermissions.map((entry) => ({
      tenant: tenantId,
      permission_id: crypto.randomUUID(),
      resource: entry.resource,
      action: entry.action,
      msp: entry.msp,
      client: entry.client,
      description: entry.description,
    }));
    await db.table('permissions').insert(rows);
    inserted.push(...rows.map((row) => permissionIdentity(row)));
  }

  for (const update of plan.descriptionUpdates) {
    await db.table('permissions')
      .where({ tenant: tenantId, permission_id: update.permissionId })
      .update({ description: update.to });
  }

  return inserted;
}

async function applyGrants(conn, tenantId, plan) {
  const db = tenantDb(conn, tenantId);

  // Reload after the permission inserts. Identity lookup keeps a dual-scope
  // permission distinct from a single-scope one of the same resource:action,
  // so a client role can hold a grant on an msp+client permission.
  const permissions = await db.table('permissions').where({ tenant: tenantId }).select(...PERMISSION_COLUMNS);
  const permissionIdByIdentity = new Map(permissions.map((row) => [permissionIdentity(row), row.permission_id]));

  const insertedGrants = [];
  for (const grant of plan.missingGrants) {
    const rows = [];
    for (const identity of grant.identities) {
      const permissionId = permissionIdByIdentity.get(identity);
      if (!permissionId) {
        throw new Error(
          `Tenant ${tenantId}: catalog permission ${identity} does not exist; synchronize the permission catalog `
          + `before granting it to ${grant.roleKey}`,
        );
      }
      rows.push({ tenant: tenantId, role_id: grant.roleId, permission_id: permissionId });
    }
    if (rows.length === 0) continue;

    // Plain values only: Citus rejects non-IMMUTABLE expressions in upsert payloads.
    await db.table('role_permissions').insert(rows).onConflict(['tenant', 'role_id', 'permission_id']).ignore();
    insertedGrants.push({ roleKey: grant.roleKey, count: rows.length });
  }

  return insertedGrants;
}

function skippedTenant(tenantId, reasons) {
  return { tenantId, skipped: true, reasons, catalogVersion: catalogVersion() };
}

// Compare, apply, verify — all inside one tenant-scoped transaction.
function runForTenant(knex, tenantId, product, options, apply) {
  assertCatalogIsValid();
  if (!tenantId) {
    throw new Error('The permission catalog requires an explicit tenant id');
  }
  const skipOnDrift = options.onDrift === 'skip';
  if (product) {
    try {
      assertProduct(product);
    } catch (error) {
      if (!skipOnDrift) throw error;
      return Promise.resolve(skippedTenant(tenantId, [error.message]));
    }
  }

  const run = async (conn) => {
    const startedAt = Date.now();
    let plan;
    try {
      plan = await compareTenantCatalog(conn, tenantId, product);
    } catch (error) {
      if (skipOnDrift && error instanceof TenantCatalogDriftError) {
        options.log?.warn?.('Permission catalog skipped a drifted tenant', { tenantId, reasons: error.reasons });
        return skippedTenant(tenantId, error.reasons);
      }
      throw error;
    }

    if (plan.errors.length > 0) {
      if (skipOnDrift) {
        options.log?.warn?.('Permission catalog skipped a drifted tenant', { tenantId, reasons: plan.errors });
        return skippedTenant(tenantId, plan.errors);
      }
      throw new TenantCatalogDriftError(tenantId, plan.errors);
    }

    const written = await apply(conn, plan);
    const verification = await compareTenantCatalog(conn, tenantId, plan.product);

    if (verification.missingGrants.length > 0
      || (written.insertedPermissions && verification.missingPermissions.length > 0)) {
      throw new Error(
        `Permission catalog verification failed for tenant ${tenantId}: `
        + `${verification.missingPermissions.length} permissions and `
        + `${verification.missingGrants.length} default-role grant sets are still missing`,
      );
    }
    if (verification.counts.permissions < plan.counts.permissions
      || verification.counts.roles < plan.counts.roles
      || verification.counts.rolePermissions < plan.counts.rolePermissions) {
      throw new Error(`Permission catalog synchronization reduced tenant ${tenantId} state; refusing to commit`);
    }

    const result = {
      tenantId,
      product: plan.product,
      catalogVersion: plan.catalogVersion,
      before: plan.counts,
      after: verification.counts,
      insertedPermissions: written.insertedPermissions ?? [],
      updatedDescriptions: written.insertedPermissions ? plan.descriptionUpdates.map((update) => update.identity) : [],
      insertedGrants: written.insertedGrants,
      preservedUnknownPermissions: verification.unknownPermissions.length,
      preservedExtraGrants: verification.extraGrants,
      customRoles: verification.customRoles,
      duplicateIdentities: verification.duplicateIdentities,
      durationMs: Date.now() - startedAt,
    };

    options.log?.info?.('Permission catalog synchronized', {
      tenantId,
      product: result.product,
      catalogVersion: result.catalogVersion,
      insertedPermissions: result.insertedPermissions.length,
      updatedDescriptions: result.updatedDescriptions.length,
      insertedGrants: result.insertedGrants.reduce((total, grant) => total + grant.count, 0),
      preservedUnknownPermissions: result.preservedUnknownPermissions,
      preservedExtraGrants: result.preservedExtraGrants,
      durationMs: result.durationMs,
    });

    return result;
  };

  // Participate in a caller's transaction (onboarding seeds run inside one);
  // otherwise open a transaction so the tenant is applied atomically.
  return knex.isTransaction ? run(knex) : knex.transaction(run);
}

/**
 * Synchronize one tenant to the catalog minimum state, atomically.
 *
 * Never deletes. Inserts missing catalog permissions, refreshes catalog-owned
 * descriptions, and adds missing default-role grants. Unknown permissions,
 * custom roles and extra grants are reported and left alone.
 *
 * With `{ onDrift: 'skip' }` a tenant whose own shape blocks reconciliation
 * (absent, unknown product_code, missing or duplicated default role) returns
 * `{ skipped: true, reasons }` instead of throwing, and nothing is written for
 * it. Without it, drift throws — which is what the seeds and the integration
 * suite want.
 *
 * @param {import('knex').Knex} knex knex instance or an open transaction
 * @param {string} tenantId
 * @param {string} [product] expected product; the tenant's own product_code when omitted
 * @param {{ log?: { info: Function, warn: Function }, onDrift?: 'throw'|'skip' }} [options]
 */
async function syncPermissionCatalog(knex, tenantId, product, options = {}) {
  return runForTenant(knex, tenantId, product, options, async (conn, plan) => ({
    insertedPermissions: await applyPermissions(conn, tenantId, plan),
    insertedGrants: await applyGrants(conn, tenantId, plan),
  }));
}

/**
 * Add the product's default-role grants without touching `permissions`.
 *
 * The grant half of `syncPermissionCatalog`, for the role-permission seeds.
 * Additive and idempotent; it fails loudly if a catalog permission the grants
 * reference has not been synchronized yet.
 *
 * @param {import('knex').Knex} knex knex instance or an open transaction
 * @param {string} tenantId
 * @param {string} [product] expected product; the tenant's own product_code when omitted
 * @param {{ log?: { info: Function, warn: Function }, onDrift?: 'throw'|'skip' }} [options]
 */
async function applyDefaultRoleGrants(knex, tenantId, product, options = {}) {
  return runForTenant(knex, tenantId, product, options, async (conn, plan) => ({
    insertedGrants: await applyGrants(conn, tenantId, plan),
  }));
}

/**
 * Tenants eligible for a product's catalog, in a stable order.
 *
 * @param {import('knex').Knex} knex
 * @param {string} product
 */
async function listTenantsForProduct(knex, product) {
  assertProduct(product);
  const rows = await knex('tenants').where({ product_code: product }).orderBy('tenant').select('tenant');
  return rows.map((row) => row.tenant);
}

module.exports = {
  TenantCatalogDriftError,
  applyDefaultRoleGrants,
  buildCatalogPlan,
  compareTenantCatalog,
  listTenantsForProduct,
  syncPermissionCatalog,
};
