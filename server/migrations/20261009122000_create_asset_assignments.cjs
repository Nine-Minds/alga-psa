/**
 * Asset assignment history (FR-C1 / FR-C4).
 *
 * `assets.contact_name_id` says who has the laptop now; it never said who had
 * it in March. `asset_assignments` keeps one row per assignment with who set
 * it, when, and from where (`source`), so the current assignee is still a
 * column but its history is a first-class record rather than something to dig
 * out of `asset_history.changes`.
 *
 * A single open row per asset is the invariant the write helper
 * (packages/assets/src/lib/assetAssignment.ts) maintains; it is not a DB
 * constraint because the backfill below and the merge path both need to insert
 * without racing a partial unique index on Citus.
 *
 * No RLS: tenant isolation is app-layer (scoped queries + Citus distribution).
 */

const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

const SOURCES = ['manual', 'api', 'rmm', 'bundle', 'import', 'merge', 'system'];

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('asset_assignments'))) {
    await knex.schema.createTable('asset_assignments', (table) => {
      table.uuid('tenant').notNullable().references('tenant').inTable('tenants');
      table.uuid('assignment_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('asset_id').notNullable();
      table.uuid('contact_name_id').notNullable();
      table.timestamp('assigned_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.uuid('assigned_by_user_id').nullable();
      table.timestamp('unassigned_at', { useTz: true }).nullable();
      table.uuid('unassigned_by_user_id').nullable();
      table.text('source').notNullable().defaultTo('manual');
      table.text('note').nullable();

      table.primary(['tenant', 'assignment_id']);
      table.index(['tenant', 'asset_id', 'unassigned_at'], 'idx_asset_assignments_asset_open');
      table.index(['tenant', 'contact_name_id', 'unassigned_at'], 'idx_asset_assignments_contact_open');
    });

    await knex.raw(`
      ALTER TABLE asset_assignments
      ADD CONSTRAINT asset_assignments_source_check
      CHECK (source IN (${SOURCES.map((source) => `'${source}'`).join(', ')}))
    `);
  }

  await ensureTenantDistribution(knex, 'asset_assignments');

  // FR-C4: one open row per asset that already carries an assignee, dated from
  // the asset's last write since that is the only timestamp we have.
  await knex.raw(`
    INSERT INTO asset_assignments (
      tenant, assignment_id, asset_id, contact_name_id, assigned_at, source
    )
    SELECT a.tenant, gen_random_uuid(), a.asset_id, a.contact_name_id,
           COALESCE(a.updated_at, a.created_at, now()), 'system'
    FROM assets a
    WHERE a.contact_name_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM asset_assignments aa
        WHERE aa.tenant = a.tenant
          AND aa.asset_id = a.asset_id
          AND aa.unassigned_at IS NULL
      )
  `);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('asset_assignments');
};

exports.ASSET_ASSIGNMENT_SOURCES = SOURCES;

// create_distributed_table cannot run inside a transaction block.
exports.config = { transaction: false };
