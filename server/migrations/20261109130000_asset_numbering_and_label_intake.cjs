/**
 * Asset numbering persistence. No triggers are used: Citus 12.1 does not
 * support triggers on distributed tables. Applications write the canonical
 * normalized columns and an atomic tenant-scoped identity claim in the same
 * transaction as the asset/reservation. During rollout, old writers remain
 * compatible until explicit tenant activation adopts their rows and closes
 * the write policy. CHECK constraints and colocated foreign keys then require
 * canonical values and claim ownership for every subsequent asset write.
 *
 * This migration is intentionally resumable because production runs it with
 * transaction:false. Every DDL/backfill operation is safe to retry.
 */
const NORMALIZE_TAG = "NULLIF(translate(btrim(asset_tag), 'abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'), '')";
const NORMALIZE_PREFIX = "NULLIF(translate(btrim(asset_prefix), 'abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'), '')";
const { ensureConcurrentIndex } = require('./utils/ensureConcurrentIndex.cjs');

async function backfillClients(knex) {
  while (true) {
    // Keep locks bounded and resume from rows whose canonical value differs.
    const result = await knex.raw(`WITH batch AS (
      SELECT tenant, client_id FROM clients
       WHERE asset_prefix_normalized IS DISTINCT FROM ${NORMALIZE_PREFIX}
       LIMIT 1000
    ) UPDATE clients AS target
      SET asset_prefix_normalized = NULLIF(translate(btrim(target.asset_prefix), 'abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'), '')
      FROM batch WHERE target.tenant=batch.tenant AND target.client_id=batch.client_id`);
    if (result.rowCount < 1000) break;
  }
}

async function backfillAssets(knex) {
  while (true) {
    const result = await knex.raw(`WITH batch AS (
      SELECT tenant, asset_id FROM assets
       WHERE asset_tag_normalized IS DISTINCT FROM ${NORMALIZE_TAG}
       LIMIT 1000
    ) UPDATE assets AS target
      SET asset_tag_normalized = NULLIF(translate(btrim(target.asset_tag), 'abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'), '')
      FROM batch WHERE target.tenant=batch.tenant AND target.asset_id=batch.asset_id`);
    if (result.rowCount < 1000) break;
  }
}

async function distributeIfNeeded(knex, table) {
  const citus = await knex.raw("SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'citus') AS enabled");
  if (!citus.rows[0]?.enabled) return;
  const distributed = await knex.raw('SELECT 1 FROM pg_dist_partition WHERE logicalrelid = ?::regclass', [table]);
  if (!distributed.rows.length) {
    await knex.raw('SELECT create_distributed_table(?, \'tenant\', colocate_with => \'assets\')', [table]);
  }
}

