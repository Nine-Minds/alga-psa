/**
 * Builtin asset statuses for the dev tenant (FR-B2).
 *
 * Every asset write validates `assets.status` against this registry, so a
 * tenant without rows cannot create or edit an asset at all. The migration
 * seeds tenants that already existed and
 * ee/server/seeds/onboarding/psa/11_asset_statuses.cjs seeds new ones; the dev
 * tenant is created by these seeds AFTER migrations run, so it needs its own
 * copy (standard_statuses lesson). Runs before 63_assets.cjs so the seeded
 * devices land on slugs that exist.
 */

const BUILTIN_ASSET_STATUSES = [
  { slug: 'active', label: 'Active', kind: 'deployable', display_order: 0 },
  { slug: 'in_stock', label: 'In stock', kind: 'deployable', display_order: 1 },
  { slug: 'maintenance', label: 'In maintenance', kind: 'pending', display_order: 2 },
  { slug: 'inactive', label: 'Inactive', kind: 'undeployable', display_order: 3 },
  { slug: 'retired', label: 'Retired', kind: 'archived', display_order: 4 },
];

exports.seed = async function seed(knex) {
  const tenants = await knex('tenants').select('tenant');
  if (tenants.length === 0) {
    console.log('No tenant found, skipping asset statuses seed');
    return;
  }

  for (const { tenant } of tenants) {
    await knex('asset_statuses')
      .insert(BUILTIN_ASSET_STATUSES.map((status) => ({
        tenant,
        slug: status.slug,
        label: status.label,
        kind: status.kind,
        is_builtin: true,
        is_active: true,
        display_order: status.display_order,
      })))
      .onConflict(['tenant', 'slug'])
      .ignore();
  }
};

exports.BUILTIN_ASSET_STATUSES = BUILTIN_ASSET_STATUSES;
