'use strict';

/**
 * Billing profiles — slice S2 attribution provenance (features F062–F064,
 * F133–F137, F141 of the billing-profiles plan).
 *
 * Two additions, both provenance rather than behaviour:
 *
 * 1. `auto_billing_profile` joins the `time_entries.contract_line_source`
 *    value set. Profile-aware narrowing is a genuinely new way for the resolver
 *    to reach an answer, and collapsing it into `auto_unique_service` would
 *    make the attribution inspector lie about how the line was chosen.
 *
 * 2. `contract_line_unresolved_reason` on `time_entries` and `usage_tracking`.
 *    The engine has always distinguished `ambiguous` (>1 eligible line — a
 *    contract covers the service and we could not pick a line) from `no_match`
 *    (0 eligible lines — nothing covers it) and written the distinction to
 *    `console.info` only. That distinction is the whole basis of the
 *    unresolved-item fix: `no_match` bills at catalog rate honestly, while
 *    `ambiguous` must never be billed at catalog rate silently. It cannot stay
 *    in logs.
 *
 * Kept as its own column rather than folded into `contract_line_source`: the
 * source records *how the line was chosen*, the reason records *why no line
 * was*. They answer different questions and a row can only carry one source.
 *
 * Text + CHECK, matching 20260816010000, so the value set can grow without an
 * ALTER TYPE on a distributed table.
 */

const UNRESOLVED_REASON_TABLES = ['time_entries', 'usage_tracking'];

const CONTRACT_LINE_SOURCE_VALUES_BEFORE = [
  'explicit',
  'auto_unique_service',
  'auto_bucket_overlay',
  'unresolved',
  'reconciled_at_generation',
];

const CONTRACT_LINE_SOURCE_VALUES_AFTER = [
  ...CONTRACT_LINE_SOURCE_VALUES_BEFORE,
  'auto_billing_profile',
];

const quoteList = (values) => values.map((value) => `'${value}'`).join(', ');

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

async function setContractLineSourceCheck(knex, values) {
  if (await hasConstraint(knex, 'time_entries', 'time_entries_contract_line_source_check')) {
    await knex.raw('ALTER TABLE time_entries DROP CONSTRAINT time_entries_contract_line_source_check');
  }
  await knex.raw(`
    ALTER TABLE time_entries
    ADD CONSTRAINT time_entries_contract_line_source_check
    CHECK (contract_line_source IS NULL OR contract_line_source IN (${quoteList(values)}))
  `);
}

exports.up = async function up(knex) {
  await setContractLineSourceCheck(knex, CONTRACT_LINE_SOURCE_VALUES_AFTER);

  for (const table of UNRESOLVED_REASON_TABLES) {
    if (!(await knex.schema.hasTable(table))) continue;

    if (!(await hasColumn(knex, table, 'contract_line_unresolved_reason'))) {
      await knex.schema.alterTable(table, (t) => {
        t.text('contract_line_unresolved_reason').nullable();
      });
    }
    const checkName = `${table}_contract_line_unresolved_reason_check`;
    if (!(await hasConstraint(knex, table, checkName))) {
      await knex.raw(`
        ALTER TABLE ${table}
        ADD CONSTRAINT ${checkName}
        CHECK (contract_line_unresolved_reason IS NULL OR contract_line_unresolved_reason IN
          ('ambiguous', 'no_match', 'error'))
      `);
    }
  }

  // usage_tracking gains the source column time_entries already has, so the
  // unresolved-item surface can treat usage records and time entries alike.
  if (await knex.schema.hasTable('usage_tracking')) {
    if (!(await hasColumn(knex, 'usage_tracking', 'contract_line_source'))) {
      await knex.schema.alterTable('usage_tracking', (t) => {
        t.text('contract_line_source').nullable();
      });
    }
    if (!(await hasConstraint(knex, 'usage_tracking', 'usage_tracking_contract_line_source_check'))) {
      await knex.raw(`
        ALTER TABLE usage_tracking
        ADD CONSTRAINT usage_tracking_contract_line_source_check
        CHECK (contract_line_source IS NULL OR contract_line_source IN (${quoteList(CONTRACT_LINE_SOURCE_VALUES_AFTER)}))
      `);
    }
  }
};

exports.down = async function down(knex) {
  if (await hasConstraint(knex, 'usage_tracking', 'usage_tracking_contract_line_source_check')) {
    await knex.raw('ALTER TABLE usage_tracking DROP CONSTRAINT usage_tracking_contract_line_source_check');
  }
  if (await hasColumn(knex, 'usage_tracking', 'contract_line_source')) {
    await knex.schema.alterTable('usage_tracking', (t) => {
      t.dropColumn('contract_line_source');
    });
  }

  for (const table of UNRESOLVED_REASON_TABLES) {
    const checkName = `${table}_contract_line_unresolved_reason_check`;
    if (await hasConstraint(knex, table, checkName)) {
      await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT ${checkName}`);
    }
    if (await hasColumn(knex, table, 'contract_line_unresolved_reason')) {
      await knex.schema.alterTable(table, (t) => {
        t.dropColumn('contract_line_unresolved_reason');
      });
    }
  }

  // Rows written with the new value would violate the narrower constraint;
  // fold them back to the closest pre-existing meaning first.
  await knex.raw(`
    UPDATE time_entries SET contract_line_source = 'auto_unique_service'
    WHERE contract_line_source = 'auto_billing_profile'
  `);
  await setContractLineSourceCheck(knex, CONTRACT_LINE_SOURCE_VALUES_BEFORE);
};

// ALTER TABLE on Citus-distributed tables must not run inside a transaction.
exports.config = { transaction: false };
