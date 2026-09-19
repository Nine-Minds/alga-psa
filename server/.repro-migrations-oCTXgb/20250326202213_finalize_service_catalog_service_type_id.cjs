/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Before making it non-nullable, optionally check if any are still null
  const nullCount = await knex('service_catalog').whereNull('service_type_id').count('* as count').first();
  if (nullCount && parseInt(nullCount.count, 10) > 0) {
    // If this happens, the previous data migration might have failed or missed some cases.
    // Throwing an error prevents applying a NOT NULL constraint that would fail.
    throw new Error(`Cannot make service_type_id non-nullable because ${nullCount.count} rows still have NULL values. Please investigate and fix the data.`);
  }

  return knex.schema.alterTable('service_catalog', function(table) {
    // Make the service_type_id column non-nullable
    table.uuid('service_type_id').notNullable().alter();
    
    // Drop the old service_type text column
    table.dropColumn('service_type');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.alterTable('service_catalog', function(table) {
    // Add the old service_type column back (nullable)
    table.text('service_type').nullable();
    
    // Make the service_type_id column nullable again
    table.uuid('service_type_id').nullable().alter();

    // Note: Repopulating the 'service_type' text column from 'service_type_id'
    // would require joining with 'service_types' and is generally complex/risky
    // for a down migration. We are only restoring the schema structure here.
  });
};
