/**
 * Independent-upgrade receipts (CM L8b).
 *
 * One immutable row per completed customer upgrade from co-managed to a plain PSA tenant. The row
 * is the idempotency record: the same `operation_id` returns it without re-closing the relationship,
 * re-releasing the MSP's allocation or contacting the payment provider. Owned by the CUSTOMER tenant.
 *
 * CREATE only; idempotent; distributed on `tenant`. The update-immutability trigger is defence in
 * depth on this NEW table only (H section 3 rule 6); the same invariant is enforced and tested in
 * `packages/co-managed/src/independentUpgrade.ts` because Citus skips triggers on distributed tables.
 */
const { ensureTenantDistribution, supportsTriggers } = require('./utils/citusDistribution.cjs');

const TABLE = 'co_managed_independent_upgrades';
const FK = 'co_independent_upgrade_owner_fk';

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) {
    await knex.schema.createTable(TABLE, (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('operation_id').notNullable();
      table.uuid('relationship_id').notNullable();
      table.uuid('sponsor_tenant').notNullable();
      table.uuid('closure_operation_id').notNullable();
      table.uuid('actor_user_id').notNullable();
      table.text('request_fingerprint').notNullable();
      table.text('entitlement_source').notNullable();
      table.text('entitlement_reference').notNullable();
      table.integer('seats').nullable();
      table.timestamp('entitlement_valid_until', { useTz: true }).notNullable();
      table.timestamp('upgraded_at', { useTz: true }).notNullable();
      table.primary(['tenant', 'operation_id']);
      table.unique(['tenant', 'relationship_id']);
      table.check("tenant <> sponsor_tenant AND request_fingerprint ~ '^[0-9a-f]{64}$'");
      table.check("entitlement_source IN ('tenant_license', 'stripe') AND length(entitlement_reference) > 0");
      table.check('seats IS NULL OR seats >= 1');
      table.check('upgraded_at < entitlement_valid_until');
    });
  }
  await ensureTenantDistribution(knex, TABLE);
  if (!(await knex('pg_constraint').where('conname', FK).whereRaw('conrelid = ?::regclass', [TABLE]).first())) {
    await knex.schema.alterTable(TABLE, (table) => table.foreign(['tenant'], FK).references(['tenant']).inTable('tenants'));
  }
  await knex.raw(`CREATE OR REPLACE FUNCTION co_managed_independent_upgrade_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'Independent upgrade receipt is immutable' USING ERRCODE = '23514'; END; $$`);
  if (await supportsTriggers(knex, TABLE)) {
    await knex.raw(`DROP TRIGGER IF EXISTS co_managed_independent_upgrade_immutable ON ${TABLE}`);
    await knex.raw(`CREATE TRIGGER co_managed_independent_upgrade_immutable BEFORE UPDATE ON ${TABLE}
      FOR EACH ROW EXECUTE FUNCTION co_managed_independent_upgrade_immutable()`);
  }
};

exports.down = async function down(knex) {
  if ((await knex.schema.hasTable(TABLE)) && (await knex(TABLE).first())) {
    throw new Error('Cannot remove independent upgrade receipts');
  }
  await knex.schema.dropTableIfExists(TABLE);
  await knex.raw('DROP FUNCTION IF EXISTS co_managed_independent_upgrade_immutable()');
};

// Citus distribution is performed outside Knex's migration transaction.
exports.config = { transaction: false };
