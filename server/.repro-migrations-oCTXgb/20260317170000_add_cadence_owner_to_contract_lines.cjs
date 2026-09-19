/**
 * Adds cadence_owner to live contract lines so recurring cadence ownership is
 * persisted at the same per-line granularity as billing_frequency and
 * billing_timing. Existing rows backfill safely to client cadence.
 *
 * @param { import('knex').Knex } knex
 */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('contract_lines'))) {
    return;
  }

  const hasColumn = await knex.schema.hasColumn('contract_lines', 'cadence_owner');
  if (!hasColumn) {
    await knex.schema.alterTable('contract_lines', (table) => {
      table.string('cadence_owner', 16).notNullable().defaultTo('client');
    });
  }

  await knex('contract_lines')
    .whereNull('cadence_owner')
    .update({ cadence_owner: 'client' });

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'contract_lines_cadence_owner_check'
      ) THEN
        ALTER TABLE contract_lines
        ADD CONSTRAINT contract_lines_cadence_owner_check
        CHECK (cadence_owner IN ('client', 'contract'));
      END IF;
    END$$;
  `);
};

/**
 * @param { import('knex').Knex } knex
 */
exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable('contract_lines'))) {
    return;
  }

  await knex.raw('ALTER TABLE contract_lines DROP CONSTRAINT IF EXISTS contract_lines_cadence_owner_check');

  if (await knex.schema.hasColumn('contract_lines', 'cadence_owner')) {
    await knex.schema.alterTable('contract_lines', (table) => {
      table.dropColumn('cadence_owner');
    });
  }
};
