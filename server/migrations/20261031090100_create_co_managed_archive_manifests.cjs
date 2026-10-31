/**
 * Co-managed IT L7a: sealed archive manifests (new table only).
 *
 * One manifest per closed relationship, written once in the closure transaction and never
 * updated (enforced in app code; Citus skips triggers). The manifest lists what the MSP
 * archive holds (participation evidence only) and the exclusions, by evidence class.
 * Idempotent.
 */
const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

const TABLE = 'co_managed_archive_manifests';

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) {
    await knex.schema.createTable(TABLE, (table) => {
      table.uuid('tenant').notNullable(); // Sponsoring MSP.
      table.uuid('operation_id').notNullable();
      table.uuid('customer_tenant').notNullable();
      table.uuid('relationship_id').notNullable();
      table.timestamp('cutoff_at', { useTz: true }).notNullable();
      table.timestamp('sealed_at', { useTz: true }).notNullable();
      table.jsonb('manifest').notNullable();
      table.text('content_hash').notNullable();
      table.primary(['tenant', 'operation_id']);
      table.unique(['tenant', 'relationship_id'], { indexName: 'co_archive_manifest_once' });
      table.check('tenant <> customer_tenant AND cutoff_at <= sealed_at');
      table.check("jsonb_typeof(manifest) = 'object' AND content_hash ~ '^[0-9a-f]{64}$'");
    });
  }
  await ensureTenantDistribution(knex, TABLE);
};

exports.down = async function down(knex) {
  if ((await knex.schema.hasTable(TABLE)) && (await knex(TABLE).first())) {
    throw new Error('Cannot remove retained archive manifests');
  }
  await knex.schema.dropTableIfExists(TABLE);
};

exports.config = { transaction: false };
