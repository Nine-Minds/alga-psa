'use strict';

/**
 * Contract quantity & usage semantics — explicit intent storage.
 *
 * Plan: ee/docs/plans/2026-09-04-contract-quantity-and-usage-semantics/.
 *
 * Three additive, semantics-preserving additions:
 *
 * 1. Usage measurement mode on the per-service usage configuration
 *    (contract_line_service_usage_config.measurement_mode):
 *      - 'additive'      — dated consumption entries; each entry is billed
 *                          separately and minimums/tiers apply per entry. This
 *                          is the legacy behaviour, so every existing row
 *                          resolves here.
 *      - 'period_total'  — one replaceable count per service period; the count
 *                          is billed once and minimums/tiers apply once.
 *    A NULL/legacy row is never reinterpreted: existing rows are backfilled to
 *    'additive' because that is the semantics record-driven usage billing has
 *    always had. No billable quantity is created by this backfill.
 *
 * 2. Fixed pricing basis on the per-service fixed configuration
 *    (contract_line_service_fixed_config.pricing_basis):
 *      - 'bundle'  — the existing fixed bundle: a line-level total is
 *                    authoritative and member services are allocations. This
 *                    is the legacy behaviour; NULL rows are left NULL and read
 *                    as bundle so nothing changes.
 *      - 'unit'    — recurring seats/units: each unit-priced member bills
 *                    quantity × unit rate with no hidden line-total
 *                    precedence and no `|| 1` fallback (zero means zero).
 *
 * 3. Two dedicated typed stores:
 *      - usage_period_totals             — one logical period total per
 *        (tenant, client, contract line, service configuration, canonical
 *        service-period boundary). DB-enforced uniqueness makes "save 10 then
 *        edit to 12" a replacement (never 22); the unique boundary key survives
 *        recurring-service-period row regeneration because it is stored as
 *        dates, not as a generated record id. lifecycle_state 'billed' makes
 *        invoiced totals immutable.
 *      - contract_line_unit_pricing_revisions — prospective quantity/unit-rate
 *        versions for unit-priced Fixed lines, keyed by an effective service-
 *        period boundary. Earlier periods are never rewritten; a revision only
 *        affects periods whose covered start is at/after its effective date.
 *
 * Schema rollout creates zero billable data.
 */

const TABLES = {
  usagePeriodTotals: 'usage_period_totals',
  unitPricingRevisions: 'contract_line_unit_pricing_revisions',
};

const hasColumn = async (knex, tableName, columnName) => {
  try {
    return await knex.schema.hasColumn(tableName, columnName);
  } catch {
    return false;
  }
};

const hasConstraint = async (knex, tableName, constraintName) => {
  const result = await knex.raw(
    `SELECT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = ? AND conrelid = ?::regclass
    ) AS present`,
    [constraintName, tableName],
  );
  return Boolean(result.rows?.[0]?.present);
};

// Distribute a tenant-scoped table by tenant when running on a Citus cluster.
// No-op on plain Postgres (the function does not exist there).
async function distributeIfCitus(knex, tableName) {
  const citusFn = await knex.raw(
    `SELECT EXISTS (
      SELECT 1 FROM pg_proc WHERE proname = 'create_distributed_table'
    ) AS exists;`,
  );
  if (citusFn.rows?.[0]?.exists) {
    const alreadyDistributed = await knex.raw(
      `SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition
        WHERE logicalrelid = '${tableName}'::regclass
      ) AS is_distributed;`,
    );
    if (!alreadyDistributed.rows?.[0]?.is_distributed) {
      await knex.raw(`SELECT create_distributed_table('${tableName}', 'tenant')`);
    }
  }
}

