/**
 * Adds billing_timing to contract_line_presets so presets persist cadence timing
 * alongside billing_frequency and cadence_owner, matching the authoritative
 * recurrence storage contract. Existing rows backfill to 'arrears'.
 *
 * @param { import('knex').Knex } knex
 */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('contract_line_presets'))) {
    return;
  }

  const hasColumn = await knex.schema.hasColumn('contract_line_presets', 'billing_timing');
  if (!hasColumn) {
    await knex.schema.alterTable('contract_line_presets', (table) => {
      table.string('billing_timing', 16).notNullable().defaultTo('arrears');
    });
  }

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'contract_line_presets_billing_timing_check'
      ) THEN
        ALTER TABLE contract_line_presets
        ADD CONSTRAINT contract_line_presets_billing_timing_check
        CHECK (billing_timing IN ('arrears', 'advance'));
      END IF;
    END$$;
  `);
};

/**
 * @param { import('knex').Knex } knex
 */
exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable('contract_line_presets'))) {
    return;
  }

  await knex.raw('ALTER TABLE contract_line_presets DROP CONSTRAINT IF EXISTS contract_line_presets_billing_timing_check');

  if (await knex.schema.hasColumn('contract_line_presets', 'billing_timing')) {
    await knex.schema.alterTable('contract_line_presets', (table) => {
      table.dropColumn('billing_timing');
    });
  }
};
