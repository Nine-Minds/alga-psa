'use strict';

/**
 * Adjustment provenance for contract invoice lines.
 *
 * Operators can add one-time charges, discounts and adjustments to an editable
 * contract draft, and the billing engine can settle configured automatic
 * discounts or contract-change true-ups on the same invoice. Every
 * automatic line keeps a stable link back to its source so draft refresh can
 * reconcile it in place (idempotent regeneration) instead of duplicating it.
 *
 * Columns are nullable and additive:
 *   adjustment_source_kind    'discount' | 'contract_change' | 'manual_adjustment'
 *   adjustment_source_id      stable source id (discount id / change id)
 *   adjustment_source_revision monotonically increasing source revision
 *   adjustment_scope          'invoice' | 'contract' | 'service' | 'item'
 *   adjustment_base_amount    eligible base the amount was derived from (minor units)
 *   adjustment_reason         operator/system-facing calculation reason
 *   manual_line_metadata      partial-period inputs and similar authoring facts
 *
 * Automatic lines are `is_manual = false`; operator-created lines keep
 * `is_manual = true` even when they reference a contract or service.
 */

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
    [constraintName, tableName]
  );
  return Boolean(result.rows?.[0]?.present);
};

async function addColumnIfMissing(knex, tableName, columnName, addColumn) {
  if (!(await hasColumn(knex, tableName, columnName))) {
    await knex.schema.alterTable(tableName, addColumn);
  }
}

exports.up = async function up(knex) {
  await addColumnIfMissing(knex, 'invoice_charges', 'adjustment_source_kind', (table) => {
    table.text('adjustment_source_kind').nullable();
  });
  await addColumnIfMissing(knex, 'invoice_charges', 'adjustment_source_id', (table) => {
    table.text('adjustment_source_id').nullable();
  });
  await addColumnIfMissing(knex, 'invoice_charges', 'adjustment_source_revision', (table) => {
    table.integer('adjustment_source_revision').nullable();
  });
  await addColumnIfMissing(knex, 'invoice_charges', 'adjustment_scope', (table) => {
    table.text('adjustment_scope').nullable();
  });
  await addColumnIfMissing(knex, 'invoice_charges', 'adjustment_base_amount', (table) => {
    table.bigInteger('adjustment_base_amount').nullable();
  });
  await addColumnIfMissing(knex, 'invoice_charges', 'adjustment_reason', (table) => {
    table.text('adjustment_reason').nullable();
  });
  await addColumnIfMissing(knex, 'invoice_charges', 'manual_line_metadata', (table) => {
    table.jsonb('manual_line_metadata').nullable();
  });

  if (!(await hasConstraint(knex, 'invoice_charges', 'invoice_charges_adjustment_source_kind_check'))) {
    await knex.raw(`
      ALTER TABLE invoice_charges
      ADD CONSTRAINT invoice_charges_adjustment_source_kind_check
      CHECK (adjustment_source_kind IS NULL OR adjustment_source_kind IN
        ('discount', 'contract_change', 'manual_adjustment'))
    `);
  }

  if (!(await hasConstraint(knex, 'invoice_charges', 'invoice_charges_adjustment_scope_check'))) {
    await knex.raw(`
      ALTER TABLE invoice_charges
      ADD CONSTRAINT invoice_charges_adjustment_scope_check
      CHECK (adjustment_scope IS NULL OR adjustment_scope IN
        ('invoice', 'contract', 'service', 'item'))
    `);
  }

  // Draft refresh reconciles automatic lines by (tenant, invoice, source kind,
  // source id). A UNIQUE partial index both keeps that lookup cheap and makes
  // the logical settlement identity a database invariant: a concurrent or
  // repeated generation/refresh cannot insert a second settlement for the same
  // source. The predicate excludes manual rows, which carry no source id, and
  // tenant is included so the index is valid on Citus-distributed tables.
  const indexExists = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public' AND indexname = 'idx_invoice_charges_adjustment_source'
    ) AS present
  `);
  if (!indexExists.rows?.[0]?.present) {
    await knex.raw(`
      CREATE UNIQUE INDEX idx_invoice_charges_adjustment_source
      ON invoice_charges (tenant, invoice_id, adjustment_source_kind, adjustment_source_id)
      WHERE adjustment_source_kind IS NOT NULL AND adjustment_source_id IS NOT NULL
    `);
  }
};

exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS idx_invoice_charges_adjustment_source');

  for (const constraint of [
    'invoice_charges_adjustment_source_kind_check',
    'invoice_charges_adjustment_scope_check',
  ]) {
    if (await hasConstraint(knex, 'invoice_charges', constraint)) {
      await knex.raw(`ALTER TABLE invoice_charges DROP CONSTRAINT ${constraint}`);
    }
  }

  for (const column of [
    'adjustment_source_kind',
    'adjustment_source_id',
    'adjustment_source_revision',
    'adjustment_scope',
    'adjustment_base_amount',
    'adjustment_reason',
    'manual_line_metadata',
  ]) {
    if (await hasColumn(knex, 'invoice_charges', column)) {
      await knex.schema.alterTable('invoice_charges', (table) => {
        table.dropColumn(column);
      });
    }
  }
};
