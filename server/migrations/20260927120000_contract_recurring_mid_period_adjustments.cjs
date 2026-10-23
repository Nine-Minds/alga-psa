'use strict';

/**
 * Mid-period recurring-unit quantity true-ups.
 *
 * Plan: docs/plans/2026-09-22-contract-products-quantity-price-changes-plan.md
 * (amended 2026-09-27 with the approved opt-in mid-period policy).
 *
 * Boundary-only scheduling stays the default. When an operator explicitly opts
 * in, a recurring product / unit-priced Fixed service may change quantity
 * effective *inside* an eligible unbilled service period. The canonical
 * revision keeps `effective_period_start` at the next canonical boundary (the
 * new standing quantity begins there); `mid_period_effective_date` records the
 * true date the quantity changed so one prorated true-up can be derived.
 *
 * This migration is additive and data-preserving:
 *
 *  - contract_line_unit_pricing_revisions.mid_period_effective_date (nullable)
 *  - contract_line_unit_pricing_revision_history.mid_period_effective_date
 *  - invoice_charges adjustment provenance columns (idempotent; shared with the
 *    contract-invoice-adjustments companion, so a merge is a no-op)
 *  - contract_recurring_unit_adjustments — the durable pending/settled ledger
 *    that lets exactly one source-linked true-up reconcile onto the next
 *    eligible editable draft without duplicating on regeneration.
 *
 * No billable data is created and untouched contracts bill exactly as before.
 */

const REVISIONS = 'contract_line_unit_pricing_revisions';
const HISTORY = 'contract_line_unit_pricing_revision_history';
const ADJUSTMENTS = 'contract_recurring_unit_adjustments';
const CHARGES = 'invoice_charges';

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

const hasIndex = async (knex, indexName) => {
  const result = await knex.raw(
    `SELECT EXISTS (
      SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = ?
    ) AS present`,
    [indexName],
  );
  return Boolean(result.rows?.[0]?.present);
};

async function addColumnIfMissing(knex, tableName, columnName, addColumn) {
  if (!(await hasColumn(knex, tableName, columnName))) {
    await knex.schema.alterTable(tableName, addColumn);
  }
}

async function distributeIfCitus(knex, tableName) {
  const citusFn = await knex.raw(
    `SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'create_distributed_table') AS exists;`,
  );
  if (citusFn.rows?.[0]?.exists) {
    const alreadyDistributed = await knex.raw(
      `SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition WHERE logicalrelid = '${tableName}'::regclass
      ) AS is_distributed;`,
    );
    if (!alreadyDistributed.rows?.[0]?.is_distributed) {
      await knex.raw(`SELECT create_distributed_table('${tableName}', 'tenant')`);
    }
  }
}

