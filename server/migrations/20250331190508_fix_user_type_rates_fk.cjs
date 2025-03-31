/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  await knex.schema.alterTable('user_type_rates', function(table) {
    // Drop the incorrect foreign key constraint
    try {
      console.log("Dropping incorrect FK user_type_rates_config_id_foreign referencing plan_service_hourly_config");
      table.dropForeign(['config_id'], 'user_type_rates_config_id_foreign');
    } catch (e) {
      console.error(`Could not drop FK user_type_rates_config_id_foreign: ${e.message}. It might not exist or have a different name.`);
      // Optionally re-throw if the error is unexpected
    }

    // Add the correct foreign key constraint referencing plan_service_hourly_configs (plural)
    // Note: This assumes the target table plan_service_hourly_configs uses config_id as its primary key part.
    // If plan_service_hourly_configs uses a composite key like (tenant, config_id), this needs adjustment.
    // Based on migration 20250331164117, it uses (tenant, config_id) as PK.
    // Therefore, the FK here should also be composite.
    console.log("Adding correct composite FK user_type_rates_config_id_foreign referencing plan_service_hourly_configs(tenant, config_id)");
    table.foreign(['tenant', 'config_id'], 'user_type_rates_config_id_foreign') // Use the same constraint name for simplicity
         .references(['tenant', 'config_id'])
         .inTable('plan_service_hourly_configs'); // Reference the correct table (plural), removed cascade
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.schema.alterTable('user_type_rates', function(table) {
    // Drop the corrected foreign key constraint
    try {
      console.log("Rolling back: Dropping corrected composite FK user_type_rates_config_id_foreign");
      table.dropForeign(['tenant', 'config_id'], 'user_type_rates_config_id_foreign');
    } catch (e) {
       console.error(`Could not drop corrected composite FK user_type_rates_config_id_foreign during rollback: ${e.message}`);
    }

    // Re-add the original incorrect foreign key constraint (referencing singular table)
    // This might fail if the singular table doesn't exist anymore, handle potential error
    try {
        console.log("Rolling back: Re-adding incorrect FK user_type_rates_config_id_foreign referencing plan_service_hourly_config (singular)");
        table.foreign('config_id', 'user_type_rates_config_id_foreign')
             .references('config_id')
             .inTable('plan_service_hourly_config'); // Reference the original incorrect table (singular), removed cascade
    } catch (e) {
        console.error(`Could not re-add original incorrect FK during rollback (maybe plan_service_hourly_config doesn't exist?): ${e.message}`);
    }
  });
};
