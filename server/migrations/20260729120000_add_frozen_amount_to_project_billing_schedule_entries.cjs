/**
 * Freeze approved project billing schedule amounts so later total edits do not
 * rewrite already-approved or invoiced dollars.
 *
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('project_billing_schedule_entries', (table) => {
    table.bigInteger('frozen_amount').nullable();
  });

  await knex.raw(`
    UPDATE project_billing_schedule_entries AS entry
    SET frozen_amount = charge.net_amount
    FROM invoice_charges AS charge
    WHERE entry.tenant = charge.tenant
      AND entry.invoice_charge_id = charge.item_id
      AND entry.status = 'invoiced'
  `);

  await knex.raw(`
    UPDATE project_billing_schedule_entries AS entry
    SET frozen_amount = CASE
      WHEN entry.amount IS NOT NULL THEN entry.amount
      ELSE ROUND((entry.percentage::numeric / 100) * config.total_price)::bigint
    END
    FROM project_billing_configs AS config
    WHERE entry.tenant = config.tenant
      AND entry.config_id = config.config_id
      AND entry.status = 'approved'
  `);

  await knex.raw(`
    ALTER TABLE project_billing_schedule_entries
    ADD CONSTRAINT project_billing_schedule_entries_frozen_amount_check
    CHECK (
      (status IN ('approved', 'invoiced')) = (frozen_amount IS NOT NULL)
    ) NOT VALID
  `);
  await knex.raw(`
    ALTER TABLE project_billing_schedule_entries
    VALIDATE CONSTRAINT project_billing_schedule_entries_frozen_amount_check
  `);
};

/**
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.down = async function down(knex) {
  await knex.raw(`
    ALTER TABLE project_billing_schedule_entries
    DROP CONSTRAINT IF EXISTS project_billing_schedule_entries_frozen_amount_check
  `);
  await knex.schema.alterTable('project_billing_schedule_entries', (table) => {
    table.dropColumn('frozen_amount');
  });
};
