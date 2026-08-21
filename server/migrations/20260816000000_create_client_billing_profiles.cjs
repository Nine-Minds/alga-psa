'use strict';

/**
 * Billing profiles — slice S1 of the billing-profiles plan
 * (docs/plans/2026-08-15-billing-profiles-sub-account-billing-plan.md).
 *
 * A billing profile is a billing dimension orthogonal to the client tree. In
 * phase 1 it is a pure reporting segment; phase 2 (S7) adds the bill-to
 * identity, tax, PO and delivery columns to this same table. Every existing
 * client gets exactly one system-managed default profile at backfill so the
 * feature is invisible (zero behavioural or UI change) while a client holds a
 * single profile (decision D6).
 *
 * Shape follows the system-managed default contract precedent
 * (20260321150000_add_system_managed_default_contract_marker.cjs):
 * `is_system_managed_default` marks backfilled rows and a per-client partial
 * unique index on `is_default` enforces exactly one default per client.
 *
 * Citus: the table is distributed on tenant, colocated with `tenants`, so the
 * backfill INSERT...SELECT from `clients` (also tenant-distributed and
 * colocated) runs per-shard. Runs outside a transaction so
 * create_distributed_table can execute.
 */

const TABLE = 'client_billing_profiles';

async function constraintExists(knex, tableName, constraintName) {
  const result = await knex.raw(
    `SELECT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = ? AND conrelid = ?::regclass
    ) AS present`,
    [constraintName, tableName]
  );
  return Boolean(result.rows?.[0]?.present);
}

async function addForeignKey(knex, tableName, constraintName, definition) {
  if (await constraintExists(knex, tableName, constraintName)) return;
  await knex.raw(`ALTER TABLE ${tableName} ADD CONSTRAINT ${constraintName} ${definition}`);
}

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) {
    await knex.schema.createTable(TABLE, (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('billing_profile_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
      table.uuid('client_id').notNullable();
      table.text('name').notNullable();
      table.boolean('is_default').notNullable().defaultTo(false);
      table.boolean('is_system_managed_default').notNullable().defaultTo(false);
      table.boolean('is_active').notNullable().defaultTo(true);
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.uuid('created_by').nullable();
      table.uuid('updated_by').nullable();
      table.primary(['tenant', 'billing_profile_id']);
    });
  }

  // Exactly one default profile per client (F002) — same partial-unique shape
  // as the default-location and system-managed-default-contract precedents.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS client_billing_profiles_default_per_client_unique
    ON ${TABLE} (tenant, client_id)
    WHERE is_default = true
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_${TABLE}_client_active
    ON ${TABLE} (tenant, client_id, is_active)
  `);

  // Distribute before any cross-table FK and before the backfill INSERT...SELECT.
  const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
  await ensureTenantDistribution(knex, TABLE);

  await addForeignKey(knex, TABLE, 'client_billing_profiles_tenant_foreign',
    'FOREIGN KEY (tenant) REFERENCES tenants(tenant)');
  await addForeignKey(knex, TABLE, 'client_billing_profiles_tenant_client_id_foreign',
    'FOREIGN KEY (tenant, client_id) REFERENCES clients(tenant, client_id)');

  // Idempotent backfill (F004, F005): exactly one system-managed default
  // profile per existing client, named from the client. Re-runs only fill the
  // gaps left by a partially-failed run.
  await knex.raw(`
    INSERT INTO ${TABLE} (
      tenant, billing_profile_id, client_id, name,
      is_default, is_system_managed_default, is_active,
      created_at, updated_at
    )
    SELECT
      c.tenant,
      gen_random_uuid(),
      c.client_id,
      c.client_name,
      true,
      true,
      true,
      now(),
      now()
    FROM clients c
    WHERE NOT EXISTS (
      SELECT 1 FROM ${TABLE} existing
      WHERE existing.tenant = c.tenant AND existing.client_id = c.client_id
    )
  `);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists(TABLE);
};

// create_distributed_table cannot run inside a transaction on Citus.
exports.config = { transaction: false };
