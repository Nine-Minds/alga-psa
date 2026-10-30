// Validate separately from installation: scans allow concurrent reads and writes.
exports.config = { transaction: false };

const TABLES = [
  'contract_line_prepaid_blocks',
  'contract_template_line_prepaid_blocks',
  'contract_line_preset_prepaid_blocks',
];

exports.up = async function up(knex) {
  for (const table of TABLES) {
    await knex.raw('ALTER TABLE ?? VALIDATE CONSTRAINT ??', [table, `${table}_issue_mode_ck`]);
    await knex.raw('ALTER TABLE ?? VALIDATE CONSTRAINT ??', [table, `${table}_rollover_periods_ck`]);
    await knex.raw('ALTER TABLE ?? VALIDATE CONSTRAINT ??', [table, `${table}_cadence_triggers_ck`]);
    await knex.raw('ALTER TABLE ?? VALIDATE CONSTRAINT ??', [table, `${table}_rollover_mode_ck`]);
  }
  await knex.raw('ALTER TABLE hour_blocks VALIDATE CONSTRAINT hour_blocks_issuance_fkey');
  await knex.raw('ALTER TABLE hour_blocks VALIDATE CONSTRAINT hour_blocks_valid_from_expiration_check');

  // Preserve the existing tolerance of legacy contract blocks without a source.
  // NOT VALID still rejects new or updated rows that violate the source check.
  const orphan = await knex.raw(
    "SELECT 1 FROM hour_blocks WHERE source_type = 'contract' AND issuance_id IS NULL AND service_period_record_id IS NULL LIMIT 1",
  );
  if (orphan.rows.length === 0) {
    await knex.raw('ALTER TABLE hour_blocks VALIDATE CONSTRAINT hour_blocks_contract_source_check');
  }
  await knex.raw('ALTER TABLE recurring_service_periods VALIDATE CONSTRAINT recurring_service_periods_charge_family_check');
};

exports.down = async function down() {
  // Validation does not change which new writes are accepted.
};
