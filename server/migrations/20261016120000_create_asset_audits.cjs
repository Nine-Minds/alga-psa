/**
 * Site audits (mobile 2.0 FR15).
 *
 * A technician walking a client location scans each device; the audit is
 * server-backed rather than device-local so it survives a killed app and so the
 * result shows on the web through the `asset_history` rows `complete` writes
 * (change_type 'audit').
 *
 * `asset_audits` holds the run and its counts; `asset_audit_items` holds one row
 * per asset with the result (present | missing | unexpected) and how it was
 * marked (scan | manual | register). The expected set is snapshotted at start as
 * `result = 'expected'` items, so moving a device mid-audit cannot change what
 * the audit was looking for.
 *
 * Tenant in both primary keys and distributed by tenant (Citus). No RLS:
 * isolation is app-layer scoped queries, per
 * 20260509120000_disable_remaining_rls_policies.
 */

const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('asset_audits'))) {
    await knex.schema.createTable('asset_audits', (table) => {
      table.uuid('tenant').notNullable().references('tenant').inTable('tenants');
      table.uuid('audit_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('client_id').notNullable();
      table.uuid('location_id').nullable();
      table.text('status').notNullable().defaultTo('in_progress');
      table.uuid('started_by').notNullable();
      table.timestamp('started_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('completed_at', { useTz: true }).nullable();
      table.integer('expected_count').notNullable().defaultTo(0);
      table.integer('present_count').notNullable().defaultTo(0);
      table.integer('missing_count').notNullable().defaultTo(0);
      table.integer('unexpected_count').notNullable().defaultTo(0);
      table.jsonb('statuses').nullable();
      table.text('notes').nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'audit_id']);
    });

    await knex.raw(`
      ALTER TABLE asset_audits
      ADD CONSTRAINT asset_audits_status_check
      CHECK (status IN ('in_progress', 'completed', 'cancelled'))
    `);

    await knex.raw(`
      CREATE INDEX IF NOT EXISTS idx_asset_audits_tenant_started
      ON asset_audits (tenant, started_at DESC)
    `);
  }

  await ensureTenantDistribution(knex, 'asset_audits');

  if (!(await knex.schema.hasTable('asset_audit_items'))) {
    await knex.schema.createTable('asset_audit_items', (table) => {
      table.uuid('tenant').notNullable().references('tenant').inTable('tenants');
      table.uuid('audit_id').notNullable();
      table.uuid('asset_id').notNullable();
      table.text('result').notNullable();
      table.text('method').nullable();
      table.timestamp('marked_at', { useTz: true }).nullable();
      table.uuid('marked_by').nullable();

      // One row per asset per audit: marking the same device twice is an
      // upsert, not a duplicate.
      table.primary(['tenant', 'audit_id', 'asset_id']);
    });

    await knex.raw(`
      ALTER TABLE asset_audit_items
      ADD CONSTRAINT asset_audit_items_result_check
      CHECK (result IN ('expected', 'present', 'missing', 'unexpected'))
    `);

    await knex.raw(`
      ALTER TABLE asset_audit_items
      ADD CONSTRAINT asset_audit_items_method_check
      CHECK (method IS NULL OR method IN ('scan', 'manual', 'register'))
    `);
  }

  await ensureTenantDistribution(knex, 'asset_audit_items');

  if (!(await knex.schema.hasColumn('assets', 'last_audited_at'))) {
    await knex.schema.alterTable('assets', (table) => {
      table.timestamp('last_audited_at', { useTz: true }).nullable();
      table.text('last_audit_result').nullable();
    });
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('asset_audit_items');
  await knex.schema.dropTableIfExists('asset_audits');
  if (await knex.schema.hasColumn('assets', 'last_audited_at')) {
    await knex.schema.alterTable('assets', (table) => {
      table.dropColumn('last_audited_at');
      table.dropColumn('last_audit_result');
    });
  }
};

// create_distributed_table cannot run inside a transaction block.
exports.config = { transaction: false };
