
/**
 * Add explicit invoice routing for project products.
 *
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('project_materials', (table) => {
    table.text('billing_destination').nullable();
    table.uuid('billing_schedule_entry_id').nullable();
  });

  // A literal update is safe on both plain Postgres and Citus distributed tables.
  await knex('project_materials')
    .whereNull('billing_destination')
    .update({ billing_destination: 'next_project_invoice' });

  await knex.raw(`
    ALTER TABLE project_materials
    ALTER COLUMN billing_destination SET DEFAULT 'next_project_invoice',
    ALTER COLUMN billing_destination SET NOT NULL
  `);
  await knex.raw(`
    ALTER TABLE project_materials
    ADD CONSTRAINT project_materials_billing_destination_check
    CHECK (billing_destination IN (
      'next_project_invoice',
      'schedule_entry',
      'separate',
      'project_completion',
      'on_hold'
    ))
  `);
  await knex.raw(`
    ALTER TABLE project_materials
    ADD CONSTRAINT project_materials_billing_schedule_link_check
    CHECK (
      (billing_destination = 'schedule_entry' AND billing_schedule_entry_id IS NOT NULL)
      OR (billing_destination <> 'schedule_entry' AND billing_schedule_entry_id IS NULL)
    )
  `);
  await knex.raw(`
    ALTER TABLE project_materials
    ADD CONSTRAINT project_materials_billing_schedule_entry_fk
    FOREIGN KEY (tenant, billing_schedule_entry_id)
    REFERENCES project_billing_schedule_entries (tenant, schedule_entry_id)
    ON DELETE NO ACTION
  `);
  await knex.raw(`
    CREATE INDEX idx_project_materials_billing_eligibility
    ON project_materials (tenant, project_id, is_billed, billing_destination, currency_code)
  `);
  await knex.raw(`
    CREATE INDEX idx_project_materials_billing_schedule_entry
    ON project_materials (tenant, billing_schedule_entry_id)
  `);
};

/**
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS idx_project_materials_billing_schedule_entry');
  await knex.raw('DROP INDEX IF EXISTS idx_project_materials_billing_eligibility');
  await knex.raw(`
    ALTER TABLE project_materials
    DROP CONSTRAINT IF EXISTS project_materials_billing_schedule_entry_fk,
    DROP CONSTRAINT IF EXISTS project_materials_billing_schedule_link_check,
    DROP CONSTRAINT IF EXISTS project_materials_billing_destination_check
  `);
  await knex.schema.alterTable('project_materials', (table) => {
    table.dropColumn('billing_schedule_entry_id');
    table.dropColumn('billing_destination');
  });
};
