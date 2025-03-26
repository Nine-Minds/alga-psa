/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // First, drop the old constraint
  await knex.raw('ALTER TABLE service_catalog DROP CONSTRAINT IF EXISTS service_type_check;');

  // Then, add the new column and the new constraint
  await knex.schema.alterTable('service_catalog', function(table) {
    table.string('billing_method'); // Add the new column
  });

  // Add the check constraint for the new column
  await knex.raw(`
    ALTER TABLE service_catalog
    ADD CONSTRAINT billing_method_check CHECK (billing_method IN ('fixed', 'per_unit'));
  `);

  // Note: Data migration (populating billing_method) will be handled separately.
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Drop the new constraint first
  await knex.raw('ALTER TABLE service_catalog DROP CONSTRAINT IF EXISTS billing_method_check;');

  // Remove the billing_method column
  await knex.schema.alterTable('service_catalog', function(table) {
    table.dropColumn('billing_method');
  });

  // Re-add the old service_type constraint
  await knex.raw(`
    ALTER TABLE service_catalog
    ADD CONSTRAINT service_type_check CHECK ((service_type = ANY (ARRAY['Fixed'::text, 'Time'::text, 'Usage'::text, 'Product'::text, 'License'::text])));
  `);
};
