const MIGRATION_TENANT = 'migration:20260719103000_seed_marketing_interaction_types';
const TENANT_ENUMERATION_REASON = 'enumerate tenants for marketing interaction type seed';

// Tenant-scoped interaction types for the marketing engagement log. Code
// resolves these per tenant by type_name (see marketingInteractionTypes.ts).
const INTERACTION_TYPES = [
  { type_name: 'Marketing: Post Published', icon: 'share-2' },
  { type_name: 'Marketing: Email Sent', icon: 'mail' },
  { type_name: 'Marketing: Email Opened', icon: 'mail-open' },
  { type_name: 'Marketing: Email Clicked', icon: 'mouse-pointer-click' },
  { type_name: 'Marketing: Form Submitted', icon: 'clipboard-list' },
];

async function loadTenantDb() {
  return require('./utils/tenantDb.cjs').tenantDb;
}

exports.up = async function up(knex) {
  const tenantDb = await loadTenantDb();
  const migrationDb = tenantDb(knex, MIGRATION_TENANT);
  const tenants = await migrationDb.unscoped('tenants', TENANT_ENUMERATION_REASON).select('tenant');

  for (const { tenant } of tenants) {
    const db = tenantDb(knex, tenant);

    for (const definition of INTERACTION_TYPES) {
      const existing = await db.table('interaction_types')
        .where({ tenant, type_name: definition.type_name })
        .first('type_id');

      if (!existing) {
        await db.table('interaction_types').insert({
          tenant,
          type_name: definition.type_name,
          icon: definition.icon,
        });
      }
    }
  }
};

exports.down = async function down(knex) {
  const tenantDb = await loadTenantDb();
  const migrationDb = tenantDb(knex, MIGRATION_TENANT);
  const tenants = await migrationDb.unscoped('tenants', TENANT_ENUMERATION_REASON).select('tenant');

  for (const { tenant } of tenants) {
    const db = tenantDb(knex, tenant);
    await db.table('interaction_types')
      .where({ tenant })
      .whereIn('type_name', INTERACTION_TYPES.map(({ type_name }) => type_name))
      .del();
  }
};
