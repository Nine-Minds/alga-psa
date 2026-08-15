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
 */

exports.config = { transaction: false };

// Distribute a tenant-scoped table on Citus, colocated with `contract_lines`
// (the same colocation group bucket_usage lives in). No-op on plain Postgres
// and on already-distributed tables.
async function distributeColocatedWithContractLines(knex, tableName) {
  const citusFn = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_proc WHERE proname = 'create_distributed_table'
    ) AS exists;
  `);
  if (!citusFn.rows?.[0]?.exists) return;

  const alreadyDistributed = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_dist_partition
      WHERE logicalrelid = '${tableName}'::regclass
    ) AS is_distributed;
  `);
  if (alreadyDistributed.rows?.[0]?.is_distributed) return;

  await knex.raw(
    `SELECT create_distributed_table('${tableName}', 'tenant', colocate_with => 'contract_lines')`
  );
}

exports.up = async function up(knex) {
  // -------------------------------------------------------------------------
  // 1. contract_line_buckets — the pool
  // -------------------------------------------------------------------------
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

  // Rule inert without a schedule; multipliers strictly positive.
  await knex.raw(`
    ALTER TABLE contract_line_buckets
    ADD CONSTRAINT contract_line_buckets_after_hours_rule_check
    CHECK (
      after_hours_multiplier IS NULL OR business_hours_schedule_id IS NOT NULL
    )
  `);
  await knex.raw(`
    ALTER TABLE contract_line_buckets
    ADD CONSTRAINT contract_line_buckets_after_hours_multiplier_check
    CHECK (after_hours_multiplier IS NULL OR after_hours_multiplier > 0)
  `);
  // At most one catch-all bucket per contract line.
  await knex.raw(`
    CREATE UNIQUE INDEX contract_line_buckets_one_catch_all_uidx
    ON contract_line_buckets (tenant, contract_line_id)
    WHERE covers_all_services
  `);

  // -------------------------------------------------------------------------
  // 2. contract_line_bucket_services — membership + per-service multiplier
  // -------------------------------------------------------------------------
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

  await knex.raw(`
    ALTER TABLE contract_line_bucket_services
    ADD CONSTRAINT contract_line_bucket_services_burn_multiplier_check
    CHECK (burn_multiplier > 0)
  `);

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
  await knex.raw(`
    UPDATE bucket_usage bu
    SET bucket_id = psc.config_id
    FROM contract_line_service_configuration psc
    JOIN contract_line_service_bucket_config psbc
      ON psbc.tenant = psc.tenant AND psbc.config_id = psc.config_id
    JOIN client_contracts cc
      ON cc.tenant = psc.tenant
      AND cc.contract_id = (
        SELECT cl.contract_id FROM contract_lines cl
        WHERE cl.tenant = psc.tenant AND cl.contract_line_id = psc.contract_line_id
      )
    WHERE psc.configuration_type = 'Bucket'
      AND bu.tenant = psc.tenant
      AND bu.client_id = cc.client_id
      AND bu.service_catalog_id = psc.service_id
      AND bu.bucket_id IS NULL
  `);

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

  // 3e. FK + NOT NULL on bucket_id. Citus distributed tables need the
  //     run_command_on_shards form for the NOT NULL ALTER.
  const fkExists = await knex.raw(`
    SELECT constraint_name
    FROM information_schema.table_constraints
    WHERE table_name = 'bucket_usage'
      AND constraint_type = 'FOREIGN KEY'
      AND constraint_name = 'bucket_usage_bucket_id_fk'
  `);
  if (fkExists.rows.length === 0) {
    await knex.raw(`
      ALTER TABLE bucket_usage
      ADD CONSTRAINT bucket_usage_bucket_id_fk
      FOREIGN KEY (tenant, bucket_id)
      REFERENCES contract_line_buckets(tenant, bucket_id)
      ON DELETE RESTRICT
    `);
  }

  let isCitusDistributed = false;
  try {
    const probe = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition WHERE logicalrelid = 'bucket_usage'::regclass
      ) AS is_distributed
    `);
    isCitusDistributed = Boolean(probe.rows[0]?.is_distributed);
  } catch {
    // pg_dist_partition does not exist on plain Postgres.
  }
  if (isCitusDistributed) {
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

  // 3f. minutes_used / overage_minutes: bigint -> numeric(12,2) (weighted
  //     minutes are fractional).
  await knex.schema.alterTable('bucket_usage', (table) => {
    table.decimal('minutes_used', 12, 2).notNullable().alter();
    table.decimal('overage_minutes', 12, 2).notNullable().alter();
  });

  // 3g. New unique key — kills the duplicate-period hazard and the
  //     write-under-one-line/read-under-another mismatch.
  const periodUnique = await knex.raw(`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'bucket_usage'
      AND indexname = 'bucket_usage_tenant_bucket_period_uidx'
  `);
  if (periodUnique.rows.length === 0) {
    await knex.raw(`
      CREATE UNIQUE INDEX bucket_usage_tenant_bucket_period_uidx
      ON bucket_usage (tenant, bucket_id, period_start)
    `);
  }

  // -------------------------------------------------------------------------
  // 4. Distribute on Citus (colocated with contract_lines, like bucket_usage).
  // -------------------------------------------------------------------------
  await distributeColocatedWithContractLines(knex, 'contract_line_buckets');
  await distributeColocatedWithContractLines(knex, 'contract_line_bucket_services');
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

  await knex.schema.alterTable('bucket_usage', (table) => {
    table.bigInteger('minutes_used').notNullable().alter();
    table.bigInteger('overage_minutes').notNullable().alter();
  });

  // Drop membership before pools (FK order), pools after.
  await knex.schema.dropTableIfExists('contract_line_bucket_services');
  await knex.schema.dropTableIfExists('contract_line_buckets');
};
