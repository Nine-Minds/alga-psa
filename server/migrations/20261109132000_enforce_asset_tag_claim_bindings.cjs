/**
 * Bind persisted assets/reservations to their exclusive physical tag claim.
 * Generated keys make the relationship mandatory after tenant activation,
 * even for SQL writers that omit the shared service. Before activation the
 * compatibility policy accepts N-1 writes. Legacy exceptions are exact (tenant, asset, tag)
 * bindings captured by the migration, never a general uniqueness opt-out.
 * Colocated foreign keys and generated columns work on PostgreSQL and Citus.
 */
const { ensureConcurrentIndex } = require('./utils/ensureConcurrentIndex.cjs');

async function addConstraint(knex, table, name, definition) {
  // Let PostgreSQL serialize the DDL and handle retries atomically. The
  // catalog is database-wide metadata, so a tenant predicate cannot scope
  // this existence check for a tenant-distributed relation.
  await knex.raw(`DO $migration$ BEGIN
    ALTER TABLE ${table} ADD CONSTRAINT ${name} ${definition} NOT VALID;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $migration$`);
}

async function runBatch(knex, sql) {
  while (true) {
    const result = await knex.raw(sql);
    if (result.rowCount < 1000) break;
  }
}

exports.up = async function up(knex) {
  // Repair earlier draft installations that enabled GUC-based RLS. Citus
  // workers do not inherit app.current_tenant; all callers use tenantDb.
  for (const table of ['asset_tag_audit', 'asset_number_reservations', 'asset_tag_claims', 'asset_tag_activation']) {
    await knex.raw(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
    await knex.raw(`DROP POLICY IF EXISTS ${table}_tenant_policy ON ${table}`);
  }
  await knex.raw('ALTER TABLE asset_tag_claims DROP CONSTRAINT IF EXISTS asset_tag_claims_owner_kind_check');
  await addConstraint(knex, 'asset_tag_claims', 'asset_tag_claims_owner_kind_check',
    "CHECK (owner_kind IN ('asset', 'reservation', 'legacy'))");
  await knex.raw(`ALTER TABLE asset_tag_claims
    ADD COLUMN IF NOT EXISTS reservation_id uuid NULL,
    ADD COLUMN IF NOT EXISTS asset_id uuid GENERATED ALWAYS AS
      (CASE WHEN owner_kind = 'asset' THEN owner_id ELSE NULL END) STORED`);
  await knex.raw(`ALTER TABLE assets
    ADD COLUMN IF NOT EXISTS asset_tag_legacy_exempt boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS asset_tag_claim_key text GENERATED ALWAYS AS
      (CASE WHEN NOT asset_tag_managed OR asset_tag_legacy_exempt THEN NULL ELSE asset_tag_normalized END) STORED,
    ADD COLUMN IF NOT EXISTS asset_tag_legacy_key text GENERATED ALWAYS AS
      (CASE WHEN asset_tag_managed AND asset_tag_legacy_exempt THEN COALESCE(asset_tag_normalized, '') ELSE NULL END) STORED,
    ADD COLUMN IF NOT EXISTS asset_tag_unmanaged_policy boolean GENERATED ALWAYS AS
      (CASE WHEN asset_tag_managed THEN NULL ELSE false END) STORED`);
  await knex.raw(`CREATE TABLE IF NOT EXISTS asset_tag_legacy_bindings (
    tenant uuid NOT NULL, asset_id uuid NOT NULL, normalized_tag text NOT NULL,
    asset_tag text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant, asset_id, normalized_tag)
  )`);
  const citus = await knex.raw("SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'citus') AS enabled");
  if (citus.rows[0]?.enabled) {
    const distributed = await knex.raw("SELECT 1 FROM pg_dist_partition WHERE logicalrelid = 'asset_tag_legacy_bindings'::regclass");
    if (!distributed.rows.length) {
      await knex.raw("SELECT create_distributed_table('asset_tag_legacy_bindings', 'tenant', colocate_with => 'assets')");
    }
  }

  // Capture the reservation's immutable origin before ownership can transfer
  // to an asset. The reservation FK keeps referring to this origin afterwards.
  await runBatch(knex, `WITH batch AS (
    SELECT c.tenant, c.normalized_tag, r.reservation_id FROM asset_tag_claims c
      JOIN asset_number_reservations r ON c.tenant = r.tenant AND c.normalized_tag = r.normalized_tag
     WHERE c.reservation_id IS NULL
       AND ((c.owner_kind = 'reservation' AND c.owner_id = r.reservation_id)
         OR (c.owner_kind = 'asset' AND c.owner_id = r.asset_id))
     LIMIT 1000
  ) UPDATE asset_tag_claims c SET reservation_id = batch.reservation_id FROM batch
     WHERE c.tenant = batch.tenant AND c.normalized_tag = batch.normalized_tag`);

  await runBatch(knex, `WITH batch AS (
    SELECT a.tenant, a.asset_id, a.asset_tag_normalized, a.asset_tag FROM assets a
     WHERE a.asset_tag_normalized IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM assets other WHERE other.tenant = a.tenant
         AND other.asset_tag_normalized = a.asset_tag_normalized AND other.asset_id <> a.asset_id)
       AND NOT EXISTS (SELECT 1 FROM asset_tag_claims c
         WHERE c.tenant = a.tenant AND c.normalized_tag = a.asset_tag_normalized)
     LIMIT 1000
  ) INSERT INTO asset_tag_claims (tenant, normalized_tag, asset_tag, owner_kind, owner_id)
    SELECT tenant, asset_tag_normalized, asset_tag, 'asset', asset_id FROM batch
    ON CONFLICT (tenant, normalized_tag) DO NOTHING`);
  // Duplicate groups also occupy the namespace. Without a holding claim, a
  // SQL writer could claim a legacy duplicate tag for a new asset ID.
  await runBatch(knex, `WITH duplicate_tags AS (
    SELECT tenant, asset_tag_normalized, min(asset_tag) AS asset_tag
      FROM assets WHERE asset_tag_normalized IS NOT NULL
     GROUP BY tenant, asset_tag_normalized HAVING count(*) > 1
  ), batch AS (
    SELECT d.tenant, d.asset_tag_normalized, d.asset_tag FROM duplicate_tags d
     WHERE NOT EXISTS (SELECT 1 FROM asset_tag_claims c
       WHERE c.tenant = d.tenant AND c.normalized_tag = d.asset_tag_normalized)
     LIMIT 1000
  ) INSERT INTO asset_tag_claims (tenant, normalized_tag, asset_tag, owner_kind, owner_id)
    SELECT tenant, asset_tag_normalized, asset_tag, 'legacy', gen_random_uuid() FROM batch
    ON CONFLICT (tenant, normalized_tag) DO NOTHING`);

  // Preserve duplicates, blanks, and any previously inconsistent ownership.
  // No physical tag is changed and a new asset ID cannot use these bindings.
  await knex.raw(`INSERT INTO asset_tag_legacy_bindings (tenant, asset_id, normalized_tag, asset_tag)
    SELECT a.tenant, a.asset_id, COALESCE(a.asset_tag_normalized, ''), a.asset_tag
      FROM assets a LEFT JOIN asset_tag_claims c
        ON c.tenant = a.tenant AND c.normalized_tag = a.asset_tag_normalized
     WHERE a.asset_tag_normalized IS NULL OR c.owner_kind <> 'asset' OR c.owner_id <> a.asset_id OR EXISTS (
       SELECT 1 FROM assets other WHERE other.tenant = a.tenant
         AND other.asset_tag_normalized = a.asset_tag_normalized AND other.asset_id <> a.asset_id)
    ON CONFLICT (tenant, asset_id, normalized_tag) DO NOTHING`);
  while (true) {
    const updated = await knex.raw(`WITH batch AS (
      SELECT a.tenant, a.asset_id FROM assets a JOIN asset_tag_legacy_bindings legacy
        ON a.tenant = legacy.tenant AND a.asset_id = legacy.asset_id
       WHERE COALESCE(a.asset_tag_normalized, '') = legacy.normalized_tag AND NOT a.asset_tag_legacy_exempt
       LIMIT 1000
    ) UPDATE assets a SET asset_tag_legacy_exempt = true FROM batch
      WHERE a.tenant = batch.tenant AND a.asset_id = batch.asset_id`);
    if (updated.rowCount < 1000) break;
  }
  await runBatch(knex, `WITH batch AS (
    SELECT a.tenant, a.asset_id, a.asset_tag, a.asset_tag_normalized
      FROM assets a JOIN asset_tag_claims c ON c.tenant = a.tenant AND c.normalized_tag = a.asset_tag_normalized
     WHERE (c.owner_kind = 'reservation' OR (c.owner_kind = 'asset' AND c.owner_id <> a.asset_id))
       AND NOT EXISTS (SELECT 1 FROM asset_tag_audit audit WHERE audit.tenant = a.tenant
         AND audit.asset_id = a.asset_id AND audit.reason = 'claim_conflict')
     LIMIT 1000
  ) INSERT INTO asset_tag_audit (tenant, asset_id, asset_tag, normalized_tag, reason)
    SELECT tenant, asset_id, asset_tag, asset_tag_normalized, 'claim_conflict' FROM batch`);

  await ensureConcurrentIndex(knex, 'asset_tag_claims_asset_owner_uq', `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS asset_tag_claims_asset_owner_uq
    ON asset_tag_claims (tenant, normalized_tag, asset_id)`);
  await ensureConcurrentIndex(knex, 'asset_tag_claims_reservation_origin_uq', `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS asset_tag_claims_reservation_origin_uq
    ON asset_tag_claims (tenant, normalized_tag, reservation_id)`);

  await addConstraint(knex, 'asset_tag_claims', 'asset_tag_claims_reservation_owner_ck',
    "CHECK (owner_kind <> 'reservation' OR reservation_id IS NOT DISTINCT FROM owner_id)");
  await addConstraint(knex, 'assets', 'assets_nonblank_claim_ck',
    'CHECK (NOT asset_tag_managed OR asset_tag_legacy_exempt OR asset_tag_normalized IS NOT NULL)');
  // MATCH SIMPLE skips managed rows (NULL policy). Unmanaged writers must
  // reference the tenant's open compatibility policy. Activation adopts all
  // rows then closes that policy atomically, fencing even direct SQL writers.
  await addConstraint(knex, 'assets', 'assets_tag_write_policy_fk',
    'FOREIGN KEY (tenant, asset_tag_unmanaged_policy) REFERENCES tenants (tenant, asset_tag_claims_required)');
  await addConstraint(knex, 'assets', 'assets_tag_claim_fk',
    'FOREIGN KEY (tenant, asset_tag_claim_key, asset_id) REFERENCES asset_tag_claims (tenant, normalized_tag, asset_id)');
  await addConstraint(knex, 'assets', 'assets_tag_legacy_binding_fk',
    'FOREIGN KEY (tenant, asset_id, asset_tag_legacy_key) REFERENCES asset_tag_legacy_bindings (tenant, asset_id, normalized_tag)');
  await addConstraint(knex, 'asset_number_reservations', 'asset_number_reservations_tag_ck',
    "CHECK (normalized_tag IS NOT DISTINCT FROM NULLIF(translate(btrim(asset_tag), 'abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'), ''))");
  await addConstraint(knex, 'asset_number_reservations', 'asset_number_reservations_state_ck',
    "CHECK (state IN ('reserved', 'committed', 'expired', 'released') AND ((state = 'committed') = (asset_id IS NOT NULL)))");
  await addConstraint(knex, 'asset_number_reservations', 'asset_number_reservations_claim_fk',
    'FOREIGN KEY (tenant, normalized_tag, reservation_id) REFERENCES asset_tag_claims (tenant, normalized_tag, reservation_id)');
};

exports.down = async function down(knex) {
  for (const name of ['asset_number_reservations_claim_fk', 'asset_number_reservations_tag_ck', 'asset_number_reservations_state_ck']) {
    await knex.raw(`ALTER TABLE asset_number_reservations DROP CONSTRAINT IF EXISTS ${name}`);
  }
  for (const name of ['assets_tag_claim_fk', 'assets_tag_legacy_binding_fk', 'assets_nonblank_claim_ck', 'assets_tag_write_policy_fk']) {
    await knex.raw(`ALTER TABLE assets DROP CONSTRAINT IF EXISTS ${name}`);
  }
  await knex.raw('ALTER TABLE assets DROP COLUMN IF EXISTS asset_tag_claim_key, DROP COLUMN IF EXISTS asset_tag_legacy_key, DROP COLUMN IF EXISTS asset_tag_legacy_exempt, DROP COLUMN IF EXISTS asset_tag_unmanaged_policy');
  await knex.schema.dropTableIfExists('asset_tag_legacy_bindings');
  await knex.raw('ALTER TABLE asset_tag_claims DROP CONSTRAINT IF EXISTS asset_tag_claims_reservation_owner_ck');
  await knex.raw('DROP INDEX IF EXISTS asset_tag_claims_asset_owner_uq');
  await knex.raw('DROP INDEX IF EXISTS asset_tag_claims_reservation_origin_uq');
  await knex.raw('ALTER TABLE asset_tag_claims DROP COLUMN IF EXISTS asset_id, DROP COLUMN IF EXISTS reservation_id');
};

exports.config = { transaction: false };
