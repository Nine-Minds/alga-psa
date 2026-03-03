/**
 * Ensure only one tenant can hold an active verified takeover for a domain.
 */

const VERIFIED_DOMAIN_OWNER_UNIQ_INDEX =
  'msp_sso_verified_domain_owner_uniq_idx';

exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('msp_sso_tenant_login_domains');
  if (!hasTable) return;

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS ${VERIFIED_DOMAIN_OWNER_UNIQ_INDEX}
    ON msp_sso_tenant_login_domains (lower(domain))
    WHERE is_active = true
      AND claim_status IN ('verified', 'verified_legacy');
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`DROP INDEX IF EXISTS ${VERIFIED_DOMAIN_OWNER_UNIQ_INDEX};`);
};
