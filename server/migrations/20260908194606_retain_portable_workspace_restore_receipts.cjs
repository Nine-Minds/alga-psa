const { ensureTenantDistribution, supportsTriggers } = require('./utils/citusDistribution.cjs');
const TABLE = 'portable_workspace_restores';
exports.up = async knex => {
  if (!await knex.schema.hasTable(TABLE)) await knex.schema.createTable(TABLE, table => {
    table.uuid('tenant').primary();
    table.uuid('source_tenant').notNullable();
    table.uuid('package_id').notNullable();
    table.text('archive_sha256').notNullable();
    table.uuid('source_administrator_user_id').notNullable();
    table.uuid('administrator_user_id').notNullable();
    table.timestamp('restored_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.check("tenant <> source_tenant AND archive_sha256 ~ '^[0-9a-f]{64}$'");
  });
  await ensureTenantDistribution(knex, TABLE);
  if (!await knex('pg_constraint').where('conname', 'portable_workspace_restore_owner_fk').whereRaw('conrelid = ?::regclass', [TABLE]).first()) {
    await knex.schema.alterTable(TABLE, table => table.foreign(['tenant'], 'portable_workspace_restore_owner_fk').references(['tenant']).inTable('tenants'));
  }
  await knex.raw(`CREATE OR REPLACE FUNCTION portable_workspace_restore_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'Portable restore receipt is immutable' USING ERRCODE = '23514'; END; $$`);
  if (await supportsTriggers(knex, TABLE)) {
    await knex.raw(`DROP TRIGGER IF EXISTS portable_workspace_restore_immutable ON ${TABLE}`);
    await knex.raw(`CREATE TRIGGER portable_workspace_restore_immutable BEFORE UPDATE ON ${TABLE} FOR EACH ROW EXECUTE FUNCTION portable_workspace_restore_immutable()`);
  }
};
exports.down = async knex => {
  if (await knex.schema.hasTable(TABLE) && await knex(TABLE).first()) throw new Error('Cannot remove retained portable restore ownership');
  await knex.schema.dropTableIfExists(TABLE);
  await knex.raw('DROP FUNCTION IF EXISTS portable_workspace_restore_immutable()');
};
exports.config = { transaction: false };