exports.up = async function up(knex) {
  // 1. True mid-period effective date alongside the canonical boundary.
  if (await knex.schema.hasTable(REVISIONS)) {
    await addColumnIfMissing(knex, REVISIONS, 'mid_period_effective_date', (table) => {
      table.date('mid_period_effective_date').nullable();
    });
  }
  if (await knex.schema.hasTable(HISTORY)) {
    await addColumnIfMissing(knex, HISTORY, 'mid_period_effective_date', (table) => {
      table.date('mid_period_effective_date').nullable();
    });
  }

  // 2. Adjustment provenance on invoice charges (idempotent across the
  //    companion's identical migration).
  if (await knex.schema.hasTable(CHARGES)) {
    await addColumnIfMissing(knex, CHARGES, 'adjustment_source_kind', (table) => {
      table.text('adjustment_source_kind').nullable();
    });
    await addColumnIfMissing(knex, CHARGES, 'adjustment_source_id', (table) => {
      table.text('adjustment_source_id').nullable();
    });
    await addColumnIfMissing(knex, CHARGES, 'adjustment_source_revision', (table) => {
      table.integer('adjustment_source_revision').nullable();
    });
    await addColumnIfMissing(knex, CHARGES, 'adjustment_scope', (table) => {
      table.text('adjustment_scope').nullable();
    });
    await addColumnIfMissing(knex, CHARGES, 'adjustment_base_amount', (table) => {
      table.bigInteger('adjustment_base_amount').nullable();
    });
    await addColumnIfMissing(knex, CHARGES, 'adjustment_reason', (table) => {
      table.text('adjustment_reason').nullable();
    });
    await addColumnIfMissing(knex, CHARGES, 'adjustment_period_start', (table) => {
      table.date('adjustment_period_start').nullable();
    });
    await addColumnIfMissing(knex, CHARGES, 'adjustment_period_end', (table) => {
      table.date('adjustment_period_end').nullable();
    });
    await addColumnIfMissing(knex, CHARGES, 'manual_line_metadata', (table) => {
      table.jsonb('manual_line_metadata').nullable();
    });

    if (!(await hasConstraint(knex, CHARGES, 'invoice_charges_adjustment_source_kind_check'))) {
      await knex.raw(`
        ALTER TABLE ${CHARGES}
        ADD CONSTRAINT invoice_charges_adjustment_source_kind_check
        CHECK (adjustment_source_kind IS NULL OR adjustment_source_kind IN
          ('discount', 'contract_change', 'manual_adjustment'))
      `);
    }
    if (!(await hasConstraint(knex, CHARGES, 'invoice_charges_adjustment_scope_check'))) {
      await knex.raw(`
        ALTER TABLE ${CHARGES}
        ADD CONSTRAINT invoice_charges_adjustment_scope_check
        CHECK (adjustment_scope IS NULL OR adjustment_scope IN
          ('invoice', 'contract', 'service', 'item'))
      `);
    }

    // One automatic settlement per (invoice, source kind, source id). Generation
    // and draft refresh reconcile in place; a repeat cannot insert a second row.
    if (!(await hasIndex(knex, 'idx_invoice_charges_adjustment_source'))) {
      await knex.raw(`
        CREATE UNIQUE INDEX idx_invoice_charges_adjustment_source
        ON ${CHARGES} (tenant, invoice_id, adjustment_source_kind, adjustment_source_id)
        WHERE adjustment_source_kind IS NOT NULL AND adjustment_source_id IS NOT NULL
      `);
    }
    if (!(await hasIndex(knex, 'idx_invoice_charges_adjustment_period'))) {
      await knex.raw(`
        CREATE INDEX idx_invoice_charges_adjustment_period
        ON ${CHARGES} (tenant, invoice_id, adjustment_source_kind, adjustment_period_start)
        WHERE adjustment_source_kind IS NOT NULL
      `);
    }
  }

  // 3. Durable pending/settled true-up ledger.
  if (!(await knex.schema.hasTable(ADJUSTMENTS))) {
    await knex.schema.createTable(ADJUSTMENTS, (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('adjustment_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
      table.uuid('contract_line_id').notNullable();
      table.uuid('service_id').notNullable();
      table.uuid('config_id').notNullable();
      table.uuid('contract_id').nullable();
      table.uuid('client_contract_id').nullable();
      table.uuid('client_id').nullable();
      table.text('currency_code').notNullable().defaultTo('USD');
      // Source identity: revision id plus version.
      table.uuid('revision_id').notNullable();
      table.integer('revision_version').notNullable();
      // Affected canonical period, half-open [start, end).
      table.date('adjustment_period_start').notNullable();
      table.date('adjustment_period_end').notNullable();
      table.date('mid_period_effective_date').notNullable();
      table.integer('previous_quantity').notNullable();
      table.integer('new_quantity').notNullable();
      table.integer('quantity_delta').notNullable();
      table.bigint('unit_rate_cents').notNullable();
      table.integer('covered_days').notNullable();
      table.integer('full_period_days').notNullable();
      // Signed: positive charge, negative credit.
      table.bigint('amount_cents').notNullable();
      table.text('price_policy').notNullable().defaultTo('override');
      table.text('reason').notNullable();
      table.text('status').notNullable().defaultTo('pending');
      table.uuid('settled_invoice_id').nullable();
      table.uuid('settled_charge_id').nullable();
      table.timestamp('settled_at', { useTz: true }).nullable();
      table.text('created_by');
      table.text('updated_by');
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
      table.primary(['tenant', 'adjustment_id']);
    });

    // Exactly one live adjustment per canonical revision: replacing a pending
    // version updates it in place instead of leaving duplicate billable rows.
    await knex.raw(`
      ALTER TABLE ${ADJUSTMENTS}
      ADD CONSTRAINT contract_recurring_unit_adjustments_revision_unique
      UNIQUE (tenant, revision_id)
    `);
    await knex.raw(`
      ALTER TABLE ${ADJUSTMENTS}
      ADD CONSTRAINT contract_recurring_unit_adjustments_status_check
      CHECK (status IN ('pending', 'settled', 'cancelled'))
    `);
    await knex.raw(`
      ALTER TABLE ${ADJUSTMENTS}
      ADD CONSTRAINT contract_recurring_unit_adjustments_days_check
      CHECK (full_period_days > 0 AND covered_days >= 0 AND covered_days <= full_period_days)
    `);
    await knex.raw(`
      ALTER TABLE ${ADJUSTMENTS}
      ADD CONSTRAINT contract_recurring_unit_adjustments_period_check
      CHECK (adjustment_period_end > adjustment_period_start)
    `);
    await knex.raw(`
      CREATE INDEX contract_recurring_unit_adjustments_line_idx
      ON ${ADJUSTMENTS} (tenant, contract_line_id, status)
    `);

    await distributeIfCitus(knex, ADJUSTMENTS);
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists(ADJUSTMENTS);

  if (await knex.schema.hasTable(CHARGES)) {
    if (await hasIndex(knex, 'idx_invoice_charges_adjustment_period')) {
      await knex.raw('DROP INDEX IF EXISTS idx_invoice_charges_adjustment_period');
    }
    if (await hasIndex(knex, 'idx_invoice_charges_adjustment_source')) {
      await knex.raw('DROP INDEX IF EXISTS idx_invoice_charges_adjustment_source');
    }
    for (const constraint of [
      'invoice_charges_adjustment_source_kind_check',
      'invoice_charges_adjustment_scope_check',
    ]) {
      if (await hasConstraint(knex, CHARGES, constraint)) {
        await knex.raw(`ALTER TABLE ${CHARGES} DROP CONSTRAINT ${constraint}`);
      }
    }
    for (const column of [
      'adjustment_source_kind',
      'adjustment_source_id',
      'adjustment_source_revision',
      'adjustment_scope',
      'adjustment_base_amount',
      'adjustment_reason',
      'adjustment_period_start',
      'adjustment_period_end',
      'manual_line_metadata',
    ]) {
      if (await hasColumn(knex, CHARGES, column)) {
        await knex.schema.alterTable(CHARGES, (table) => {
          table.dropColumn(column);
        });
      }
    }
  }

  for (const tableName of [HISTORY, REVISIONS]) {
    if (await knex.schema.hasTable(tableName)) {
      if (await hasColumn(knex, tableName, 'mid_period_effective_date')) {
        await knex.schema.alterTable(tableName, (table) => {
          table.dropColumn('mid_period_effective_date');
        });
      }
    }
  }
};

// Citus: ADD COLUMN / ADD CONSTRAINT / CREATE TABLE with raw DDL must not run
// inside a transaction.
exports.config = { transaction: false };
