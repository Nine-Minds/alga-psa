'use strict';

/**
 * Preserve original edit attribution for superseded recurring-unit revisions.
 *
 * contract_line_unit_pricing_revision_history already records the replacing
 * actor (`superseded_by`) and when the audit row was written (`created_at`).
 * Replacing a pending revision, however, also supersedes the original author's
 * values, so the audit must carry the superseded revision's own author and
 * timestamps distinct from the actor performing the replacement.
 *
 * Additive and nullable; existing history rows keep null origin columns and
 * continue to read. Plan: docs/plans/2026-09-22-contract-products-quantity-price-changes-plan.md
 */

const HISTORY = 'contract_line_unit_pricing_revision_history';

const hasColumn = async (knex, tableName, columnName) => {
  try {
    return await knex.schema.hasColumn(tableName, columnName);
  } catch {
    return false;
  }
};

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(HISTORY))) {
    return;
  }
  const columns = [
    ['original_created_by', 'text'],
    ['original_created_at', 'timestamptz'],
    ['original_updated_by', 'text'],
    ['original_updated_at', 'timestamptz'],
  ];
  for (const [name, type] of columns) {
    if (!(await hasColumn(knex, HISTORY, name))) {
      await knex.raw(`ALTER TABLE ${HISTORY} ADD COLUMN ${name} ${type}`);
    }
  }
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable(HISTORY))) {
    return;
  }
  for (const name of [
    'original_updated_at',
    'original_updated_by',
    'original_created_at',
    'original_created_by',
  ]) {
    if (await hasColumn(knex, HISTORY, name)) {
      await knex.schema.alterTable(HISTORY, (t) => t.dropColumn(name));
    }
  }
};

// Additive ALTER TABLE on a Citus-distributed table must not run in a transaction.
exports.config = { transaction: false };
