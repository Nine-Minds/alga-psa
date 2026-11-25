/**
 * Contract line schedule cadence.
 *
 * contract_lines.cadence_anchor selects the anchor for contract-owned cadence:
 *   - 'assignment' (default): periods anchor on the client contract assignment start
 *     (existing "Contract anniversary" behavior, unchanged).
 *   - 'line': periods anchor on the contract line's own start_date, so a line that
 *     starts after the contract bills on its own renewal date ("Contract line schedule").
 *
 * Only meaningful when cadence_owner = 'contract'.
 */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('contract_lines'))) return;
  if (!(await knex.schema.hasColumn('contract_lines', 'cadence_anchor'))) {
    await knex.schema.alterTable('contract_lines', (t) => {
      t.text('cadence_anchor').notNullable().defaultTo('assignment');
    });
  }
  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'contract_lines_cadence_anchor_check'
      ) THEN
        ALTER TABLE contract_lines
          ADD CONSTRAINT contract_lines_cadence_anchor_check
          CHECK (cadence_anchor IN ('assignment', 'line'))
          NOT VALID;
      END IF;
    END $$;
  `);
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable('contract_lines'))) return;
  await knex.raw('ALTER TABLE contract_lines DROP CONSTRAINT IF EXISTS contract_lines_cadence_anchor_check');
  if (await knex.schema.hasColumn('contract_lines', 'cadence_anchor')) {
    await knex.schema.alterTable('contract_lines', (t) => t.dropColumn('cadence_anchor'));
  }
};
