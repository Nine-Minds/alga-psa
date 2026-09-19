const { ensureTenantDistribution, supportsTriggers } = require('./utils/citusDistribution.cjs');
const TABLE = 'portable_workspace_activations';
exports.up = async knex => {
  if (!await knex.schema.hasTable(TABLE)) await knex.schema.createTable(TABLE, table => {
    table.uuid('tenant').primary();
    table.uuid('operation_id').notNullable();
    table.uuid('administrator_user_id').notNullable();
    table.text('entitlement_source').notNullable();
    table.text('entitlement_reference').notNullable();
    table.integer('seats');
    table.timestamp('entitlement_valid_until', { useTz: true }).notNullable();
    table.timestamp('activated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.check("entitlement_source IN ('tenant_license', 'hosted_subscription') AND (seats IS NULL OR seats > 0) AND length(entitlement_reference) > 0 AND entitlement_valid_until > activated_at");
  });
  await ensureTenantDistribution(knex, TABLE);
  if (!await knex('pg_constraint').where('conname', 'portable_workspace_activation_restore_fk').whereRaw('conrelid = ?::regclass', [TABLE]).first()) {
    await knex.schema.alterTable(TABLE, table => table.foreign(['tenant'], 'portable_workspace_activation_restore_fk').references(['tenant']).inTable('portable_workspace_restores'));
  }
  await knex.raw(`CREATE OR REPLACE FUNCTION portable_workspace_activation_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'Portable activation receipt is immutable' USING ERRCODE = '23514'; END; $$`);
  if (await supportsTriggers(knex, TABLE)) {
    await knex.raw(`DROP TRIGGER IF EXISTS portable_workspace_activation_immutable ON ${TABLE}`);
    await knex.raw(`CREATE TRIGGER portable_workspace_activation_immutable BEFORE UPDATE ON ${TABLE} FOR EACH ROW EXECUTE FUNCTION portable_workspace_activation_immutable()`);
  }
};
exports.down = async knex => {
  if (await knex.schema.hasTable(TABLE) && await knex(TABLE).first()) throw new Error('Cannot remove retained portable activation receipts');
  await knex.schema.dropTableIfExists(TABLE);
  await knex.raw('DROP FUNCTION IF EXISTS portable_workspace_activation_immutable()');
};
exports.config = { transaction: false };
