const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
const TABLE = 'co_managed_independent_upgrades';
exports.up = async knex => {
  if (!await knex.schema.hasTable(TABLE)) await knex.schema.createTable(TABLE, table => {
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
  await ensureTenantDistribution(knex, TABLE);
  if (!await knex('pg_constraint').where('conname', 'co_independent_upgrade_owner_fk').whereRaw('conrelid = ?::regclass', [TABLE]).first())
    await knex.schema.alterTable(TABLE, table => table.foreign(['tenant'], 'co_independent_upgrade_owner_fk').references(['tenant']).inTable('tenants'));
  await knex.raw(`CREATE OR REPLACE FUNCTION co_managed_independent_upgrade_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'Independent upgrade receipt is immutable' USING ERRCODE = '23514'; END; $$`);
  await knex.raw(`DROP TRIGGER IF EXISTS co_managed_independent_upgrade_immutable ON ${TABLE}`);
  await knex.raw(`CREATE TRIGGER co_managed_independent_upgrade_immutable BEFORE UPDATE ON ${TABLE} FOR EACH ROW EXECUTE FUNCTION co_managed_independent_upgrade_immutable()`);
};
exports.down = async knex => {
  if (await knex.schema.hasTable(TABLE) && await knex(TABLE).first()) throw new Error('Cannot remove independent upgrade receipts');
  await knex.schema.dropTableIfExists(TABLE);
  await knex.raw('DROP FUNCTION IF EXISTS co_managed_independent_upgrade_immutable()');
};
exports.config = { transaction: false };
