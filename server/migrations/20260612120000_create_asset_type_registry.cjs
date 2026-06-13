/**
 * Custom Asset Types: tenant-scoped asset_type_registry (2026-06-12)
 *
 * Reintroduces a per-tenant registry of asset types (the original 2024
 * asset_types table was dropped). Built-ins mirror the six hardcoded
 * assets.asset_type slugs; custom types carry a fields_schema jsonb that
 * drives schema-rendered forms. assets.asset_type keeps holding the slug
 * (no FK), per ee/docs/plans/2026-06-12-custom-asset-types/PRD.md.
 *
 * Greenfield-Citus pattern (asset_facts template): tenant uuid column first,
 * distribute inline behind a Citus guard, transaction:false. Seeds the six
 * built-ins for every EXISTING tenant; FUTURE tenants are covered by the
 * onboarding seed ee/server/seeds/onboarding/psa/09_asset_type_registry.cjs
 * (standard_statuses lesson: tenant-loop migrations skip tenants created
 * later).
 *
 * No RLS: tenant isolation is enforced at the app layer (scoped queries +
 * Citus tenant distribution). 20260509120000_disable_remaining_rls_policies
 * dropped every policy and disabled RLS schema-wide because pooled app
 * connections never set app.current_tenant; new tenant tables follow that
 * architecture (precedent: asset_facts and the EE integration tables).
 */

const BUILTIN_ASSET_TYPES = [
  { slug: 'workstation', name: 'Workstation', display_order: 0 },
  { slug: 'network_device', name: 'Network Device', display_order: 1 },
  { slug: 'server', name: 'Server', display_order: 2 },
  { slug: 'mobile_device', name: 'Mobile Device', display_order: 3 },
  { slug: 'printer', name: 'Printer', display_order: 4 },
  { slug: 'unknown', name: 'Unknown', display_order: 5 },
];

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  // The registry is now the source of truth for valid asset_type slugs, so drop
  // the legacy hardcoded CHECK (20241117200000_remove_asset_types_table) that
  // only allowed the six built-ins and rejects every custom type.
  await knex.raw('ALTER TABLE assets DROP CONSTRAINT IF EXISTS valid_asset_type');

  if (!(await knex.schema.hasTable('asset_type_registry'))) {
    await knex.schema.createTable('asset_type_registry', (table) => {
      table.uuid('tenant').notNullable().references('tenant').inTable('tenants');
      table.uuid('type_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.text('slug').notNullable();
      table.text('name').notNullable();
      table.text('icon').nullable();
      table.jsonb('fields_schema').notNullable().defaultTo(knex.raw(`'[]'::jsonb`));
      table.boolean('is_builtin').notNullable().defaultTo(false);
      table.integer('display_order').notNullable().defaultTo(0);
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'type_id']);
      table.unique(['tenant', 'slug'], 'asset_type_registry_tenant_slug_uk');
    });
  }

  const citusEnabled = await knex.raw(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_extension
      WHERE extname = 'citus'
    ) AS enabled;
  `);

  if (citusEnabled.rows?.[0]?.enabled) {
    const alreadyDistributed = await knex.raw(`
      SELECT EXISTS (
        SELECT 1
        FROM pg_dist_partition
        WHERE logicalrelid = 'asset_type_registry'::regclass
      ) AS is_distributed;
    `);

    if (!alreadyDistributed.rows?.[0]?.is_distributed) {
      await knex.raw("SELECT create_distributed_table('asset_type_registry', 'tenant', colocate_with => 'assets')");
    }

    // Required follow-up whenever the table could already hold rows at
    // distribution time (idempotent re-runs): clear stranded coordinator-heap
    // rows. No-op when the parent heap is already empty.
    const localSize = await knex.raw("SELECT pg_relation_size('asset_type_registry'::regclass) AS size");
    if (Number(localSize.rows?.[0]?.size ?? 0) > 0) {
      await knex.raw("SELECT truncate_local_data_after_distributing_table('asset_type_registry'::regclass)");
    }
  } else {
    console.warn('[create_asset_type_registry] Skipping create_distributed_table (Citus extension unavailable)');
  }

  // Seed the six built-ins for every EXISTING tenant. Future tenants are
  // seeded by the onboarding path (see file header).
  const tenants = await knex('tenants').select('tenant');
  for (const { tenant } of tenants) {
    await knex('asset_type_registry')
      .insert(BUILTIN_ASSET_TYPES.map((type) => ({
        tenant,
        slug: type.slug,
        name: type.name,
        fields_schema: JSON.stringify([]),
        is_builtin: true,
        display_order: type.display_order,
      })))
      .onConflict(['tenant', 'slug'])
      .ignore();
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('asset_type_registry');
};

// create_distributed_table cannot run inside a transaction block.
exports.config = { transaction: false };
