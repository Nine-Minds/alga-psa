/**
 * Link automatically purchased hour blocks to the bucket usage subject that
 * requested them. The link is attribution metadata, not ownership: after the
 * originating usage period rolls over, remaining minutes still participate in
 * the ordinary scoped hour-block pool.
 */

exports.config = { transaction: false };

exports.up = async function up(knex) {
  await knex.raw(
    'ALTER TABLE ?? ADD COLUMN IF NOT EXISTS ?? uuid NULL',
    ['hour_blocks', 'replenishment_bucket_usage_id'],
  );
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS hour_blocks_replenishment_bucket_usage_idx ON hour_blocks (tenant, replenishment_bucket_usage_id)',
  );
};

exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS hour_blocks_replenishment_bucket_usage_idx');
  await knex.raw(
    'ALTER TABLE ?? DROP COLUMN IF EXISTS ??',
    ['hour_blocks', 'replenishment_bucket_usage_id'],
  );
};
