/**
 * Seeds the "VIP" contact and client tag definitions, each with an internal display rule, for a
 * newly created tenant (F062). Mirrors the existing-tenant seeding in
 * server/migrations/20261024120000_create_tag_display_rules.cjs, which only covers definitions that
 * already exist: tenants created after that migration would otherwise have no VIP chip until an
 * admin set it up. Invoked by the tenant-creation workflow via runOnboardingSeeds, which calls
 * exports.seed(trx, tenantId). Idempotent.
 */

const VIP_TAG_TEXT = 'VIP';
const VIP_BACKGROUND = '#FEF3C7';
const VIP_TEXT_COLOR = '#92400E';
const VIP_TAGGED_TYPES = ['contact', 'client'];

exports.seed = async function (knex, tenantId) {
  const { tenantDb } = await import('@alga-psa/db');

  if (!tenantId) {
    const tenant = await knex('tenants').select('tenant').first();
    if (!tenant) {
      console.log('No tenant found, skipping VIP tag seed');
      return;
    }
    tenantId = tenant.tenant;
  }

  const db = tenantDb(knex, tenantId);

  for (const taggedType of VIP_TAGGED_TYPES) {
    await db.table('tag_definitions')
      .insert({
        tenant: tenantId,
        tag_text: VIP_TAG_TEXT,
        tagged_type: taggedType,
        background_color: VIP_BACKGROUND,
        text_color: VIP_TEXT_COLOR,
      })
      .onConflict(['tenant', 'tag_text', 'tagged_type'])
      .ignore();

    const definition = await db.table('tag_definitions')
      .where({ tag_text: VIP_TAG_TEXT, tagged_type: taggedType })
      .first('tag_id');

    await db.table('tag_display_rules')
      .insert({
        tenant: tenantId,
        tagged_type: taggedType,
        audience: 'internal',
        tag_id: definition.tag_id,
        position: 0,
      })
      .onConflict(['tenant', 'tagged_type', 'audience', 'tag_id'])
      .ignore();
  }

  console.log(`Seeded VIP contact and client tags with internal display rules for tenant ${tenantId}`);
};

exports.VIP_TAG_TEXT = VIP_TAG_TEXT;
