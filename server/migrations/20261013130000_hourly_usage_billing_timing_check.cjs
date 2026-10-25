// alga-2026-0002697, step 2 of 2: Hourly and Usage contract lines can never store
// billing_timing = 'advance'. Runs after 20261013120000_hourly_usage_lines_bill_in_arrears
// (the data repair), in its own migration so data changes and DDL stay apart for Citus.
//
// The constraint is a plain row-level CHECK on columns of the same row, so it is valid on
// distributed tables (tenant is the distribution key and is not involved).
//
// Citus behaviour of ADD CONSTRAINT ... CHECK on these distributed tables is verified by the
// CI Citus smoke run, not locally.
const CONSTRAINTS = [
  {
    table: 'contract_lines',
    name: 'contract_lines_hourly_usage_not_advance_check',
    expr: "NOT (contract_line_type IN ('Hourly', 'Usage') AND billing_timing = 'advance')",
  },
  {
    table: 'contract_template_lines',
    name: 'contract_template_lines_hourly_usage_not_advance_check',
    expr: "NOT (line_type IN ('Hourly', 'Usage') AND billing_timing = 'advance')",
  },
  {
    table: 'contract_line_presets',
    name: 'contract_line_presets_hourly_usage_not_advance_check',
    expr: "NOT (contract_line_type IN ('Hourly', 'Usage') AND billing_timing = 'advance')",
  },
];

exports.config = { transaction: true };

exports.up = async function up(knex) {
  for (const { table, name, expr } of CONSTRAINTS) {
    const existing = await knex.raw(
      'SELECT 1 FROM pg_constraint WHERE conname = ? AND conrelid = ?::regclass',
      [name, table],
    );
    if (existing.rows.length > 0) continue;
    await knex.raw(`ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (${expr})`);
  }
};

exports.down = async function down(knex) {
  for (const { table, name } of CONSTRAINTS) {
    await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${name}`);
  }
};
