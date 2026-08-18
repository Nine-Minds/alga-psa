/**
 * Weighted burn rates for bucket hours — model correction.
 *
 * Reshapes bucket-of-hours from per-(contract_line, service) configs into
 * line-owned shared pools:
 *
 *   contract_line_buckets          — the pool (scope, totals, after-hours rule)
 *   contract_line_bucket_services  — membership + per-service burn multiplier
 *   bucket_usage                   — rekeyed by (tenant, bucket_id, period_start),
 *                                    minutes become numeric(12,2)
 *
 * The legacy `contract_line_service_bucket_config` rows (and their
 * `configuration_type='Bucket'` rows in `contract_line_service_configuration`)
 * stay in place, frozen. Each legacy config becomes its own single-member,
 * member-scoped pool at multiplier 1.0 — behavior-identical, no merging.
 * The new pool's `bucket_id` is seeded from the legacy config's `config_id` so
 * the member backfill and the usage remap are deterministic joins, not scans.
 *
 * One wrinkle: legacy configs are not actually unique per (line, service) —
 * see CANONICAL_BUCKET_CONFIGS. Duplicate groups collapse to their earliest
 * config, and only while every config in the group grants the same
 * entitlement; a group that disagrees hard-fails instead.
 *
 * Usage rows that no pool can hold are moved to
 * `bucket_usage_unmappable_archive` rather than deleted — `bucket_id` goes NOT
 * NULL, so they cannot stay, but absence of a config today does not prove a row
 * was never billable (see 3e).
 *
 * Down-migration drops the new tables and the `bucket_usage.bucket_id` column
 * and reverts the numeric types; the frozen legacy tables still describe the
 * old world. The archive survives `down` on purpose.
 *
 * Re-runnability: every DDL step is guarded (hasTable / hasColumn /
 * IF NOT EXISTS / constraint-existence checks) so a failed run — including the
 * deliberate hard-fail on orphaned usage rows — can be re-run after the data
 * is fixed.
 */

exports.config = { transaction: false };

// Distribute a tenant-scoped table on Citus, colocated with `contract_lines`
// (the same colocation group bucket_usage lives in). No-op on plain Postgres
// and on already-distributed tables.
async function distributeColocatedWithContractLines(knex, tableName) {
  let citusAvailable = false;
  try {
    const citusFn = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_proc WHERE proname = 'create_distributed_table'
      ) AS exists;
    `);
    citusAvailable = Boolean(citusFn.rows?.[0]?.exists);
  } catch {
    citusAvailable = false;
  }
  if (!citusAvailable) return;

  try {
    const alreadyDistributed = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition
        WHERE logicalrelid = '${tableName}'::regclass
      ) AS is_distributed;
    `);
    if (alreadyDistributed.rows?.[0]?.is_distributed) return;
  } catch {
    return; // pg_dist_partition unavailable on plain Postgres
  }

  await knex.raw(
    `SELECT create_distributed_table('${tableName}', 'tenant', colocate_with => 'contract_lines')`
  );
}

