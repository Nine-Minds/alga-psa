/**
 * Seeds the six builtin asset statuses for a newly created tenant (FR-B2).
 *
 * Mirrors the existing-tenant seeding in
 * server/migrations/20261009121000_create_asset_statuses.cjs — both paths are
 * mandatory (standard_statuses lesson: tenant-loop migrations skip tenants
 * created after they run). Invoked by the tenant-creation Temporal workflow
 * via runOnboardingSeeds (ee/temporal-workflows/src/db/
 * onboarding-seeds-operations.ts), which calls exports.seed(trx, tenantId).
 */

const BUILTIN_ASSET_STATUSES = [
  { slug: 'active', label: 'Active', kind: 'deployable', display_order: 0 },
  { slug: 'in_stock', label: 'In stock', kind: 'deployable', display_order: 1 },
  { slug: 'maintenance', label: 'In maintenance', kind: 'pending', display_order: 2 },
  { slug: 'inactive', label: 'Inactive', kind: 'undeployable', display_order: 3 },
  { slug: 'retired', label: 'Retired', kind: 'archived', display_order: 4 },
  { slug: 'held_by_msp', label: 'Held by MSP', kind: 'pending', display_order: 5 },
];

exports.seed = async function (knex, tenantId) {
  const { tenantDb } = await import('@alga-psa/db');

  if (!tenantId) {
    const tenant = await knex('tenants').select('tenant').first();
    if (!tenant) {
      console.log('No tenant found, skipping asset statuses seed');
      return;
    }
    tenantId = tenant.tenant;
  }

  const db = tenantDb(knex, tenantId);

  await db.table('asset_statuses')
    .insert(BUILTIN_ASSET_STATUSES.map((status) => ({
      tenant: tenantId,
      slug: status.slug,
      label: status.label,
      kind: status.kind,
      is_builtin: true,
      is_active: true,
      display_order: status.display_order,
    })))
    .onConflict(['tenant', 'slug'])
    .ignore();

  console.log(`Seeded builtin asset statuses for tenant ${tenantId}`);
};

exports.BUILTIN_ASSET_STATUSES = BUILTIN_ASSET_STATUSES;
