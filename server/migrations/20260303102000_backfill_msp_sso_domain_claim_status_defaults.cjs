/**
 * Backfill deterministic claim lifecycle defaults for existing MSP SSO domain rows.
 *
 * - Enterprise deployments: existing rows become verified-compatible legacy claims.
 * - Community deployments: existing rows remain advisory.
 */

function isEnterpriseDeployment() {
  const edition = (process.env.EDITION ?? '').trim().toLowerCase();
  const publicEdition = (process.env.NEXT_PUBLIC_EDITION ?? '').trim().toLowerCase();
  return edition === 'ee' || edition === 'enterprise' || publicEdition === 'enterprise';
}

exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('msp_sso_tenant_login_domains');
  if (!hasTable) return;

  const hasClaimStatus = await knex.schema.hasColumn('msp_sso_tenant_login_domains', 'claim_status');
  if (!hasClaimStatus) return;

  if (isEnterpriseDeployment()) {
    await knex.raw(`
      UPDATE msp_sso_tenant_login_domains
      SET
        claim_status = 'verified_legacy',
        claim_status_updated_at = now(),
        claimed_at = COALESCE(claimed_at, created_at, now()),
        verified_at = COALESCE(verified_at, updated_at, created_at, now())
      WHERE claim_status = 'advisory'
        AND rejected_at IS NULL
        AND revoked_at IS NULL;
    `);
    return;
  }

  await knex.raw(`
    UPDATE msp_sso_tenant_login_domains
    SET
      claim_status = 'advisory',
      claim_status_updated_at = COALESCE(claim_status_updated_at, now())
    WHERE claim_status IS NULL;
  `);
};

exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable('msp_sso_tenant_login_domains');
  if (!hasTable) return;

  const hasClaimStatus = await knex.schema.hasColumn('msp_sso_tenant_login_domains', 'claim_status');
  if (!hasClaimStatus) return;

  await knex.raw(`
    UPDATE msp_sso_tenant_login_domains
    SET
      claim_status = 'advisory',
      claim_status_updated_at = now(),
      claimed_at = NULL,
      verified_at = NULL
    WHERE claim_status = 'verified_legacy';
  `);
};
