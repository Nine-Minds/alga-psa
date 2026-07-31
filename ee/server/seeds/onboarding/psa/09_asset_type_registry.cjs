/**
 * Seeds the six built-in asset types for a newly created tenant.
 *
 * Mirrors the existing-tenant seeding in
 * server/migrations/20260612120000_create_asset_type_registry.cjs — both
 * paths are mandatory (standard_statuses lesson: tenant-loop migrations skip
 * tenants created after they run). Invoked by the tenant-creation Temporal
 * workflow via runOnboardingSeeds (ee/temporal-workflows/src/db/
 * onboarding-seeds-operations.ts), which calls exports.seed(trx, tenantId).
 */

const BUILTIN_ASSET_TYPES = [
  { slug: 'workstation', name: 'Workstation', display_order: 0 },
  { slug: 'network_device', name: 'Network Device', display_order: 1 },
  { slug: 'server', name: 'Server', display_order: 2 },
  { slug: 'mobile_device', name: 'Mobile Device', display_order: 3 },
  { slug: 'printer', name: 'Printer', display_order: 4 },
  { slug: 'unknown', name: 'Unknown', display_order: 5 },
];

exports.seed = async function (knex, tenantId) {
  const { tenantDb } = await import('@alga-psa/db');

  // Use provided tenantId or fall back to first tenant
  if (!tenantId) {
    const tenant = await knex('tenants').select('tenant').first();
    if (!tenant) {
      console.log('No tenant found, skipping asset type registry seed');
      return;
    }
    tenantId = tenant.tenant;
  }

  const db = tenantDb(knex, tenantId);

  await db.table('asset_type_registry')
    .insert(BUILTIN_ASSET_TYPES.map((type) => ({
      tenant: tenantId,
      slug: type.slug,
      name: type.name,
      fields_schema: JSON.stringify([]),
      is_builtin: true,
      display_order: type.display_order,
    })))
    .onConflict(['tenant', 'slug'])
    .ignore();

  console.log(`Seeded built-in asset types for tenant ${tenantId}`);
};
