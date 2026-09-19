const { ensureTenantDistribution, supportsTriggers } = require('./utils/citusDistribution.cjs');
const TABLE = 'co_managed_archive_manifests';
exports.up = async knex => {
  if (!await knex.schema.hasTable(TABLE)) await knex.schema.createTable(TABLE, table => {
    table.uuid('tenant').notNullable();
    table.uuid('operation_id').notNullable();
    table.uuid('customer_tenant').notNullable();
    table.uuid('relationship_id').notNullable();
    table.timestamp('cutoff_at', { useTz: true }).notNullable();
    table.timestamp('sealed_at', { useTz: true }).notNullable();
    table.jsonb('manifest').notNullable();
    table.text('content_hash').notNullable();
    table.primary(['tenant', 'operation_id']);
    table.unique(['tenant', 'customer_tenant', 'relationship_id']);
    table.check('tenant <> customer_tenant AND cutoff_at <= sealed_at');
    table.check("jsonb_typeof(manifest) = 'object' AND content_hash ~ '^[0-9a-f]{64}$'");
  });
  await ensureTenantDistribution(knex, TABLE);
  if (!await knex('pg_constraint').where('conname', 'co_archive_manifest_owner_fk').whereRaw('conrelid = ?::regclass', [TABLE]).first())
    await knex.schema.alterTable(TABLE, table => table.foreign(['tenant'], 'co_archive_manifest_owner_fk').references(['tenant']).inTable('tenants'));
  await knex.raw(`CREATE OR REPLACE FUNCTION co_managed_archive_manifest_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'Retained archive manifest is immutable' USING ERRCODE = '23514'; END; $$`);
  if (await supportsTriggers(knex, TABLE)) {
    await knex.raw(`DROP TRIGGER IF EXISTS co_managed_archive_manifest_immutable ON ${TABLE}`);
    await knex.raw(`CREATE TRIGGER co_managed_archive_manifest_immutable BEFORE UPDATE ON ${TABLE} FOR EACH ROW EXECUTE FUNCTION co_managed_archive_manifest_immutable()`);
  }
};
exports.down = async knex => {
  if (await knex.schema.hasTable(TABLE) && await knex(TABLE).first()) throw new Error('Cannot remove retained archive manifests');
  await knex.schema.dropTableIfExists(TABLE);
  await knex.raw('DROP FUNCTION IF EXISTS co_managed_archive_manifest_immutable()');
};
exports.config = { transaction: false };