async function isCitusDistributed(knex, tableName) {
  try {
    const probe = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition WHERE logicalrelid = '${tableName}'::regclass
      ) AS is_distributed
    `);
    return Boolean(probe.rows[0]?.is_distributed);
  } catch {
    return false; // pg_dist_partition does not exist on plain Postgres
  }
}

async function constraintExists(knex, tableName, constraintName) {
  const rows = await knex.raw(`
    SELECT constraint_name
    FROM information_schema.table_constraints
    WHERE table_name = '${tableName}'
      AND constraint_name = '${constraintName}'
  `);
  return rows.rows.length > 0;
}

async function indexExists(knex, tableName, indexName) {
  const rows = await knex.raw(`
    SELECT indexname FROM pg_indexes
    WHERE tablename = '${tableName}' AND indexname = '${indexName}'
  `);
  return rows.rows.length > 0;
}

/**
 * The canonical legacy Bucket config per (tenant, contract_line_id, service_id).
 *
 * Legacy configs are NOT unique per (line, service), contrary to what the old
 * `plan_service_configuration` table guaranteed: `20250318200000` declared
 * `UNIQUE (plan_id, service_id, tenant)`, but `20251008000001` recreated the
 * table as `contract_line_service_configuration` with only
 * `PRIMARY KEY (tenant, config_id)` and backfilled it with a bare
 * `ON CONFLICT DO NOTHING`. Since then the contract-line editor has been able
 * to write a second config for the same service milliseconds after the first —
 * same bucket terms, `custom_rate`/`quantity` left NULL.
 *
 * The weighted-burn model puts a service in at most one pool per line
 * (`UNIQUE (tenant, contract_line_id, service_id)` below, mirroring the
 * cardinality documented in shared/billingClients/bucketUsageService.ts), so
 * each duplicate group collapses to its earliest config. Collapsing is only
 * lossless while the group agrees on the bucket terms; a group that disagrees
 * is a real entitlement ambiguity and hard-fails in
 * assertDuplicateBucketConfigsAreEquivalent() rather than silently discarding
 * one side's minutes.
 */
const CANONICAL_BUCKET_CONFIGS = `
  SELECT DISTINCT ON (psc.tenant, psc.contract_line_id, psc.service_id)
    psc.tenant,
    psc.config_id,
    psc.contract_line_id,
    psc.service_id,
    psbc.total_minutes,
    psbc.overage_rate,
    psbc.allow_rollover,
    psbc.billing_period
  FROM contract_line_service_configuration psc
  JOIN contract_line_service_bucket_config psbc
    ON psbc.tenant = psc.tenant AND psbc.config_id = psc.config_id
  WHERE psc.configuration_type = 'Bucket'
  ORDER BY psc.tenant, psc.contract_line_id, psc.service_id, psc.created_at, psc.config_id
`;

/**
 * A usage row covers a period, not an instant, so it belongs to the assignment
 * that was in force during that period — an interval overlap against
 * [period_start, period_end], not a point test on period_start. The point test
 * stranded rows whose period opened a few days before the assignment's
 * start_date (a mid-period contract start), which then died on the 3f orphan
 * guard. Bounds stay inclusive on both sides, matching resolveBucketDraw();
 * the explicit AT TIME ZONE 'UTC' keeps date extraction independent of the
 * server TimeZone setting.
 */
const ASSIGNMENT_COVERS_USAGE_PERIOD = `
  cc.start_date <= (bu.period_end AT TIME ZONE 'UTC')::date
  AND (cc.end_date IS NULL OR cc.end_date >= (bu.period_start AT TIME ZONE 'UTC')::date)
`;

/**
 * Hard-fail when duplicate legacy Bucket configs disagree on the terms that
 * become the pool, since collapsing them would silently pick one side's
 * minutes.
 *
 * Two Citus shapes to avoid here, both found the hard way against the hosted
 * cluster. The terms are compared as a concatenated text key rather than a
 * ROW(), because row comparison under COUNT(DISTINCT ...) does not survive the
 * aggregate push-down. And COUNT(DISTINCT ...) is projected in a grouped CTE
 * and filtered in an outer WHERE rather than tested in HAVING: in HAVING it
 * either mistypes the push-down (`COALESCE types numeric and character varying
 * cannot be matched`) or silently returns groups that do not satisfy the
 * predicate.
 */
async function assertDuplicateBucketConfigsAreEquivalent(knex) {
  const divergent = await knex.raw(`
    WITH terms AS (
      SELECT
        psc.tenant,
        psc.contract_line_id,
        psc.service_id,
        psbc.total_minutes::text || '|' ||
        psbc.overage_rate::text || '|' ||
        psbc.allow_rollover::text || '|' ||
        COALESCE(psbc.billing_period, '') AS term_key
      FROM contract_line_service_configuration psc
      JOIN contract_line_service_bucket_config psbc
        ON psbc.tenant = psc.tenant AND psbc.config_id = psc.config_id
      WHERE psc.configuration_type = 'Bucket'
    ),
    grouped AS (
      SELECT
        tenant,
        contract_line_id,
        service_id,
        COUNT(*) AS config_count,
        COUNT(DISTINCT term_key) AS distinct_terms
      FROM terms
      GROUP BY tenant, contract_line_id, service_id
    )
    SELECT tenant, contract_line_id, service_id, config_count
    FROM grouped
    WHERE config_count > 1 AND distinct_terms > 1
    LIMIT 5
  `);

  if (divergent.rows.length > 0) {
    const sample = divergent.rows
      .map((row) => `${row.tenant}/${row.contract_line_id}/${row.service_id} (${row.config_count} configs)`)
      .join(', ');
    throw new Error(
      `[create_contract_line_buckets] duplicate legacy Bucket configs disagree on total_minutes/overage_rate/` +
      `allow_rollover/billing_period (sample: ${sample}). A service belongs to at most one pool per line, and ` +
      'collapsing configs that grant different entitlements would discard minutes. Reconcile these configs before re-running.'
    );
  }
}

const NUMERIC_TYPE_OID = 1700; // pg_type.oid for 'numeric'

/**
 * atttypmod encoding for NUMERIC(p, s): ((p << 16) | s) + VARHDRSZ where
 * VARHDRSZ = 4. For NUMERIC(12,2) that is ((12 << 16) | 2) + 4 = 786438.
 */
function numericAtttypmod(precision, scale) {
  return ((precision << 16) | scale) + 4;
}

/**
 * Detect and repair the coordinator's (catalog-level) atttypmod for a numeric
 * column so it matches NUMERIC(precision, scale) exactly.
 *
 * On Citus the shard-side `ALTER COLUMN ... TYPE NUMERIC` does NOT propagate a
 * matching `pg_attribute` entry on the coordinator; a wrong encoding there (or
 * an entry missing entirely) makes catalog reads disagree with the shards.
 * Runs unconditionally — on plain Postgres it is a cheap no-op when the DDL
 * already produced the correct encoding, and it repairs a prior bad run.
 */
async function ensureCoordinatorNumericAtttypmod(knex, tableName, columnName, precision, scale) {
  const expected = numericAtttypmod(precision, scale);
  const rows = await knex.raw(`
    SELECT atttypid, atttypmod
    FROM pg_attribute
    WHERE attrelid = '${tableName}'::regclass
      AND attname = '${columnName}'
      AND NOT attisdropped
  `);
  const current = rows.rows[0];
  if (!current) {
    return; // Column does not exist (yet) — nothing to repair.
  }
  if (current.atttypid !== NUMERIC_TYPE_OID || Number(current.atttypmod) !== expected) {
    await knex.raw(`
      UPDATE pg_attribute
      SET atttypid = ${NUMERIC_TYPE_OID},
          atttypmod = ${expected}
      WHERE attrelid = '${tableName}'::regclass
        AND attname = '${columnName}'
        AND NOT attisdropped
    `);
  }
}

exports.up = async function up(knex) {
  // -------------------------------------------------------------------------
  // 1. contract_line_buckets — the pool
  // -------------------------------------------------------------------------
  if (!(await knex.schema.hasTable('contract_line_buckets'))) {
    await knex.schema.createTable('contract_line_buckets', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('bucket_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
      table.uuid('contract_line_id').notNullable();
      table.text('bucket_name').nullable();
      table.integer('total_minutes').notNullable();
      table.decimal('overage_rate', 10, 2).notNullable().defaultTo(0);
      table.boolean('allow_rollover').notNullable().defaultTo(false);
      table.text('billing_period').notNullable().defaultTo('monthly');
      table.decimal('after_hours_multiplier', 6, 3).nullable();
      table.uuid('business_hours_schedule_id').nullable();
      table.boolean('covers_all_services').notNullable().defaultTo(false);
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now()).notNullable();
      table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now()).notNullable();

      table.primary(['tenant', 'bucket_id']);
      table.foreign('tenant').references('tenants.tenant');
      table.foreign(['tenant', 'contract_line_id'])
        .references(['tenant', 'contract_line_id'])
        .inTable('contract_lines')
        .onDelete('CASCADE');
      table.foreign(['tenant', 'business_hours_schedule_id'])
        .references(['tenant', 'schedule_id'])
        .inTable('business_hours_schedules')
        .onDelete('RESTRICT');
    });
  }

  // Rule inert without a schedule; multipliers strictly positive.
  if (!(await constraintExists(knex, 'contract_line_buckets', 'contract_line_buckets_after_hours_rule_check'))) {
    await knex.raw(`
      ALTER TABLE contract_line_buckets
      ADD CONSTRAINT contract_line_buckets_after_hours_rule_check
      CHECK (
        after_hours_multiplier IS NULL OR business_hours_schedule_id IS NOT NULL
      )
    `);
  }
  if (!(await constraintExists(knex, 'contract_line_buckets', 'contract_line_buckets_after_hours_multiplier_check'))) {
    await knex.raw(`
      ALTER TABLE contract_line_buckets
      ADD CONSTRAINT contract_line_buckets_after_hours_multiplier_check
      CHECK (after_hours_multiplier IS NULL OR after_hours_multiplier > 0)
    `);
  }
  // At most one catch-all bucket per contract line.
  if (!(await indexExists(knex, 'contract_line_buckets', 'contract_line_buckets_one_catch_all_uidx'))) {
    await knex.raw(`
      CREATE UNIQUE INDEX contract_line_buckets_one_catch_all_uidx
      ON contract_line_buckets (tenant, contract_line_id)
      WHERE covers_all_services
    `);
  }

  // -------------------------------------------------------------------------
  // 2. contract_line_bucket_services — membership + per-service multiplier
  // -------------------------------------------------------------------------
  if (!(await knex.schema.hasTable('contract_line_bucket_services'))) {
    await knex.schema.createTable('contract_line_bucket_services', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('bucket_id').notNullable();
      table.uuid('service_id').notNullable();
      table.uuid('contract_line_id').notNullable();
      table.decimal('burn_multiplier', 6, 3).notNullable().defaultTo(1);
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now()).notNullable();
      table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now()).notNullable();

      table.primary(['tenant', 'bucket_id', 'service_id']);
      table.foreign('tenant').references('tenants.tenant');
      table.foreign(['tenant', 'bucket_id'])
        .references(['tenant', 'bucket_id'])
        .inTable('contract_line_buckets')
        .onDelete('CASCADE');
      table.foreign(['tenant', 'service_id'])
        .references(['tenant', 'service_id'])
        .inTable('service_catalog')
        .onDelete('CASCADE');
      table.foreign(['tenant', 'contract_line_id'])
        .references(['tenant', 'contract_line_id'])
        .inTable('contract_lines')
        .onDelete('CASCADE');
      // One bucket per (line, service) — the successor of the alga0002175
      // invariant documented in shared/billingClients/bucketUsageService.ts.
      table.unique(['tenant', 'contract_line_id', 'service_id']);
    });
  }

  if (!(await constraintExists(knex, 'contract_line_bucket_services', 'contract_line_bucket_services_burn_multiplier_check'))) {
    await knex.raw(`
      ALTER TABLE contract_line_bucket_services
      ADD CONSTRAINT contract_line_bucket_services_burn_multiplier_check
      CHECK (burn_multiplier > 0)
    `);
  }

  // -------------------------------------------------------------------------
  // 2b. Distribute the new tables BEFORE bucket_usage references them: on Citus
  //     a foreign key between a local table and a not-yet-distributed table
  //     fails, so the pool tables must be distributed (colocated with
  //     contract_lines) before the FK is added below.
  // -------------------------------------------------------------------------
  await distributeColocatedWithContractLines(knex, 'contract_line_buckets');
  await distributeColocatedWithContractLines(knex, 'contract_line_bucket_services');

  // -------------------------------------------------------------------------
  // 3. bucket_usage — add bucket_id, backfill, pin NOT NULL, widen numerics
  // -------------------------------------------------------------------------
  const hasBucketId = await knex.schema.hasColumn('bucket_usage', 'bucket_id');
  if (!hasBucketId) {
    await knex.schema.table('bucket_usage', (table) => {
      table.uuid('bucket_id').nullable();
    });
  }

  const bucketUsageRowsBefore = await knex('bucket_usage').count('* as count');
  console.log(`[create_contract_line_buckets] bucket_usage rows before backfill: ${bucketUsageRowsBefore[0].count}`);

  // 3a. Refuse to collapse duplicate configs that grant different entitlements,
  //     then sweep pools left behind by an earlier run of THIS migration that
  //     seeded a pool per legacy config before the duplicates were understood.
  //     Both tables are created here, so a pool keyed on a now-non-canonical
  //     config_id can only be debris from such a run — and the members/usage
  //     checks keep the delete from touching anything that is referenced.
  await assertDuplicateBucketConfigsAreEquivalent(knex);

  // Materialize the canonical set once. Citus will not accept a correlated
  // subquery whose FROM clause holds a subquery or CTE ("correlated subqueries
  // are not supported when the FROM clause contains a CTE or subquery"), which
  // rules out driving the writes below from an inline `(${CANONICAL_BUCKET_CONFIGS})`
  // via EXISTS / INSERT ... SELECT. Same resolution the usage remap already
  // takes: read the mapping with a supported SELECT, then issue
  // distribution-key-qualified point writes. The set is small — one row per
  // (line, service) carrying a bucket, tens of rows per tenant.
  const canonicalConfigs = (await knex.raw(CANONICAL_BUCKET_CONFIGS)).rows;
  console.log(`[create_contract_line_buckets] ${canonicalConfigs.length} canonical legacy Bucket configs`);

  // Sweep pools left behind by an earlier run of THIS migration, which seeded a
  // pool per legacy config before the duplicates were understood. Both tables
  // are created here, so a pool keyed on a now-non-canonical config_id can only
  // be debris from such a run; the members/usage anti-joins keep the delete off
  // anything referenced.
  const stalePools = await knex.raw(`
    WITH canon AS (${CANONICAL_BUCKET_CONFIGS}),
    legacy AS (
      SELECT psc.tenant, psc.config_id
      FROM contract_line_service_configuration psc
      JOIN contract_line_service_bucket_config psbc
        ON psbc.tenant = psc.tenant AND psbc.config_id = psc.config_id
      WHERE psc.configuration_type = 'Bucket'
    )
    SELECT b.tenant, b.bucket_id
    FROM contract_line_buckets b
    JOIN legacy a ON a.tenant = b.tenant AND a.config_id = b.bucket_id
    LEFT JOIN canon c ON c.tenant = b.tenant AND c.config_id = b.bucket_id
    LEFT JOIN contract_line_bucket_services m ON m.tenant = b.tenant AND m.bucket_id = b.bucket_id
    LEFT JOIN bucket_usage bu ON bu.tenant = b.tenant AND bu.bucket_id = b.bucket_id
    WHERE c.config_id IS NULL
      AND m.bucket_id IS NULL
      AND bu.usage_id IS NULL
  `);
  for (const row of stalePools.rows) {
    await knex('contract_line_buckets')
      .where({ tenant: row.tenant, bucket_id: row.bucket_id })
      .del();
  }
  if (stalePools.rows.length > 0) {
    console.log(`[create_contract_line_buckets] swept ${stalePools.rows.length} non-canonical pools from a prior run`);
  }

  // 3b. One pool per canonical legacy config (member-scoped, no after-hours rule).
  //     The terms are MERGED, not ignored, on conflict. A pool keyed on a legacy
  //     config_id can already exist from an earlier failed run of this migration,
  //     carrying whatever the config held at that moment; DO NOTHING would keep
  //     those stale values forever while the migration reported success. The
  //     legacy config is the source of truth until this migration completes — no
  //     one edits pools before the new model is live — so re-reading it on every
  //     run is what makes the step converge.
  //
  //     Only the four term columns are merged. contract_line_id is pool identity,
  //     and covers_all_services / after_hours_multiplier /
  //     business_hours_schedule_id belong to the new model, so an existing pool
  //     keeps whatever it holds for those rather than being reset to the seed.
  for (const config of canonicalConfigs) {
    await knex('contract_line_buckets')
      .insert({
        tenant: config.tenant,
        bucket_id: config.config_id,
        contract_line_id: config.contract_line_id,
        total_minutes: config.total_minutes,
        overage_rate: config.overage_rate,
        allow_rollover: config.allow_rollover,
        billing_period: config.billing_period,
        covers_all_services: false,
        updated_at: knex.fn.now(),
      })
      .onConflict(['tenant', 'bucket_id'])
      .merge(['total_minutes', 'overage_rate', 'allow_rollover', 'billing_period', 'updated_at']);
  }

  // 3c. One member row per canonical legacy config at multiplier 1.0. The
  //     conflict target names the primary key, but the table also carries
  //     UNIQUE (tenant, contract_line_id, service_id) — an uncollapsed
  //     duplicate group violates that one instead, which no arbiter here can
  //     absorb. Feeding the canonical set is what keeps both keys satisfied.
  for (const config of canonicalConfigs) {
    await knex('contract_line_bucket_services')
      .insert({
        tenant: config.tenant,
        bucket_id: config.config_id,
        service_id: config.service_id,
        contract_line_id: config.contract_line_id,
        burn_multiplier: 1,
      })
      .onConflict(['tenant', 'bucket_id', 'service_id'])
      .ignore();
  }

  // 3d. Remap existing usage rows to the new pool. A canonical config is unique
  //     per (line, service), and its line's contract identifies the client the
  //     pool serves — match on client via the line's contract + service. This
  //     deliberately keys on client rather than bucket_usage.contract_line_id,
  //     which the old write path was known to populate unreliably (the
  //     write-under-one-line/read-under-another mismatch the rekey kills).
  //
  //     Effective window: a usage row must only match the assignment that was
  //     in force for the row's period, mirroring the runtime resolution in
  //     shared/billingClients/bucketUsageService.ts resolveBucketDraw() —
  //     see ASSIGNMENT_COVERS_USAGE_PERIOD for the bounds and why the test is
  //     an interval overlap rather than a point test on period_start.
  //     Deliberately NOT filtering cc.is_active: the runtime uses is_active to
  //     gate *current* draws, but historical usage legitimately belongs to
  //     assignments that have since been deactivated — filtering them would
  //     push valid rows into the 3e unmapped hard failure. If two assignment
  //     windows genuinely overlap the usage period, the row matches both and
  //     the ambiguity guard below fails loudly rather than silently picking one.
  //
  //     Precedence, not raw overlap. Widening the window to an overlap made
  //     *sequential replacement* look ambiguous: an assignment ending 06-15 and
  //     its replacement starting 06-16 both overlap a 06-01..06-30 usage period,
  //     so a perfectly healthy mid-period contract switch matched two pools and
  //     aborted the migration — a case the point test resolved cleanly and the
  //     existing tests miss (they only cover replacement on a period boundary).
  //     So candidates are ranked: an assignment whose window contains
  //     period_start is the row's real owner, because that is the anchor the old
  //     write path resolved the draw with. Overlap-only candidates are the
  //     fallback that rescues a mid-period contract *start*, where nothing
  //     contains period_start. A row is ambiguous only when two distinct pools
  //     tie at its best rank — genuinely concurrent assignments, not consecutive
  //     ones.
  //
  //     Citus rejects the equivalent UPDATE ... FROM multi-table join even when
  //     every join includes the tenant distribution key, so the candidates are
  //     materialized here and applied as distribution-key-qualified point
  //     updates. Ranking in JS also keeps the guard and the mapping reading the
  //     one identical candidate set — they cannot drift apart the way two
  //     separately-written SQL queries could.
  const usageCandidates = await knex.raw(`
    WITH canon AS (${CANONICAL_BUCKET_CONFIGS})
    SELECT DISTINCT
      bu.tenant,
      bu.usage_id,
      c.config_id AS bucket_id,
      bool_or(
        cc.start_date <= (bu.period_start AT TIME ZONE 'UTC')::date
        AND (cc.end_date IS NULL OR cc.end_date >= (bu.period_start AT TIME ZONE 'UTC')::date)
      ) AS covers_period_start
    FROM bucket_usage bu
    JOIN canon c
      ON c.tenant = bu.tenant
      AND c.service_id = bu.service_catalog_id
    JOIN contract_lines cl
      ON cl.tenant = c.tenant
      AND cl.contract_line_id = c.contract_line_id
    JOIN client_contracts cc
      ON cc.tenant = c.tenant
      AND cc.contract_id = cl.contract_id
    WHERE bu.bucket_id IS NULL
      AND bu.client_id = cc.client_id
      AND ${ASSIGNMENT_COVERS_USAGE_PERIOD}
    GROUP BY bu.tenant, bu.usage_id, c.config_id
  `);

  const candidatesByUsage = new Map();
  for (const row of usageCandidates.rows) {
    const key = `${row.tenant}/${row.usage_id}`;
    if (!candidatesByUsage.has(key)) {
      candidatesByUsage.set(key, { tenant: row.tenant, usage_id: row.usage_id, candidates: [] });
    }
    candidatesByUsage.get(key).candidates.push(row);
  }

  const resolvedUsageRows = [];
  const ambiguousUsage = [];
  for (const entry of candidatesByUsage.values()) {
    const anchored = entry.candidates.filter((row) => row.covers_period_start);
    const best = anchored.length > 0 ? anchored : entry.candidates;
    const pools = [...new Set(best.map((row) => row.bucket_id))];
    if (pools.length > 1) {
      ambiguousUsage.push({ ...entry, pools, anchored: anchored.length > 0 });
    } else {
      resolvedUsageRows.push({ tenant: entry.tenant, usage_id: entry.usage_id, bucket_id: pools[0] });
    }
  }

  if (ambiguousUsage.length > 0) {
    const sample = ambiguousUsage
      .slice(0, 5)
      .map((row) => `${row.usage_id} -> ${row.pools.join(' | ')}`)
      .join(', ');
    throw new Error(
      `[create_contract_line_buckets] ${ambiguousUsage.length} bucket_usage rows match more than one bucket pool ` +
      `even after preferring the assignment that covers period_start (sample: ${sample}). ` +
      'This means the client holds two assignments that are in force at the same time and whose lines both ' +
      'carry a Bucket config for the service — consecutive contracts that merely abut or replace each other ' +
      'are already handled and will not appear here. A usage row must belong to exactly one pool, so resolve ' +
      'the concurrent assignments before re-running.'
    );
  }

  for (const row of resolvedUsageRows) {
    await knex('bucket_usage')
      .where({ tenant: row.tenant, usage_id: row.usage_id })
      .whereNull('bucket_id')
      .update({ bucket_id: row.bucket_id });
  }

  // 3e. Quarantine usage rows that no pool can hold. A row whose service has no
  //     Bucket config anywhere in the tenant — and whose own line has none
  //     either — has nothing to attach to, and bucket_id goes NOT NULL below, so
  //     it cannot stay in bucket_usage.
  //
  //     It is NOT safe to call these rows "never billable", which is why they are
  //     copied out rather than deleted. Config lineage was snapshotted on
  //     2025-10-08: 20251008000001 backfilled contract_line_service_configuration
  //     from plan_service_configuration, and 20251008000003 then dropped
  //     plan_service_configuration CASCADE. Any bucket config retired before that
  //     snapshot — a service removed from a plan, a plan deleted (the old rows
  //     cascaded from billing_plans), a restructure — is simply absent today
  //     while its usage rows survive. On an appliance that ran buckets through
  //     2024 and retired the plan in 2025, those rows are real invoiced history,
  //     not debris. bucket_usage.contract_line_id compounds it: the old write
  //     path populated it unreliably, so the line half of the test can miss too.
  //
  //     So the rows move to bucket_usage_unmappable_archive, which no later step
  //     touches and `down` drops only alongside the rest of the new model. The
  //     migration stays runnable, nothing is destroyed, and an operator who finds
  //     history missing can reconstruct it from a table rather than from console
  //     scrollback.
  //
  //     Scoped deliberately narrow either way: a row that HAS a candidate config
  //     but fails the client/window join is a mapping problem, not debris, and
  //     still hits the hard-fail guard below.
  if (!(await knex.schema.hasTable('bucket_usage_unmappable_archive'))) {
    await knex.schema.createTable('bucket_usage_unmappable_archive', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('usage_id').notNullable();
      table.uuid('client_id').nullable();
      table.uuid('contract_line_id').nullable();
      table.uuid('service_catalog_id').nullable();
      table.timestamp('period_start', { useTz: true }).notNullable();
      table.timestamp('period_end', { useTz: true }).notNullable();
      table.decimal('minutes_used', 12, 2).notNullable();
      table.decimal('overage_minutes', 12, 2).notNullable();
      table.decimal('rolled_over_minutes', 12, 2).nullable();
      table.timestamp('archived_at', { useTz: true }).defaultTo(knex.fn.now()).notNullable();
      table.text('archived_reason').notNullable();

      table.primary(['tenant', 'usage_id']);
      // No foreign keys on purpose: the archive has to outlive whatever made the
      // row unmappable, including a deleted service, line, or client.
    });
  }
  await distributeColocatedWithContractLines(knex, 'bucket_usage_unmappable_archive');

  //     Written as top-level anti-joins rather than NOT EXISTS for the Citus
  //     reason noted at 3a: a correlated subquery cannot read from a CTE. The
  //     LEFT JOINs may fan out on the matching side, but only non-matching rows
  //     survive the IS NULL filter, so no row is reported twice.
  const unmappableUsage = await knex.raw(`
    WITH canon AS (${CANONICAL_BUCKET_CONFIGS})
    SELECT DISTINCT bu.tenant, bu.usage_id, bu.client_id, bu.contract_line_id,
           bu.service_catalog_id, bu.period_start, bu.period_end,
           bu.minutes_used, bu.overage_minutes, bu.rolled_over_minutes
    FROM bucket_usage bu
    LEFT JOIN canon by_service
      ON by_service.tenant = bu.tenant AND by_service.service_id = bu.service_catalog_id
    LEFT JOIN canon by_line
      ON by_line.tenant = bu.tenant AND by_line.contract_line_id = bu.contract_line_id
    WHERE bu.bucket_id IS NULL
      AND by_service.config_id IS NULL
      AND by_line.config_id IS NULL
  `);

  for (const row of unmappableUsage.rows) {
    console.log(
      `[create_contract_line_buckets] archiving unmappable bucket_usage ${row.usage_id} ` +
      `(tenant ${row.tenant}, client ${row.client_id}, line ${row.contract_line_id}, ` +
      `service ${row.service_catalog_id}, period ${row.period_start}, ` +
      `minutes_used ${row.minutes_used}, overage ${row.overage_minutes}): ` +
      'no Bucket config exists for its service or its line'
    );
    await knex('bucket_usage_unmappable_archive')
      .insert({
        tenant: row.tenant,
        usage_id: row.usage_id,
        client_id: row.client_id,
        contract_line_id: row.contract_line_id,
        service_catalog_id: row.service_catalog_id,
        period_start: row.period_start,
        period_end: row.period_end,
        minutes_used: row.minutes_used,
        overage_minutes: row.overage_minutes,
        rolled_over_minutes: row.rolled_over_minutes,
        archived_reason: 'no Bucket config exists for its service or its line',
      })
      .onConflict(['tenant', 'usage_id'])
      .ignore();
    await knex('bucket_usage')
      .where({ tenant: row.tenant, usage_id: row.usage_id })
      .whereNull('bucket_id')
      .del();
  }
  if (unmappableUsage.rows.length > 0) {
    console.log(
      `[create_contract_line_buckets] archived ${unmappableUsage.rows.length} unmappable bucket_usage row(s) ` +
      'to bucket_usage_unmappable_archive; no usage data was destroyed'
    );
  }

  // 3f. Guard: any usage row still unmapped had a pool to reach and did not
  //     reach it — a keying problem the migration must not paper over. Fail
  //     loudly rather than ship an orphan.
  const unmapped = await knex('bucket_usage').whereNull('bucket_id').count('* as count');
  if (Number(unmapped[0].count) > 0) {
    throw new Error(
      `[create_contract_line_buckets] ${unmapped[0].count} bucket_usage rows could not be remapped ` +
      '(client via the line\'s contract + service_catalog_id, over the assignment window). ' +
      'A Bucket config exists for their service or line, so this is a keying problem rather than ' +
      'pre-schema debris. Refusing to continue with orphaned usage rows.'
    );
  }

  // 3g. Pre-check the new unique key against duplicate (bucket_id, period_start)
  //     rows. client_contracts is many-to-many; two usage rows for the same pool
  //     and period would make the unique index creation fail late with a cryptic
  //     error. Fail early with a descriptive one instead.
  const duplicatePeriodRows = await knex.raw(`
    SELECT tenant, bucket_id, period_start, COUNT(*) AS row_count
    FROM bucket_usage
    WHERE bucket_id IS NOT NULL
    GROUP BY tenant, bucket_id, period_start
    HAVING COUNT(*) > 1
    LIMIT 5
  `);
  if (duplicatePeriodRows.rows.length > 0) {
    const sample = duplicatePeriodRows.rows
      .map((row) => `${row.tenant}/${row.bucket_id}/${row.period_start} (${row.row_count} rows)`)
      .join(', ');
    throw new Error(
      `[create_contract_line_buckets] duplicate (tenant, bucket_id, period_start) rows exist in bucket_usage ` +
      `(sample: ${sample}). The new unique key cannot be created until these are resolved.`
    );
  }

  // 3h. FK + NOT NULL on bucket_id. Citus distributed tables need the
  //     run_command_on_shards form for the NOT NULL ALTER.
  if (!(await constraintExists(knex, 'bucket_usage', 'bucket_usage_bucket_id_fk'))) {
    await knex.raw(`
      ALTER TABLE bucket_usage
      ADD CONSTRAINT bucket_usage_bucket_id_fk
      FOREIGN KEY (tenant, bucket_id)
      REFERENCES contract_line_buckets(tenant, bucket_id)
      ON DELETE RESTRICT
    `);
  }

  const usageCitusDistributed = await isCitusDistributed(knex, 'bucket_usage');
  if (usageCitusDistributed) {
    await knex.raw(`
      SELECT * FROM run_command_on_shards(
        'bucket_usage',
        $$ALTER TABLE %s ALTER COLUMN bucket_id SET NOT NULL$$
      )
    `);
    await knex.raw(`
      UPDATE pg_attribute
      SET attnotnull = true
      WHERE attrelid = 'bucket_usage'::regclass
        AND attname = 'bucket_id'
        AND attnotnull = false
    `);
  } else {
    await knex.raw(`ALTER TABLE bucket_usage ALTER COLUMN bucket_id SET NOT NULL`);
  }

  // 3i. minutes_used / overage_minutes: bigint -> numeric(12,2) (weighted
  // minutes are fractional). Distributed tables need the shard-aware form.
  if (usageCitusDistributed) {
    await knex.raw(`
      SELECT * FROM run_command_on_shards(
        'bucket_usage',
        $$ALTER TABLE %s ALTER COLUMN minutes_used TYPE NUMERIC(12,2) USING minutes_used::NUMERIC(12,2);
          ALTER TABLE %s ALTER COLUMN overage_minutes TYPE NUMERIC(12,2) USING overage_minutes::NUMERIC(12,2)$$
      )
    `);
  } else {
    await knex.schema.alterTable('bucket_usage', (table) => {
      table.decimal('minutes_used', 12, 2).notNullable().alter();
      table.decimal('overage_minutes', 12, 2).notNullable().alter();
    });
  }

  // The coordinator's/catalog's atttypmod must match NUMERIC(12,2) exactly
  // (encoded as ((12 << 16) | 2) + 4 = 786438). On Citus the shard ALTER above
  // does not touch the coordinator's pg_attribute, and a prior buggy run wrote
  // a wrong encoding there — detect the mismatch on rerun and repair it. On
  // plain Postgres this is a no-op when the DDL already encoded it correctly.
  await ensureCoordinatorNumericAtttypmod(knex, 'bucket_usage', 'minutes_used', 12, 2);
  await ensureCoordinatorNumericAtttypmod(knex, 'bucket_usage', 'overage_minutes', 12, 2);

  // 3j. New unique key — kills the duplicate-period hazard and the
  //     write-under-one-line/read-under-another mismatch.
  if (!(await indexExists(knex, 'bucket_usage', 'bucket_usage_tenant_bucket_period_uidx'))) {
    await knex.raw(`
      CREATE UNIQUE INDEX bucket_usage_tenant_bucket_period_uidx
      ON bucket_usage (tenant, bucket_id, period_start)
    `);
  }
};

exports.down = async function down(knex) {
  // Revert bucket_usage first: drop the unique key, the FK, the bucket_id
  // column, then widen-back the numeric columns.
  await knex.raw('DROP INDEX IF EXISTS bucket_usage_tenant_bucket_period_uidx');
  await knex.raw(`
    ALTER TABLE bucket_usage
    DROP CONSTRAINT IF EXISTS bucket_usage_bucket_id_fk
  `);

  const hasBucketId = await knex.schema.hasColumn('bucket_usage', 'bucket_id');
  if (hasBucketId) {
    await knex.schema.table('bucket_usage', (table) => {
      table.dropColumn('bucket_id');
    });
  }

  const usageCitusDistributed = await isCitusDistributed(knex, 'bucket_usage');
  if (usageCitusDistributed) {
    await knex.raw(`
      SELECT * FROM run_command_on_shards(
        'bucket_usage',
        $$ALTER TABLE %s ALTER COLUMN minutes_used TYPE BIGINT USING minutes_used::BIGINT;
          ALTER TABLE %s ALTER COLUMN overage_minutes TYPE BIGINT USING overage_minutes::BIGINT$$
      )
    `);
    await knex.raw(`
      UPDATE pg_attribute
      SET atttypid = 'int8'::regtype::oid,
          atttypmod = -1
      WHERE attrelid = 'bucket_usage'::regclass
        AND attname IN ('minutes_used', 'overage_minutes')
    `);
  } else {
    await knex.schema.alterTable('bucket_usage', (table) => {
      table.bigInteger('minutes_used').notNullable().alter();
      table.bigInteger('overage_minutes').notNullable().alter();
    });
  }

  // Drop membership before pools (FK order), pools after.
  await knex.schema.dropTableIfExists('contract_line_bucket_services');
  await knex.schema.dropTableIfExists('contract_line_buckets');

  // The archive is deliberately NOT dropped. It holds usage rows this migration
  // moved out of bucket_usage, and `down` has no way to decide where they should
  // land back — the pool that would have received them no longer exists. Leaving
  // it is the only option that does not destroy data; a re-`up` re-uses it, and
  // an operator who has reconciled the rows can drop it by hand.
  //
  // This also covers the down/up round trip: usage accrued after the migration
  // against a pool created in the new UI has no legacy config behind it, so a
  // re-`up` finds it unmappable. It is archived rather than lost.
};
