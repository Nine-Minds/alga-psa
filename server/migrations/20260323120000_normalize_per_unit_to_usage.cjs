/**
 * Normalize legacy 'per_unit' billing_method values to 'usage' across all tables
 * and update constraints to allow ('fixed', 'hourly', 'usage').
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  // 1. Drop the old constraint on standard_service_types that only allows ('fixed', 'per_unit')
  await knex.raw(`
    ALTER TABLE standard_service_types
    DROP CONSTRAINT IF EXISTS standard_service_types_billing_method_check
  `);

  // 2. Normalize per_unit -> usage in all tables
  const updates = [
    knex('standard_service_types').where('billing_method', 'per_unit').update({ billing_method: 'usage' }),
    knex('service_types').where('billing_method', 'per_unit').update({ billing_method: 'usage' }),
    knex('service_catalog').where('billing_method', 'per_unit').update({ billing_method: 'usage' }),
  ];
  const [stdCount, typesCount, catalogCount] = await Promise.all(updates);
  console.log(`Normalized per_unit -> usage: standard_service_types=${stdCount}, service_types=${typesCount}, service_catalog=${catalogCount}`);

  // 3. Add new constraint allowing the canonical billing methods
  await knex.raw(`
    ALTER TABLE standard_service_types
    ADD CONSTRAINT standard_service_types_billing_method_check
    CHECK (billing_method IN ('fixed', 'hourly', 'usage'))
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  // Revert constraint
  await knex.raw(`
    ALTER TABLE standard_service_types
    DROP CONSTRAINT IF EXISTS standard_service_types_billing_method_check
  `);

  // Restore old constraint (does not revert data — that would be lossy)
  await knex.raw(`
    ALTER TABLE standard_service_types
    ADD CONSTRAINT standard_service_types_billing_method_check
    CHECK (billing_method IN ('fixed', 'per_unit'))
  `);
};
