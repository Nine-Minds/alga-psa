/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  await knex.schema.alterTable('company_billing_cycles', (table) => {
    table.timestamp('period_start_date').notNullable().defaultTo(knex.fn.now());
    table.timestamp('period_end_date').nullable();
  });

  // Add a raw index to prevent overlapping periods
  // Drop any existing indexes first
  await knex.raw(`
    DROP INDEX IF EXISTS company_billing_cycles_no_overlap;
    DROP INDEX IF EXISTS company_billing_cycles_no_overlap_finite;
  `);

  // Create new indexes
  await knex.raw(`
    CREATE UNIQUE INDEX company_billing_cycles_no_overlap 
    ON company_billing_cycles (company_id, period_start_date, billing_cycle_id)
    WHERE period_end_date IS NULL;

    CREATE UNIQUE INDEX company_billing_cycles_no_overlap_finite 
    ON company_billing_cycles (company_id, period_start_date, period_end_date, billing_cycle_id) 
    WHERE period_end_date IS NOT NULL AND period_end_date > period_start_date
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.raw('DROP INDEX IF EXISTS company_billing_cycles_no_overlap');
  
  await knex.schema.alterTable('company_billing_cycles', (table) => {
    table.dropColumn('period_end_date');
    table.dropColumn('period_start_date');
  });
};
