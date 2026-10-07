'use strict';

/**
 * Recurring contract product quantity & price scheduling — revision policy.
 *
 * Plan: docs/plans/2026-09-22-contract-products-quantity-price-changes-plan.md.
 *
 * Extends the existing prospective revision store
 * (contract_line_unit_pricing_revisions) rather than introducing a product-only
 * revision system, so products and explicitly unit-priced Fixed services share
 * one scheduling, boundary, history and billing contract:
 *
 *  - price_policy  — 'override' (an explicit unit rate, possibly 0) or
 *                    'catalog' (follow the currency/period-effective catalog
 *                    price). Existing rows are 'override', preserving their
 *                    numeric rate behavior.
 *  - unit_rate_cents becomes nullable: catalog policy stores no rate and
 *                    resolves the catalog `service_prices` row at billing time.
 *  - version       — optimistic-concurrency token. Same-boundary edits that
 *                    supply an expected version must match or are rejected.
 *  - updated_by / updated_at — attribution for the latest replacement.
 *
 * Superseded pending edits are recorded in
 * contract_line_unit_pricing_revision_history so replacing a scheduled boundary
 * never silently loses who changed what. The canonical row stays the single
 * source the billing engine reads; history rows are append-only audit.
 *
 * Additive and data-preserving: no billable data is created and untouched
 * contracts bill exactly as before.
 */

const REVISIONS = 'contract_line_unit_pricing_revisions';
const HISTORY = 'contract_line_unit_pricing_revision_history';

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
  if (!(await knex.schema.hasTable(REVISIONS))) {
    return;
  }

  // 1. Explicit price policy — legacy numeric rows keep explicit overrides.
  if (!(await hasColumn(knex, REVISIONS, 'price_policy'))) {
    await knex.raw(`
      ALTER TABLE ${REVISIONS}
      ADD COLUMN price_policy text NOT NULL DEFAULT 'override'
    `);
  }
  const policyCheck = 'contract_line_unit_pricing_revisions_price_policy_check';
  if (!(await hasConstraint(knex, REVISIONS, policyCheck))) {
    await knex.raw(`
      ALTER TABLE ${REVISIONS}
      ADD CONSTRAINT ${policyCheck}
      CHECK (price_policy IN ('override', 'catalog'))
    `);
  }

  // 2. Catalog policy carries no rate; the rate check already tolerates NULL.
  await knex.raw(`
    ALTER TABLE ${REVISIONS}
    ALTER COLUMN unit_rate_cents DROP NOT NULL
  `);

  // 3. Concurrency token + attribution.
  if (!(await hasColumn(knex, REVISIONS, 'version'))) {
    await knex.raw(`
      ALTER TABLE ${REVISIONS}
      ADD COLUMN version integer NOT NULL DEFAULT 1
    `);
  }
  if (!(await hasColumn(knex, REVISIONS, 'updated_by'))) {
    await knex.raw(`ALTER TABLE ${REVISIONS} ADD COLUMN updated_by text`);
  }
  if (!(await hasColumn(knex, REVISIONS, 'updated_at'))) {
    await knex.raw(`
      ALTER TABLE ${REVISIONS}
      ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now()
    `);
  }
  const versionCheck = 'contract_line_unit_pricing_revisions_version_check';
  if (!(await hasConstraint(knex, REVISIONS, versionCheck))) {
    await knex.raw(`
      ALTER TABLE ${REVISIONS}
      ADD CONSTRAINT ${versionCheck} CHECK (version >= 1)
    `);
  }

  // 4. Append-only audit of superseded pending edits.
  if (!(await knex.schema.hasTable(HISTORY))) {
    await knex.schema.createTable(HISTORY, (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('history_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
      table.uuid('revision_id').notNullable();
      table.uuid('contract_line_id').notNullable();
      table.uuid('service_id').notNullable();
      table.uuid('config_id').notNullable();
      table.integer('quantity').notNullable();
      table.bigint('unit_rate_cents');
      table.text('price_policy').notNullable().defaultTo('override');
      table.date('effective_period_start').notNullable();
      table.integer('version').notNullable();
      table.text('superseded_by').notNullable();
      table.text('recorded_by');
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.primary(['tenant', 'history_id']);
    });

    await knex.raw(`
      ALTER TABLE ${HISTORY}
      ADD CONSTRAINT ${HISTORY}_price_policy_check
      CHECK (price_policy IN ('override', 'catalog'))
    `);
    await knex.raw(`
      ALTER TABLE ${HISTORY}
      ADD CONSTRAINT ${HISTORY}_quantity_check CHECK (quantity >= 0)
    `);
    await knex.raw(`
      CREATE INDEX ${HISTORY}_canonical_idx
      ON ${HISTORY} (tenant, revision_id, created_at DESC)
    `);

    await distributeIfCitus(knex, HISTORY);
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists(HISTORY);

  if (await knex.schema.hasTable(REVISIONS)) {
    const versionCheck = 'contract_line_unit_pricing_revisions_version_check';
    if (await hasConstraint(knex, REVISIONS, versionCheck)) {
      await knex.raw(`ALTER TABLE ${REVISIONS} DROP CONSTRAINT ${versionCheck}`);
    }
    const policyCheck = 'contract_line_unit_pricing_revisions_price_policy_check';
    if (await hasConstraint(knex, REVISIONS, policyCheck)) {
      await knex.raw(`ALTER TABLE ${REVISIONS} DROP CONSTRAINT ${policyCheck}`);
    }
    for (const column of ['updated_at', 'updated_by', 'version', 'price_policy']) {
      if (await hasColumn(knex, REVISIONS, column)) {
        await knex.schema.alterTable(REVISIONS, (t) => t.dropColumn(column));
      }
    }
    // Restore the legacy NOT NULL only when no catalog rows remain.
    await knex.raw(`
      ALTER TABLE ${REVISIONS}
      ALTER COLUMN unit_rate_cents SET NOT NULL
    `);
  }
};

// ALTER TABLE ... ADD COLUMN / ADD CONSTRAINT on Citus-distributed tables must
// not run inside a transaction. CREATE TABLE + raw DDL is likewise kept out.
exports.config = { transaction: false };