exports.up = async function up(knex) {
  // 1. Usage measurement mode — legacy-compatible default 'additive'.
  if (await knex.schema.hasTable('contract_line_service_usage_config')) {
    if (!(await hasColumn(knex, 'contract_line_service_usage_config', 'measurement_mode'))) {
      await knex.raw(`
        ALTER TABLE contract_line_service_usage_config
        ADD COLUMN measurement_mode text NOT NULL DEFAULT 'additive'
      `);
    }
    const usageCheck = 'contract_line_service_usage_config_measurement_mode_check';
    if (!(await hasConstraint(knex, 'contract_line_service_usage_config', usageCheck))) {
      await knex.raw(`
        ALTER TABLE contract_line_service_usage_config
        ADD CONSTRAINT ${usageCheck}
        CHECK (measurement_mode IN ('additive', 'period_total'))
      `);
    }
  }

  // 2. Fixed pricing basis — legacy rows stay NULL and read as bundle.
  if (await knex.schema.hasTable('contract_line_service_fixed_config')) {
    if (!(await hasColumn(knex, 'contract_line_service_fixed_config', 'pricing_basis'))) {
      await knex.raw(`
        ALTER TABLE contract_line_service_fixed_config
        ADD COLUMN pricing_basis text
      `);
    }
    const fixedCheck = 'contract_line_service_fixed_config_pricing_basis_check';
    if (!(await hasConstraint(knex, 'contract_line_service_fixed_config', fixedCheck))) {
      await knex.raw(`
        ALTER TABLE contract_line_service_fixed_config
        ADD CONSTRAINT ${fixedCheck}
        CHECK (pricing_basis IS NULL OR pricing_basis IN ('unit', 'bundle'))
      `);
    }
  }

  // 3a. usage_period_totals
  if (!(await knex.schema.hasTable(TABLES.usagePeriodTotals))) {
    await knex.schema.createTable(TABLES.usagePeriodTotals, (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('period_total_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
      table.uuid('client_id').notNullable();
      table.uuid('client_contract_line_id').notNullable();
      table.uuid('service_id').notNullable();
      table.uuid('config_id').notNullable();
      table.date('period_start').notNullable();
      table.date('period_end').notNullable();
      table.integer('quantity').notNullable();
      table.integer('revision').notNullable().defaultTo(1);
      table.text('request_id');
      table.text('lifecycle_state').notNullable().defaultTo('recorded');
      table.uuid('invoice_id');
      table.uuid('invoice_charge_id');
      table.timestamp('consumed_at', { useTz: true });
      table.text('created_by');
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
      table.primary(['tenant', 'period_total_id']);
    });

    // One logical total per tenant, client assignment, contract line, service
    // configuration, and canonical service-period boundary (stored as dates so
    // a regenerated recurring_service_periods row id cannot fork the total).
    await knex.raw(`
      ALTER TABLE ${TABLES.usagePeriodTotals}
      ADD CONSTRAINT usage_period_totals_logical_unique
      UNIQUE (tenant, client_id, client_contract_line_id, service_id, config_id, period_start, period_end)
    `);

    // Request-id replay protection: an identical replay must be recognizable
    // (partial unique index on non-null request ids).
    await knex.raw(`
      CREATE UNIQUE INDEX usage_period_totals_request_id_unique
      ON ${TABLES.usagePeriodTotals} (tenant, request_id)
      WHERE request_id IS NOT NULL
    `);

    // Quantity is a whole number and zero is a valid explicit report; negative
    // values are a caller error, never a credit on a usage period.
    await knex.raw(`
      ALTER TABLE ${TABLES.usagePeriodTotals}
      ADD CONSTRAINT usage_period_totals_quantity_check CHECK (quantity >= 0)
    `);
    await knex.raw(`
      ALTER TABLE ${TABLES.usagePeriodTotals}
      ADD CONSTRAINT usage_period_totals_lifecycle_check
      CHECK (lifecycle_state IN ('recorded', 'billed'))
    `);
    await knex.raw(`
      ALTER TABLE ${TABLES.usagePeriodTotals}
      ADD CONSTRAINT usage_period_totals_period_check CHECK (period_end >= period_start)
    `);

    await distributeIfCitus(knex, TABLES.usagePeriodTotals);
  }

  // 3b. contract_line_unit_pricing_revisions
  if (!(await knex.schema.hasTable(TABLES.unitPricingRevisions))) {
    await knex.schema.createTable(TABLES.unitPricingRevisions, (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('revision_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
      table.uuid('contract_line_id').notNullable();
      table.uuid('service_id').notNullable();
      table.uuid('config_id').notNullable();
      table.integer('quantity').notNullable();
      table.bigint('unit_rate_cents').notNullable();
      table.date('effective_period_start').notNullable();
      table.text('created_by');
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.primary(['tenant', 'revision_id']);
    });

    // At most one prospective version per service and effective boundary.
    await knex.raw(`
      ALTER TABLE ${TABLES.unitPricingRevisions}
      ADD CONSTRAINT contract_line_unit_pricing_revisions_effective_unique
      UNIQUE (tenant, contract_line_id, service_id, config_id, effective_period_start)
    `);
    await knex.raw(`
      ALTER TABLE ${TABLES.unitPricingRevisions}
      ADD CONSTRAINT contract_line_unit_pricing_revisions_quantity_check CHECK (quantity >= 0)
    `);
    await knex.raw(`
      ALTER TABLE ${TABLES.unitPricingRevisions}
      ADD CONSTRAINT contract_line_unit_pricing_revisions_rate_check CHECK (unit_rate_cents >= 0)
    `);

    await distributeIfCitus(knex, TABLES.unitPricingRevisions);
  }
};

exports.down = async function down(knex) {
  // Dropping the typed stores is safe: they are additive and never populated
  // by this migration itself.
  await knex.schema.dropTableIfExists(TABLES.unitPricingRevisions);
  await knex.schema.dropTableIfExists(TABLES.usagePeriodTotals);

  if (await knex.schema.hasTable('contract_line_service_fixed_config')) {
    const fixedCheck = 'contract_line_service_fixed_config_pricing_basis_check';
    if (await hasConstraint(knex, 'contract_line_service_fixed_config', fixedCheck)) {
      await knex.raw(`ALTER TABLE contract_line_service_fixed_config DROP CONSTRAINT ${fixedCheck}`);
    }
    if (await hasColumn(knex, 'contract_line_service_fixed_config', 'pricing_basis')) {
      await knex.schema.alterTable('contract_line_service_fixed_config', (t) => {
        t.dropColumn('pricing_basis');
      });
    }
  }

  if (await knex.schema.hasTable('contract_line_service_usage_config')) {
    const usageCheck = 'contract_line_service_usage_config_measurement_mode_check';
    if (await hasConstraint(knex, 'contract_line_service_usage_config', usageCheck)) {
      await knex.raw(`ALTER TABLE contract_line_service_usage_config DROP CONSTRAINT ${usageCheck}`);
    }
    if (await hasColumn(knex, 'contract_line_service_usage_config', 'measurement_mode')) {
      await knex.schema.alterTable('contract_line_service_usage_config', (t) => {
        t.dropColumn('measurement_mode');
      });
    }
  }
};

// ALTER TABLE ... ADD COLUMN / ADD CONSTRAINT on Citus-distributed tables must
// not run inside a transaction. CREATE TABLE + raw DDL is likewise kept out.
exports.config = { transaction: false };
