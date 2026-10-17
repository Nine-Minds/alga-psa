/**
 * Asset status registry (FR-B1 / FR-B2).
 *
 * `assets.status` was free text with three hardcoded options that RMM sync
 * overwrote on every run. It now holds the slug of a tenant-managed
 * `asset_statuses` row carrying a lifecycle `kind`
 * (deployable | pending | undeployable | archived), the same slug-plus-registry
 * shape `asset_type` already uses with `asset_type_registry` — no FK, so Citus
 * stays simple.
 *
 * Seeds the five builtins for every EXISTING tenant and inserts any other
 * distinct `assets.status` value as a custom `undeployable` status so nothing
 * is lost. FUTURE tenants are covered by the onboarding seed
 * ee/server/seeds/onboarding/psa/11_asset_statuses.cjs (standard_statuses
 * lesson: tenant-loop migrations skip tenants created later).
 *
 * No RLS: tenant isolation is app-layer (scoped queries + Citus distribution),
 * per 20260509120000_disable_remaining_rls_policies.
 */

const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

const BUILTIN_ASSET_STATUSES = [
  { slug: 'active', label: 'Active', kind: 'deployable', display_order: 0 },
  { slug: 'in_stock', label: 'In stock', kind: 'deployable', display_order: 1 },
  { slug: 'maintenance', label: 'In maintenance', kind: 'pending', display_order: 2 },
  { slug: 'inactive', label: 'Inactive', kind: 'undeployable', display_order: 3 },
  { slug: 'retired', label: 'Retired', kind: 'archived', display_order: 4 },
];

const BUILTIN_SLUGS = BUILTIN_ASSET_STATUSES.map((status) => status.slug);

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('asset_statuses'))) {
    await knex.schema.createTable('asset_statuses', (table) => {
      table.uuid('tenant').notNullable().references('tenant').inTable('tenants');
      table.uuid('status_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.text('slug').notNullable();
      table.text('label').notNullable();
      table.text('kind').notNullable().defaultTo('deployable');
      table.boolean('is_builtin').notNullable().defaultTo(false);
      table.boolean('is_active').notNullable().defaultTo(true);
      table.integer('display_order').notNullable().defaultTo(0);
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'status_id']);
      table.unique(['tenant', 'slug'], 'asset_statuses_tenant_slug_uk');
    });

    await knex.raw(`
      ALTER TABLE asset_statuses
      ADD CONSTRAINT asset_statuses_kind_check
      CHECK (kind IN ('deployable', 'pending', 'undeployable', 'archived'))
    `);
  }

  await ensureTenantDistribution(knex, 'asset_statuses');

  const tenants = await knex('tenants').select('tenant');
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

    // Anything an MSP already typed into assets.status survives as a custom
    // status so no device loses its lifecycle state on this migration.
    //
    // Compared case- and whitespace-insensitively: a legacy " Active" would
    // otherwise come through as a second, undeployable "Active" sitting
    // alongside the builtin. Such rows are normalized onto the builtin slug
    // instead, which is what they always meant.
    const stored = await knex('assets')
      .where({ tenant })
      .whereNotNull('status')
      .whereNot('status', '')
      .distinct('status')
      .pluck('status');

    const custom = [];
    for (const value of stored) {
      const normalized = String(value).trim().toLowerCase();
      const builtin = BUILTIN_SLUGS.find((slug) => slug === normalized);
      if (builtin) {
        if (value !== builtin) {
          await knex('assets').where({ tenant, status: value }).update({ status: builtin });
        }
        continue;
      }
      custom.push(value);
    }

    if (custom.length === 0) continue;

    await knex('asset_statuses')
      .insert(custom.map((slug, index) => ({
        tenant,
        slug,
        // Best effort label from the slug: "in_repair" -> "In repair".
        label: String(slug).replace(/[_-]+/g, ' ').replace(/^./, (char) => char.toUpperCase()),
        kind: 'undeployable',
        is_builtin: false,
        is_active: true,
        display_order: BUILTIN_ASSET_STATUSES.length + index,
      })))
      .onConflict(['tenant', 'slug'])
      .ignore();
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('asset_statuses');
};

exports.BUILTIN_ASSET_STATUSES = BUILTIN_ASSET_STATUSES;

// create_distributed_table cannot run inside a transaction block.
exports.config = { transaction: false };
