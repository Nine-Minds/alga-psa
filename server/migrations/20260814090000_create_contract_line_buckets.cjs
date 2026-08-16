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
 * Down-migration drops the new tables and the `bucket_usage.bucket_id` column
 * and reverts the numeric types; the frozen legacy tables still describe the
 * old world.
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

  // 3a. One pool per legacy config (member-scoped, no after-hours rule).
  await knex.raw(`
    INSERT INTO contract_line_buckets (
      tenant, bucket_id, contract_line_id, total_minutes, overage_rate,
      allow_rollover, billing_period, covers_all_services
    )
    SELECT
      psc.tenant,
      psc.config_id,
      psc.contract_line_id,
      psbc.total_minutes,
      psbc.overage_rate,
      psbc.allow_rollover,
      psbc.billing_period,
      false
    FROM contract_line_service_configuration psc
    JOIN contract_line_service_bucket_config psbc
      ON psbc.tenant = psc.tenant AND psbc.config_id = psc.config_id
    WHERE psc.configuration_type = 'Bucket'
    ON CONFLICT (tenant, bucket_id) DO NOTHING
  `);

  // 3b. One member row per legacy config at multiplier 1.0.
  await knex.raw(`
    INSERT INTO contract_line_bucket_services (
      tenant, bucket_id, service_id, contract_line_id, burn_multiplier
    )
    SELECT
      psc.tenant,
      psc.config_id,
      psc.service_id,
      psc.contract_line_id,
      1
    FROM contract_line_service_configuration psc
    JOIN contract_line_service_bucket_config psbc
      ON psbc.tenant = psc.tenant AND psbc.config_id = psc.config_id
    WHERE psc.configuration_type = 'Bucket'
    ON CONFLICT (tenant, bucket_id, service_id) DO NOTHING
  `);

  // 3c. Remap existing usage rows to the new pool. The legacy config is unique
  //     per (line, service), and its line's contract identifies the client the
  //     pool serves — match on client via the line's contract + service. This
  //     deliberately keys on client rather than bucket_usage.contract_line_id,
  //     which the old write path was known to populate unreliably (the
  //     write-under-one-line/read-under-another mismatch the rekey kills).
  //
  //     Ambiguity guard: client_contracts is many-to-many (a client may hold
  //     several overlapping assignments on the same line), so a usage row can
  //     match several pools. That would silently pick an arbitrary bucket —
  //     fail loudly instead.
  const ambiguousMatches = await knex.raw(`
    SELECT bu.usage_id, COUNT(DISTINCT psc.config_id) AS pool_count
    FROM bucket_usage bu
    JOIN contract_line_service_configuration psc
      ON psc.tenant = bu.tenant
      AND psc.service_id = bu.service_catalog_id
    JOIN contract_line_service_bucket_config psbc
      ON psbc.tenant = psc.tenant AND psbc.config_id = psc.config_id
    JOIN contract_lines cl
      ON cl.tenant = psc.tenant
      AND cl.contract_line_id = psc.contract_line_id
    JOIN client_contracts cc
      ON cc.tenant = psc.tenant
      AND cc.contract_id = cl.contract_id
    WHERE psc.configuration_type = 'Bucket'
      AND bu.bucket_id IS NULL
      AND bu.client_id = cc.client_id
    GROUP BY bu.usage_id
    HAVING COUNT(DISTINCT psc.config_id) > 1
    LIMIT 5
  `);
  if (ambiguousMatches.rows.length > 0) {
    const sample = ambiguousMatches.rows.map((row) => row.usage_id).join(', ');
    throw new Error(
      `[create_contract_line_buckets] ${ambiguousMatches.rows.length} bucket_usage rows map to multiple legacy Bucket configs ` +
      `(sample usage_ids: ${sample}). A bucket_usage row must belong to exactly one pool; ` +
      'resolve the duplicate client assignments before re-running.'
    );
  }

  // Citus rejects the equivalent UPDATE ... FROM multi-table join even when
  // every join includes the tenant distribution key. Materialize the mapping
  // with the supported SELECT above, then issue distribution-key-qualified
  // point updates against bucket_usage.
  const mappedUsageRows = await knex.raw(`
    SELECT DISTINCT bu.tenant, bu.usage_id, psc.config_id AS bucket_id
    FROM bucket_usage bu
    JOIN contract_line_service_configuration psc
      ON psc.tenant = bu.tenant
      AND psc.service_id = bu.service_catalog_id
    JOIN contract_line_service_bucket_config psbc
      ON psbc.tenant = psc.tenant AND psbc.config_id = psc.config_id
    JOIN contract_lines cl
      ON cl.tenant = psc.tenant
      AND cl.contract_line_id = psc.contract_line_id
    JOIN client_contracts cc
      ON cc.tenant = psc.tenant
      AND cc.contract_id = cl.contract_id
    WHERE psc.configuration_type = 'Bucket'
      AND bu.bucket_id IS NULL
      AND bu.client_id = cc.client_id
  `);

  for (const row of mappedUsageRows.rows) {
    await knex('bucket_usage')
      .where({ tenant: row.tenant, usage_id: row.usage_id })
      .whereNull('bucket_id')
      .update({ bucket_id: row.bucket_id });
  }

  // 3d. Guard: any usage row left unmapped means data the new keying cannot
  //     serve. Fail the migration loudly rather than ship an orphan (a row
  //     whose (line, service) has no legacy Bucket config was never billable
  //     under the old schema either — the invoice read filtered on the
  //     config — so this surfaces real corruption for a human decision).
  const unmapped = await knex('bucket_usage').whereNull('bucket_id').count('* as count');
  if (Number(unmapped[0].count) > 0) {
    throw new Error(
      `[create_contract_line_buckets] ${unmapped[0].count} bucket_usage rows have no legacy ` +
      'Bucket config to remap to (client via the line\'s contract + service_catalog_id). ' +
      'Refusing to continue with orphaned usage rows.'
    );
  }

  // 3e. Pre-check the new unique key against duplicate (bucket_id, period_start)
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

  // 3f. FK + NOT NULL on bucket_id. Citus distributed tables need the
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

  // 3g. minutes_used / overage_minutes: bigint -> numeric(12,2) (weighted
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

  // 3h. New unique key — kills the duplicate-period hazard and the
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
};
