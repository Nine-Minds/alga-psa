/**
 * The one tenant loop. Every caller that provisions permissions — the
 * reconciliation migrations, the developer seeds, the onboarding seeds — runs
 * this instead of writing its own.
 *
 * The two callers want opposite failure behaviour, so strictness is explicit:
 *
 *   - `onDrift: 'skip'` (the default, for migrations) makes this loop incapable
 *     of failing the migration chain. A migration runs against every database
 *     this product has ever produced; their roles and product codes are not
 *     uniform, and a deployment must not stop because one tenant drifted years
 *     ago — see the standard_statuses global-migration incident. A tenant whose
 *     shape blocks reconciliation (missing tenants row, missing/unknown
 *     product_code, missing or duplicated default role) is reported and SKIPPED
 *     with nothing written for it, and an unexpected per-tenant error is
 *     reported and counted rather than rethrown.
 *
 *   - `onDrift: 'throw'` (for seeds and the integration suite) fails loudly.
 *     A silently under-permissioned tenant coming out of onboarding is exactly
 *     the failure this catalog exists to prevent, and the caller owns the
 *     tenant it just created, so drift there is a bug, not history.
 *
 * The gate for the skip path is the read-only audit
 * (./auditPermissionCatalog.cjs), run out-of-band before and after a deploy: it
 * reports the same drift through the same comparison core and is free to fail.
 */

const { catalogVersion } = require('./catalog.cjs');
const {
  applyDefaultRoleGrants,
  listTenantsForProduct,
  syncPermissionCatalog,
} = require('./syncPermissionCatalog.cjs');

const TENANT_ENUMERATION_REASON = 'enumerate tenants for permission catalog reconciliation';

// `catalog` provisions permissions and their default-role grants; `grants` adds
// the grants only, for the role-permission seeds that run after their sibling.
const APPLY = { catalog: syncPermissionCatalog, grants: applyDefaultRoleGrants };

async function enumerateTenants(knex, product, tenantId) {
  // Temporal always passes the tenant it just created.
  if (tenantId) return [{ tenant: tenantId, product_code: product ?? null }];
  // A product-scoped seed replaying without a tenant id must not reach tenants
  // of the other product.
  if (product) {
    const tenants = await listTenantsForProduct(knex, product);
    return tenants.map((tenant) => ({ tenant, product_code: product }));
  }
  return knex('tenants').orderBy('tenant').select('tenant', 'product_code');
}

/**
 * Reconcile tenants to the catalog minimum state, one transaction each.
 *
 * @param {import('knex').Knex} knex knex instance, or an open transaction the
 *   per-tenant work joins (the onboarding seeds run inside one)
 * @param {{
 *   label: string,
 *   apply?: 'catalog'|'grants',
 *   product?: string,
 *   tenantId?: string,
 *   onDrift?: 'skip'|'throw',
 *   logger?: { log: Function, warn: Function, error: Function },
 * }} options
 * @returns {Promise<{ total: number, reconciled: object[], skipped: object[], failed: object[] }>}
 */
async function reconcileAllTenants(knex, {
  label,
  apply = 'catalog',
  product,
  tenantId,
  onDrift = 'skip',
  logger = console,
} = {}) {
  const reconcileTenant = APPLY[apply];
  if (!reconcileTenant) {
    throw new Error(`Unknown catalog apply mode "${apply}"; expected ${Object.keys(APPLY).join(' or ')}`);
  }
  const strict = onDrift === 'throw';

  const tenants = await enumerateTenants(knex, product, tenantId);
  const version = catalogVersion();
  logger.log(`[${label}] catalog ${version}: ${tenants.length} tenants (${TENANT_ENUMERATION_REASON})`);

  const summary = { total: tenants.length, reconciled: [], skipped: [], failed: [] };
  let index = 0;

  for (const { tenant, product_code: productCode } of tenants) {
    index += 1;
    try {
      // syncPermissionCatalog opens the per-tenant transaction itself, and
      // joins the caller's when there already is one.
      const result = await reconcileTenant(knex, tenant, product ?? productCode, { onDrift });

      if (result.skipped) {
        summary.skipped.push({ tenant, reasons: result.reasons });
        logger.warn(
          `[${label}] ${index}/${tenants.length} tenant ${tenant} SKIPPED (left untouched):\n  - `
          + result.reasons.join('\n  - '),
        );
        continue;
      }

      const grants = result.insertedGrants.reduce((total, grant) => total + grant.count, 0);
      summary.reconciled.push({
        tenant,
        product: result.product,
        permissions: result.insertedPermissions.length,
        descriptions: result.updatedDescriptions.length,
        grants,
      });
      logger.log(
        `[${label}] ${index}/${tenants.length} tenant ${tenant} (${result.product}): `
        + (apply === 'grants'
          ? `+${grants} default-role grants`
          : `+${result.insertedPermissions.length} permissions, ~${result.updatedDescriptions.length} descriptions, `
            + `+${grants} grants, ${result.preservedUnknownPermissions} unknown permissions and `
            + `${result.preservedExtraGrants} extra grants preserved`),
      );
    } catch (error) {
      if (strict) throw error;
      summary.failed.push({ tenant, message: error.message });
      logger.error(
        `[${label}] ${index}/${tenants.length} tenant ${tenant} FAILED (left untouched): ${error.message}`,
      );
    }
  }

  logger.log(
    `[${label}] complete at catalog ${version}: ${summary.reconciled.length} reconciled, `
    + `${summary.skipped.length} skipped, ${summary.failed.length} failed of ${summary.total} tenants. `
    + 'Skipped and failed tenants keep their existing permissions; reconcile them with the read-only audit '
    + '(server/migrations/utils/permissions/auditPermissionCatalog.cjs) and the onboarding recovery.',
  );

  return summary;
}

module.exports = { reconcileAllTenants };
