/**
 * Co-managed IT L7b2: staged-byte upload attempts for portable restore (new table only).
 *
 * The journal fences byte uploads: an attempt is `uploading` until committed in the
 * same transaction as the restored records, or `abandoned` and swept by the cleanup
 * job. No foreign keys, no triggers, no backfill. Idempotent.
 */
const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

const TABLE = 'portable_workspace_restore_uploads';

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) {
    await knex.schema.createTable(TABLE, (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('attempt_id').notNullable();
      table.uuid('package_id').notNullable();
      table.text('archive_sha256').notNullable();
      table.text('provider_identity').notNullable();
      table.jsonb('file_ids').notNullable().defaultTo('[]');
      table.text('status').notNullable().defaultTo('uploading');
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('expires_at', { useTz: true }).notNullable().defaultTo(knex.raw("now() + interval '35 minutes'"));
      table.timestamp('next_cleanup_at', { useTz: true }).nullable();
      table.timestamp('cleaned_at', { useTz: true }).nullable();
      table.uuid('cleanup_claim').nullable();
      table.integer('cleanup_attempts').notNullable().defaultTo(0);
      table.text('cleanup_error_code').nullable();
      table.primary(['tenant', 'attempt_id']);
      table.check("status IN ('uploading', 'committed', 'abandoned')");
      table.check("archive_sha256 ~ '^[0-9a-f]{64}$'");
      table.check("jsonb_typeof(file_ids) = 'array'");
    });
    await knex.raw(`CREATE INDEX IF NOT EXISTS portable_restore_uploads_cleanup_idx
      ON ${TABLE} (next_cleanup_at) WHERE cleaned_at IS NULL`);
  }
  await ensureTenantDistribution(knex, TABLE);
};

exports.down = async function down(knex) {
  if ((await knex.schema.hasTable(TABLE)) && (await knex(TABLE).first())) {
    throw new Error('Cannot remove portable restore upload attempts that still exist');
  }
  await knex.schema.dropTableIfExists(TABLE);
};

exports.config = { transaction: false };
