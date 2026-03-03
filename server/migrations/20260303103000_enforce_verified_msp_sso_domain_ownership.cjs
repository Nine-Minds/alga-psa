/**
 * Ensure only one tenant can hold an active verified takeover for a domain.
 */

const VERIFIED_DOMAIN_OWNER_UNIQ_INDEX =
  'msp_sso_verified_domain_owner_uniq_idx';
const VERIFIED_DOMAIN_OWNER_LOOKUP_INDEX =
  'msp_sso_verified_domain_owner_lookup_idx';

async function isDistributedTable(knex, tableName) {
  const citusFn = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_proc
      WHERE proname = 'create_distributed_table'
    ) AS exists;
  `);

  if (!citusFn.rows?.[0]?.exists) {
    return false;
  }

  const distributed = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_dist_partition
      WHERE logicalrelid = '${tableName}'::regclass
    ) AS is_distributed;
  `);

  return Boolean(distributed.rows?.[0]?.is_distributed);
}

exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('msp_sso_tenant_login_domains');
  if (!hasTable) return;

  const distributed = await isDistributedTable(knex, 'msp_sso_tenant_login_domains');

  if (distributed) {
    // Citus distributed tables generally require unique indexes to include the distribution key.
    // Keep a lookup index for conflict checks and enforce global ownership in app logic.
    await knex.raw(`
      CREATE INDEX IF NOT EXISTS ${VERIFIED_DOMAIN_OWNER_LOOKUP_INDEX}
      ON msp_sso_tenant_login_domains (lower(domain), tenant)
      WHERE is_active = true
        AND claim_status IN ('verified', 'verified_legacy');
    `);
    return;
  }

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS ${VERIFIED_DOMAIN_OWNER_UNIQ_INDEX}
    ON msp_sso_tenant_login_domains (lower(domain))
    WHERE is_active = true
      AND claim_status IN ('verified', 'verified_legacy');
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`DROP INDEX IF EXISTS ${VERIFIED_DOMAIN_OWNER_UNIQ_INDEX};`);
  await knex.raw(`DROP INDEX IF EXISTS ${VERIFIED_DOMAIN_OWNER_LOOKUP_INDEX};`);
};
