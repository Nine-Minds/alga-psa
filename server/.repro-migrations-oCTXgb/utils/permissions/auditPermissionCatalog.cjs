/**
 * Read-only permission-catalog drift audit.
 *
 * Shares `compareTenantCatalog` with the writer, so the dry run and the apply
 * can never disagree about what drift is. This module issues SELECTs only.
 *
 * The per-tenant detail belongs in a restricted deployment artifact, never in
 * the repository or a public CI log.
 */

const { catalogVersion } = require('./catalog.cjs');
const { compareTenantCatalog } = require('./syncPermissionCatalog.cjs');

function summarizePlan(plan) {
  return {
    tenantId: plan.tenantId,
    product: plan.product,
    counts: plan.counts,
    missingPermissions: plan.missingPermissions.map((entry) => `${entry.resource}:${entry.action}`),
    updatedDescriptions: plan.descriptionUpdates.length,
    missingGrants: plan.missingGrants.map((grant) => ({ roleKey: grant.roleKey, count: grant.identities.length })),
    unresolvedRoles: plan.roleResolution
      .filter((role) => role.status === 'missing' || role.status === 'ambiguous')
      .map((role) => ({ roleKey: role.roleKey, status: role.status })),
    preservedUnknownPermissions: plan.unknownPermissions.length,
    preservedExtraGrants: plan.extraGrants,
    customRoles: plan.customRoles,
    duplicateIdentities: plan.duplicateIdentities,
    errors: plan.errors,
  };
}

/**
 * Audit one tenant. Never writes.
 *
 * @param {import('knex').Knex} knex
 * @param {string} tenantId
 * @param {string} [product] expected product; the tenant's own product_code when omitted
 */
async function auditTenantCatalog(knex, tenantId, product) {
  return summarizePlan(await compareTenantCatalog(knex, tenantId, product));
}

/**
 * Audit every tenant in a stable order, or the explicitly supplied subset.
 *
 * @param {import('knex').Knex} knex
 * @param {{ tenantIds?: string[], product?: string }} [options]
 */
async function auditPermissionCatalog(knex, options = {}) {
  let tenantIds = options.tenantIds;
  if (!tenantIds) {
    const query = knex('tenants').orderBy('tenant').select('tenant');
    if (options.product) query.where({ product_code: options.product });
    tenantIds = (await query).map((row) => row.tenant);
  }

  const tenants = [];
  const failures = [];
  for (const tenantId of tenantIds) {
    try {
      tenants.push(await auditTenantCatalog(knex, tenantId, options.product));
    } catch (error) {
      failures.push({ tenantId, error: error.message });
    }
  }

  return {
    catalogVersion: catalogVersion(),
    generatedAt: new Date().toISOString(),
    tenantCount: tenantIds.length,
    tenants,
    failures,
    totals: {
      tenantsMissingPermissions: tenants.filter((tenant) => tenant.missingPermissions.length > 0).length,
      tenantsMissingGrants: tenants.filter((tenant) => tenant.missingGrants.length > 0).length,
      tenantsWithUnresolvedRoles: tenants.filter((tenant) => tenant.unresolvedRoles.length > 0).length,
      tenantsWithDuplicateIdentities: tenants.filter((tenant) => tenant.duplicateIdentities.length > 0).length,
    },
  };
}

module.exports = {
  auditPermissionCatalog,
  auditTenantCatalog,
  summarizePlan,
};
