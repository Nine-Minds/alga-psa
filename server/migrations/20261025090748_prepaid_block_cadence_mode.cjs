/**
 * Prepaid hours on contracts (alga-2026-0002684), migration 1 of 3: block
 * issue mode and rollover on the Prepaid Block config tables.
 *
 *   contract_line_prepaid_blocks, contract_template_line_prepaid_blocks,
 *   contract_line_preset_prepaid_blocks
 *     + issue_mode       text     NOT NULL DEFAULT 'consumption' ('consumption' | 'cadence')
 *     + rollover_periods smallint NOT NULL DEFAULT 0 (0..12, only with 'cadence')
 *
 * See ee/docs/plans/2026-10-20-prepaid-hours-contracts.md (D2, D5, section 4).
 * No data backfill: the defaults keep every existing row on consumption mode.
 * Citus: the tables are already tenant-distributed (or local with their
 * parent); adding columns and CHECKs needs no distribution change.
 * Transaction-free, like the other prepaid block migrations.
 */
exports.config = { transaction: false };

const TABLES = [
  'contract_line_prepaid_blocks',
  'contract_template_line_prepaid_blocks',
  'contract_line_preset_prepaid_blocks',
];

const CHECKS = (table) => [
  [`${table}_issue_mode_ck`, "issue_mode IN ('consumption', 'cadence')"],
  [`${table}_rollover_periods_ck`, 'rollover_periods BETWEEN 0 AND 12'],
  [
    `${table}_cadence_triggers_ck`,
    "issue_mode <> 'cadence' OR (trigger_on_exhaustion = false AND trigger_threshold_percent IS NULL " +
      'AND trigger_on_expiry = false AND trigger_on_renewal = false AND expiry_months IS NULL)',
  ],
  [`${table}_rollover_mode_ck`, "rollover_periods = 0 OR issue_mode = 'cadence'"],
];

async function addCheck(knex, table, name, expression) {
  const r = await knex.raw('SELECT 1 FROM pg_constraint WHERE conname = ? AND conrelid = ?::regclass', [name, table]);
  if (r.rows.length === 0) {
    await knex.raw('ALTER TABLE ?? ADD CONSTRAINT ?? CHECK (' + expression + ')', [table, name]);
  }
}

exports.up = async function up(knex) {
  for (const table of TABLES) {
    await knex.raw("ALTER TABLE ?? ADD COLUMN IF NOT EXISTS issue_mode text NOT NULL DEFAULT 'consumption'", [table]);
    await knex.raw('ALTER TABLE ?? ADD COLUMN IF NOT EXISTS rollover_periods smallint NOT NULL DEFAULT 0', [table]);
    for (const [name, expression] of CHECKS(table)) {
      await addCheck(knex, table, name, expression);
    }
  }
};

exports.down = async function down(knex) {
  for (const table of TABLES) {
    const row = await knex(table).where('issue_mode', 'cadence').count({ n: '*' }).first();
    if (Number(row.n) > 0) {
      throw new Error(
        `Cannot roll back prepaid block cadence mode: ${row.n} cadence config row(s) exist in ${table}. ` +
          "Switch them to issue_mode = 'consumption' (or delete them) explicitly first.",
      );
    }
  }
  for (const table of TABLES) {
    for (const [name] of CHECKS(table)) {
      await knex.raw('ALTER TABLE ?? DROP CONSTRAINT IF EXISTS ??', [table, name]);
    }
    await knex.raw('ALTER TABLE ?? DROP COLUMN IF EXISTS rollover_periods', [table]);
    await knex.raw('ALTER TABLE ?? DROP COLUMN IF EXISTS issue_mode', [table]);
  }
};
