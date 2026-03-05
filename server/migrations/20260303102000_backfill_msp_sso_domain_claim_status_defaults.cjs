/**
 * Backfill deterministic claim lifecycle defaults for existing MSP SSO domain rows.
 *
 * - Enterprise deployments: existing rows become verified-compatible legacy claims.
 * - Community deployments: existing rows remain advisory.
 */

const INSTALLATION_METADATA_TABLE = 'installation_metadata';

async function getInstallationEdition(knex) {
  const hasMetadataTable = await knex.schema.hasTable(INSTALLATION_METADATA_TABLE);
  if (!hasMetadataTable) return null;

  const row = await knex(INSTALLATION_METADATA_TABLE)
    .select('value')
    .where({ key: 'edition' })
    .first();

  const value = String(row?.value ?? '').trim().toLowerCase();
  if (value === 'enterprise' || value === 'ee') return 'enterprise';
  if (value === 'community' || value === 'ce') return 'community';
  return null;
}

exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('msp_sso_tenant_login_domains');
  if (!hasTable) return;

  const hasClaimStatus = await knex.schema.hasColumn('msp_sso_tenant_login_domains', 'claim_status');
  if (!hasClaimStatus) return;

  const installationEdition = await getInstallationEdition(knex);
  if (installationEdition === 'enterprise') {
    await knex.raw(`
      WITH migration_now AS (
        SELECT now() AS ts
      )
      UPDATE msp_sso_tenant_login_domains AS d
      SET
        claim_status = 'verified_legacy',
        claim_status_updated_at = migration_now.ts,
        claimed_at = COALESCE(d.claimed_at, d.created_at, migration_now.ts),
        verified_at = COALESCE(d.verified_at, d.updated_at, d.created_at, migration_now.ts)
      FROM migration_now
      WHERE d.claim_status = 'advisory'
        AND d.rejected_at IS NULL
        AND d.revoked_at IS NULL;
    `);
    return;
  }

  if (!installationEdition) {
    // Safe fallback: preserve takeover compatibility when edition marker is missing or malformed.
    await knex.raw(`
      WITH migration_now AS (
        SELECT now() AS ts
      )
      UPDATE msp_sso_tenant_login_domains AS d
      SET
        claim_status = 'verified_legacy',
        claim_status_updated_at = migration_now.ts,
        claimed_at = COALESCE(d.claimed_at, d.created_at, migration_now.ts),
        verified_at = COALESCE(d.verified_at, d.updated_at, d.created_at, migration_now.ts)
      FROM migration_now
      WHERE d.claim_status = 'advisory'
        AND d.rejected_at IS NULL
        AND d.revoked_at IS NULL;
    `);
    return;
  }

  await knex.raw(`
    WITH migration_now AS (
      SELECT now() AS ts
    )
    UPDATE msp_sso_tenant_login_domains AS d
    SET
      claim_status = 'advisory',
      claim_status_updated_at = COALESCE(d.claim_status_updated_at, migration_now.ts)
    FROM migration_now
    WHERE d.claim_status IS NULL;
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
