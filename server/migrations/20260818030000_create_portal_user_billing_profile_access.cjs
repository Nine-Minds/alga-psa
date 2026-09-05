'use strict';

/**
 * Billing profiles — portal segment access control (F123–F127, slice S12).
 *
 * A portal user may be restricted to a subset of their client's billing
 * profiles: a site manager sees only their own site, the owner sees all.
 *
 * The default is deliberately **no rows = all profiles**, not a row per profile.
 * Two reasons, both load-bearing:
 *
 *   1. Phase-1 behaviour is preserved without a backfill. Every existing portal
 *      user keeps seeing everything unless an MSP deliberately restricts them,
 *      which is what the plan requires.
 *   2. A profile added later is visible to unrestricted users automatically. If
 *      absence meant "no access", every new profile would silently disappear
 *      from every portal user until someone remembered to grant it — a failure
 *      mode that looks like missing data, not like a permission.
 *
 * Restriction is enforced in the portal queries themselves rather than only in
 * the UI (F127): a client that only filters in the browser is not filtered.
 */

const TABLE = 'client_portal_user_billing_profiles';

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
      table.uuid('user_id').notNullable();
      table.uuid('billing_profile_id').notNullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.uuid('created_by').nullable();
      table.primary(['tenant', 'user_id', 'billing_profile_id']);
    });
  }

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_${TABLE}_user
    ON ${TABLE} (tenant, user_id)
  `);

  const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
  await ensureTenantDistribution(knex, TABLE);

  await addForeignKey(knex, TABLE, `${TABLE}_tenant_foreign`,
    'FOREIGN KEY (tenant) REFERENCES tenants(tenant)');
  await addForeignKey(knex, TABLE, `${TABLE}_billing_profile_foreign`,
    'FOREIGN KEY (tenant, billing_profile_id) REFERENCES client_billing_profiles (tenant, billing_profile_id) ON DELETE CASCADE');
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists(TABLE);
};

// create_distributed_table cannot run inside a transaction on Citus.
exports.config = { transaction: false };