exports.up = async function up(knex) {
  // Expand first: N-1 writers cannot supply a canonical tag or acquire a claim.
  // Explicit tenant activation later fences those writers through a foreign key.
  await knex.raw('ALTER TABLE tenants ADD COLUMN IF NOT EXISTS asset_tag_claims_required boolean NOT NULL DEFAULT false');
  await knex.raw('ALTER TABLE clients ADD COLUMN IF NOT EXISTS asset_prefix text NULL');
  await knex.raw('ALTER TABLE clients ADD COLUMN IF NOT EXISTS asset_prefix_normalized text NULL');
  await knex.raw('ALTER TABLE assets ADD COLUMN IF NOT EXISTS asset_tag_normalized text NULL');
  await knex.raw('ALTER TABLE assets ADD COLUMN IF NOT EXISTS asset_tag_managed boolean NOT NULL DEFAULT false');

  await knex.raw(`CREATE TABLE IF NOT EXISTS asset_tag_audit (
    tenant uuid NOT NULL, audit_id uuid NOT NULL DEFAULT gen_random_uuid(), asset_id uuid NOT NULL,
    asset_tag text NOT NULL, normalized_tag text NULL, reason text NOT NULL,
    discovered_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz NULL, resolution_note text NULL,
    PRIMARY KEY (tenant, audit_id)
  )`);
  await knex.raw(`CREATE TABLE IF NOT EXISTS asset_number_reservations (
    tenant uuid NOT NULL, reservation_id uuid NOT NULL DEFAULT gen_random_uuid(), client_id uuid NULL,
    asset_tag text NOT NULL, normalized_tag text NOT NULL, state text NOT NULL DEFAULT 'reserved',
    expires_at timestamptz NOT NULL, created_by uuid NULL, asset_id uuid NULL,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant, reservation_id)
  )`);
  await knex.raw(`CREATE TABLE IF NOT EXISTS asset_tag_claims (
    tenant uuid NOT NULL, normalized_tag text NOT NULL, asset_tag text NOT NULL,
    owner_kind text NOT NULL CHECK (owner_kind IN ('asset', 'reservation', 'legacy')),
    owner_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant, normalized_tag)
  )`);
  await knex.raw(`CREATE TABLE IF NOT EXISTS asset_tag_activation (
    tenant uuid PRIMARY KEY, activated_at timestamptz NOT NULL DEFAULT now(), activated_by uuid NULL
  )`);

  // Distribute before any backfill joins. Citus cannot execute joins between
  // its distributed assets and local side tables in a distributed write.
  for (const table of ['asset_tag_audit', 'asset_number_reservations', 'asset_tag_claims', 'asset_tag_activation']) {
    await distributeIfNeeded(knex, table);
  }

  await ensureConcurrentIndex(knex, 'asset_tag_audit_tenant_norm_idx', 'CREATE INDEX CONCURRENTLY IF NOT EXISTS asset_tag_audit_tenant_norm_idx ON asset_tag_audit (tenant, normalized_tag)');
  await ensureConcurrentIndex(knex, 'asset_number_reservations_tag_idx', 'CREATE INDEX CONCURRENTLY IF NOT EXISTS asset_number_reservations_tag_idx ON asset_number_reservations (tenant, normalized_tag)');
  await ensureConcurrentIndex(knex, 'asset_number_reservations_expiry_idx', 'CREATE INDEX CONCURRENTLY IF NOT EXISTS asset_number_reservations_expiry_idx ON asset_number_reservations (tenant, state, expires_at)');
  await ensureConcurrentIndex(knex, 'assets_tenant_asset_tag_normalized_idx', 'CREATE INDEX CONCURRENTLY IF NOT EXISTS assets_tenant_asset_tag_normalized_idx ON assets (tenant, asset_tag_normalized) WHERE asset_tag_normalized IS NOT NULL');
  await ensureConcurrentIndex(knex, 'assets_tenant_effective_tag_idx', `CREATE INDEX CONCURRENTLY IF NOT EXISTS assets_tenant_effective_tag_idx ON assets
    (tenant, (CASE WHEN asset_tag_managed THEN asset_tag_normalized ELSE ${NORMALIZE_TAG} END))`);
  await ensureConcurrentIndex(knex, 'clients_tenant_asset_prefix_normalized_uq', 'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS clients_tenant_asset_prefix_normalized_uq ON clients (tenant, asset_prefix_normalized) WHERE asset_prefix_normalized IS NOT NULL');
  await ensureConcurrentIndex(knex, 'tenants_asset_tag_policy_uq', 'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS tenants_asset_tag_policy_uq ON tenants (tenant, asset_tag_claims_required)');

  // Normalize all existing clients/tags without changing physical labels.
  await backfillClients(knex);
  await backfillAssets(knex);

  // Audit blanks and all members of normalized duplicate groups. NOT EXISTS
  // makes this safe after an interrupted, nontransactional run.
  await knex.raw(`INSERT INTO asset_tag_audit (tenant, asset_id, asset_tag, normalized_tag, reason)
    SELECT a.tenant, a.asset_id, a.asset_tag, NULL, 'blank' FROM assets a
     WHERE ${NORMALIZE_TAG} IS NULL AND NOT EXISTS (
       SELECT 1 FROM asset_tag_audit x WHERE x.tenant=a.tenant AND x.asset_id=a.asset_id AND x.reason='blank')`);
  await knex.raw(`INSERT INTO asset_tag_audit (tenant, asset_id, asset_tag, normalized_tag, reason)
    SELECT a.tenant, a.asset_id, a.asset_tag, a.asset_tag_normalized, 'duplicate' FROM assets a
      JOIN (SELECT tenant, asset_tag_normalized FROM assets WHERE asset_tag_normalized IS NOT NULL
            GROUP BY tenant, asset_tag_normalized HAVING count(*) > 1) d
        ON d.tenant=a.tenant AND d.asset_tag_normalized=a.asset_tag_normalized
     WHERE NOT EXISTS (SELECT 1 FROM asset_tag_audit x WHERE x.tenant=a.tenant AND x.asset_id=a.asset_id AND x.reason='duplicate')`);

  // Seed one claim for nonconflicting physical tags only. Legacy duplicate
  // groups remain untouched and are surfaced for explicit reconciliation.
  await knex.raw(`INSERT INTO asset_tag_claims (tenant, normalized_tag, asset_tag, owner_kind, owner_id)
    SELECT a.tenant, a.asset_tag_normalized, a.asset_tag, 'asset', a.asset_id
      FROM assets a JOIN (SELECT tenant, asset_tag_normalized FROM assets
          WHERE asset_tag_normalized IS NOT NULL GROUP BY tenant, asset_tag_normalized HAVING count(*) = 1) u
        ON u.tenant=a.tenant AND u.asset_tag_normalized=a.asset_tag_normalized
     ON CONFLICT (tenant, normalized_tag) DO NOTHING`);
  await knex.raw(`UPDATE asset_number_reservations SET normalized_tag = COALESCE(NULLIF(translate(btrim(asset_tag), 'abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'), ''), normalized_tag)
    WHERE normalized_tag IS DISTINCT FROM COALESCE(NULLIF(translate(btrim(asset_tag), 'abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'), ''), normalized_tag)`);
  await knex.raw(`INSERT INTO asset_tag_claims (tenant, normalized_tag, asset_tag, owner_kind, owner_id)
    SELECT r.tenant, r.normalized_tag, r.asset_tag, 'reservation', r.reservation_id
      FROM asset_number_reservations r
      JOIN (SELECT tenant, normalized_tag FROM asset_number_reservations GROUP BY tenant, normalized_tag HAVING count(*) = 1) u
        ON u.tenant=r.tenant AND u.normalized_tag=r.normalized_tag
     WHERE r.normalized_tag IS NOT NULL AND r.state <> 'committed'
       AND NOT EXISTS (SELECT 1 FROM assets a WHERE a.tenant=r.tenant AND a.asset_tag_normalized=r.normalized_tag)
     ON CONFLICT (tenant, normalized_tag) DO NOTHING`);

  // Constraints are idempotent and deliberately nonunique on assets. The
  // canonical value must match the same ASCII btrim/case fold used by lookup.
  await knex.raw(`DO $$ BEGIN
    ALTER TABLE assets ADD CONSTRAINT assets_asset_tag_normalized_ck
      CHECK (NOT asset_tag_managed OR asset_tag_normalized IS NOT DISTINCT FROM ${NORMALIZE_TAG}) NOT VALID;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
  await knex.raw(`DO $$ BEGIN
    ALTER TABLE clients ADD CONSTRAINT clients_asset_prefix_normalized_ck
      CHECK (asset_prefix_normalized IS NOT DISTINCT FROM ${NORMALIZE_PREFIX}
        AND (asset_prefix IS NULL OR btrim(asset_prefix) = '' OR (length(asset_prefix_normalized) <= 10 AND asset_prefix_normalized ~ '^[A-Z0-9-]+$'))) NOT VALID;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`);

  // Tenant isolation follows the repository's tenantDb facade. Session GUCs
  // do not propagate to Citus workers, so feature tables must not use RLS.
};

exports.down = async function down(knex) {
  // Retain physical tag columns. This rollback removes only feature metadata.
  for (const table of ['asset_tag_activation', 'asset_tag_claims', 'asset_number_reservations', 'asset_tag_audit']) {
    await knex.schema.dropTableIfExists(table);
  }
  await knex.raw('ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_asset_tag_normalized_ck');
  await knex.raw('ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_asset_prefix_normalized_ck');
  await knex.raw('DROP INDEX IF EXISTS assets_tenant_asset_tag_normalized_idx');
  await knex.raw('DROP INDEX IF EXISTS assets_tenant_effective_tag_idx');
  await knex.raw('DROP INDEX IF EXISTS clients_tenant_asset_prefix_normalized_uq');
  await knex.raw('ALTER TABLE assets DROP COLUMN IF EXISTS asset_tag_normalized');
  await knex.raw('ALTER TABLE assets DROP COLUMN IF EXISTS asset_tag_managed');
  await knex.raw('DROP INDEX IF EXISTS tenants_asset_tag_policy_uq');
  await knex.raw('ALTER TABLE tenants DROP COLUMN IF EXISTS asset_tag_claims_required');
  await knex.raw('ALTER TABLE clients DROP COLUMN IF EXISTS asset_prefix_normalized');
  await knex.raw('ALTER TABLE clients DROP COLUMN IF EXISTS asset_prefix');
};

exports.config = { transaction: false };
