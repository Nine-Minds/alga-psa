/**
 * Migration: Drop contract_line_template_terms table
 *
 * This table is redundant because all its columns now exist directly on contract_lines:
 * - billing_frequency
 * - billing_timing
 * - enable_overtime, overtime_rate, overtime_threshold
 * - enable_after_hours_rate, after_hours_multiplier
 * - minimum_billable_time, round_up_to_nearest
 *
 * The table has been empty in production and code has been updated to read/write
 * directly from contract_lines instead.
 */

exports.up = async function up(knex) {
  // Drop the compare view that depends on this table first
  await knex.raw('DROP VIEW IF EXISTS contract_template_lines_compare_view CASCADE');
  console.log('Dropped contract_template_lines_compare_view (depended on contract_line_template_terms)');

  // Drop the redundant table
  await knex.schema.dropTableIfExists('contract_line_template_terms');
  console.log('Dropped contract_line_template_terms table (redundant - columns exist on contract_lines)');
};

exports.down = async function down(knex) {
  // Recreate the table if needed for rollback
  const hasTable = await knex.schema.hasTable('contract_line_template_terms');
  if (!hasTable) {
    await knex.schema.createTable('contract_line_template_terms', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('contract_line_id').notNullable();
      table.string('billing_frequency', 50);
      table.string('billing_timing', 16).notNullable().defaultTo('arrears');
      table.boolean('enable_overtime');
      table.decimal('overtime_rate', 10, 2);
      table.integer('overtime_threshold');
      table.boolean('enable_after_hours_rate');
      table.decimal('after_hours_multiplier', 10, 2);
      table.integer('minimum_billable_time');
      table.integer('round_up_to_nearest');
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'contract_line_id']);
      table
        .foreign(['tenant', 'contract_line_id'])
        .references(['tenant', 'contract_line_id'])
        .inTable('contract_lines')
        .onDelete('CASCADE');
    });

    await knex.raw(`
      ALTER TABLE contract_line_template_terms
      ADD CONSTRAINT contract_line_template_terms_timing_check
      CHECK (billing_timing IN ('arrears', 'advance'))
    `);

    console.log('Recreated contract_line_template_terms table for rollback');
  }
};
