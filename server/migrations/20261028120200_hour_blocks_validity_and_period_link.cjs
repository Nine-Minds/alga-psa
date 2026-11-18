/**
 * Prepaid hours on contracts (alga-2026-0002684), migration 2 of 4: block
 * validity window and the link from a block to the service period that issued it.
 *
 *   hour_blocks + valid_from              date NULL   (null = no lower bound; every existing row)
 *               + service_period_record_id uuid NULL  (soft reference, like issuance_id)
 *   CHECK valid_from <= expiration_date
 *   CHECK source_type = 'contract' requires issuance_id or service_period_record_id
 *   INDEX (tenant, contract_line_id, valid_from)
 *
 * See ee/docs/plans/2026-10-20-prepaid-hours-contracts.md (D5, D8, section 4).
 * No data backfill. service_period_record_id carries no FK: recurring service
 * periods are colocated differently from hour_blocks on Citus, and the period
 * is released/voided by the lifecycle code rather than by cascade.
 * hour_blocks_issuance_fkey becomes a plain (NO ACTION) composite FK on every
 * deployment: the original ON DELETE SET NULL (issuance_id) (non-Citus only)
 * would null issuance_id on a contract block and violate the CHECK above. An
 * issuance with blocks is cancelled/restored, never deleted. Citus already
 * has the plain FK, so this only changes single-node databases.
 * Transaction-free, like the other hour_blocks migrations.
 */
const { hasCitus, isDistributed } = require('./utils/citusDistribution.cjs');

exports.config = { transaction: false };

async function setIssuanceFk(knex, onDelete) {
  await knex.raw('ALTER TABLE hour_blocks DROP CONSTRAINT IF EXISTS hour_blocks_issuance_fkey');
  await knex.raw(
    'ALTER TABLE hour_blocks ADD CONSTRAINT hour_blocks_issuance_fkey ' +
      'FOREIGN KEY (tenant, issuance_id) REFERENCES contract_line_block_issuances (tenant, issuance_id)' +
      (onDelete ? ` ON DELETE ${onDelete}` : '') + ' NOT VALID',
  );
}

async function isDistributedHourBlocks(knex) {
  return (await hasCitus(knex)) && (await isDistributed(knex, 'hour_blocks'));
}

const VALIDITY_CK = 'hour_blocks_valid_from_expiration_check';
const SOURCE_CK = 'hour_blocks_contract_source_check';

exports.up = async function up(knex) {
  await knex.raw('ALTER TABLE hour_blocks ADD COLUMN IF NOT EXISTS valid_from date NULL');
  await knex.raw('ALTER TABLE hour_blocks ADD COLUMN IF NOT EXISTS service_period_record_id uuid NULL');

  await knex.raw('ALTER TABLE hour_blocks DROP CONSTRAINT IF EXISTS ??', [VALIDITY_CK]);
  await knex.raw(
    'ALTER TABLE hour_blocks ADD CONSTRAINT ?? CHECK (valid_from IS NULL OR expiration_date IS NULL OR valid_from <= expiration_date) NOT VALID',
    [VALIDITY_CK],
  );

  // Enforce new writes immediately; the follow-up migration validates old rows.
  await knex.raw('ALTER TABLE hour_blocks DROP CONSTRAINT IF EXISTS ??', [SOURCE_CK]);
  await knex.raw(
    "ALTER TABLE hour_blocks ADD CONSTRAINT ?? CHECK (source_type <> 'contract' OR issuance_id IS NOT NULL OR service_period_record_id IS NOT NULL) NOT VALID",
    [SOURCE_CK],
  );

  if (!(await isDistributedHourBlocks(knex))) {
    await setIssuanceFk(knex, undefined);
  }

  await knex.raw(
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS hour_blocks_contract_line_valid_from_idx ON hour_blocks (tenant, contract_line_id, valid_from)',
  );
  await knex.raw(
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS hour_blocks_service_period_record_idx ON hour_blocks (tenant, service_period_record_id) WHERE service_period_record_id IS NOT NULL',
  );
};

exports.down = async function down(knex) {
  const row = await knex('hour_blocks')
    .whereNotNull('valid_from')
    .orWhereNotNull('service_period_record_id')
    .count({ n: '*' })
    .first();
  if (Number(row.n) > 0) {
    throw new Error(
      `Cannot roll back hour block validity: ${row.n} hour block(s) carry valid_from or service_period_record_id ` +
        '(cadence prepaid blocks). Void and remove them explicitly first.',
    );
  }
  if (!(await isDistributedHourBlocks(knex))) {
    await setIssuanceFk(knex, 'SET NULL (issuance_id)');
    await knex.raw('ALTER TABLE hour_blocks VALIDATE CONSTRAINT hour_blocks_issuance_fkey');
  }
  await knex.raw('DROP INDEX IF EXISTS hour_blocks_service_period_record_idx');
  await knex.raw('DROP INDEX IF EXISTS hour_blocks_contract_line_valid_from_idx');
  await knex.raw('ALTER TABLE hour_blocks DROP CONSTRAINT IF EXISTS ??', [SOURCE_CK]);
  await knex.raw('ALTER TABLE hour_blocks DROP CONSTRAINT IF EXISTS ??', [VALIDITY_CK]);
  await knex.raw('ALTER TABLE hour_blocks DROP COLUMN IF EXISTS service_period_record_id');
  await knex.raw('ALTER TABLE hour_blocks DROP COLUMN IF EXISTS valid_from');
};
