'use strict';

/**
 * Settlement support for contract invoice adjustments.
 *
 * Builds on 20260923000000_add_adjustment_provenance_to_invoice_charges:
 *
 *  - discounts.scope / scope_service_id / applies_to_item_id / priority — an
 *    explicit eligible scope for a configured automatic discount. Null scope
 *    preserves the legacy invoice-wide behavior (the link to a contract line
 *    stays an eligibility trigger, never an implicit narrowing).
 *  - invoice_charges.adjustment_period_start / _end — the service period an
 *    automatic discount settlement was stamped for, so the customer-facing line
 *    and later reconciliation keep the affected period.
 *  - invoices.draft_adjustment_revision — monotonic token bumped by every
 *    manual adjustment save; the client sends the revision it edited and a
 *    stale one is rejected instead of silently overwriting newer edits.
 *  - invoice_adjustment_operations — server-side idempotency ledger for manual
 *    submits: replaying the same operation_id returns the already-applied
 *    result instead of appending rows twice.
 *
 * Additive and nullable; no billable data is rewritten.
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
  // --- Explicit discount scope (nullable => legacy invoice-wide) ---
  await addColumnIfMissing(knex, 'discounts', 'scope', (table) => {
    table.text('scope').nullable();
  });
  await addColumnIfMissing(knex, 'discounts', 'scope_service_id', (table) => {
    table.uuid('scope_service_id').nullable();
  });
  await addColumnIfMissing(knex, 'discounts', 'applies_to_item_id', (table) => {
    table.uuid('applies_to_item_id').nullable();
  });
  await addColumnIfMissing(knex, 'discounts', 'priority', (table) => {
    table.integer('priority').nullable();
  });
  if (!(await hasConstraint(knex, 'discounts', 'discounts_scope_check'))) {
    await knex.raw(`
      ALTER TABLE discounts
      ADD CONSTRAINT discounts_scope_check
      CHECK (scope IS NULL OR scope IN ('invoice', 'contract', 'service', 'item'))
    `);
  }

  // --- Affected service period on an automatic adjustment line ---
  await addColumnIfMissing(knex, 'invoice_charges', 'adjustment_period_start', (table) => {
    table.date('adjustment_period_start').nullable();
  });
  await addColumnIfMissing(knex, 'invoice_charges', 'adjustment_period_end', (table) => {
    table.date('adjustment_period_end').nullable();
  });

  // --- Manual-save revision + idempotency ledger ---
  await addColumnIfMissing(knex, 'invoices', 'draft_adjustment_revision', (table) => {
    table.integer('draft_adjustment_revision').notNullable().defaultTo(0);
  });

  if (!(await knex.schema.hasTable('invoice_adjustment_operations'))) {
    await knex.schema.createTable('invoice_adjustment_operations', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('operation_id').notNullable();
      table.uuid('invoice_id').notNullable();
      table.integer('resulting_revision').notNullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'operation_id']);
      table.index(['tenant', 'invoice_id'], 'idx_invoice_adjustment_operations_invoice');
    });
    await distributeIfCitus(knex, 'invoice_adjustment_operations');
  }

  if (!(await hasIndex(knex, 'idx_invoice_charges_adjustment_period'))) {
    await knex.raw(`
      CREATE INDEX idx_invoice_charges_adjustment_period
      ON invoice_charges (tenant, invoice_id, adjustment_source_kind, adjustment_period_start)
      WHERE adjustment_source_kind IS NOT NULL
    `);
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('invoice_adjustment_operations');
  await knex.raw('DROP INDEX IF EXISTS idx_invoice_charges_adjustment_period');

  for (const [table, constraint] of [
    ['discounts', 'discounts_scope_check'],
  ]) {
    if (await hasConstraint(knex, table, constraint)) {
      await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT ${constraint}`);
    }
  }
  for (const [table, column] of [
    ['discounts', 'scope_service_id'],
    ['discounts', 'applies_to_item_id'],
    ['discounts', 'scope'],
    ['discounts', 'priority'],
    ['invoice_charges', 'adjustment_period_end'],
    ['invoice_charges', 'adjustment_period_start'],
    ['invoices', 'draft_adjustment_revision'],
  ]) {
    if (await hasColumn(knex, table, column)) {
      await knex.schema.alterTable(table, (t) => t.dropColumn(column));
    }
  }
};

// Citus: ADD COLUMN / ADD CONSTRAINT / CREATE TABLE with raw DDL must not run
// inside a transaction.
exports.config = { transaction: false };
