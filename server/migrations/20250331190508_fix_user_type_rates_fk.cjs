/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // First, check if we need to modify the plan_service_hourly_config table to add a composite primary key
  const hasPK = await knex.raw(`
    SELECT COUNT(*) as count
    FROM pg_constraint
    WHERE conname = 'plan_service_hourly_config_tenant_config_id_pkey'
      AND conrelid = 'plan_service_hourly_config'::regclass;
  `);
  
  // If the composite PK doesn't exist, we need to add it
  if (parseInt(hasPK.rows[0].count) === 0) {
    console.log("Adding composite unique constraint to plan_service_hourly_config on (tenant, config_id)");
    // We can't alter the primary key directly, so we'll add a unique constraint instead
    await knex.schema.alterTable('plan_service_hourly_config', function(table) {
      try {
        table.unique(['tenant', 'config_id'], 'plan_service_hourly_config_tenant_config_id_unique');
        console.log("Successfully added unique constraint to plan_service_hourly_config.");
      } catch (e) {
        console.error(`Failed to add unique constraint to plan_service_hourly_config: ${e.message}`);
        throw e; // This is a critical step, so we should fail the migration if it doesn't work
      }
    });
  } else {
    console.log("Composite unique constraint already exists on plan_service_hourly_config, skipping creation.");
  }

  // Now we can update the user_type_rates table
  await knex.schema.alterTable('user_type_rates', function(table) {
    // Drop the existing foreign key constraint with its actual name
    try {
      console.log("Attempting to drop existing FK 'user_type_rates_config_id_foreign' on config_id");
      table.dropForeign('config_id', 'user_type_rates_config_id_foreign');
      console.log("Successfully dropped existing FK 'user_type_rates_config_id_foreign'.");
    } catch (e) {
      console.warn(`Could not drop FK 'user_type_rates_config_id_foreign': ${e.message}. Will try without constraint name.`);
      
      // Try dropping by column without a specific constraint name
      try {
          console.log("Fallback: Attempting to drop FK on user_type_rates using column config_id without specifying constraint name");
          table.dropForeign('config_id');
          console.log("Successfully dropped existing FK on config_id.");
      } catch (e2) {
          console.warn(`Could not drop FK on config_id without constraint name: ${e2.message}. Will continue anyway.`);
      }
    }

    // Add the new foreign key constraint referencing the unique constraint we just created
    console.log("Adding new FK to user_type_rates referencing plan_service_hourly_config(tenant, config_id)");
    table.foreign(['tenant', 'config_id'], 'user_type_rates_tenant_config_id_foreign') 
         .references(['tenant', 'config_id'])
         .inTable('plan_service_hourly_config')
         .onDelete('CASCADE');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // First, roll back the user_type_rates foreign key
  await knex.schema.alterTable('user_type_rates', function(table) {
    // Drop the new composite foreign key constraint
    try {
      console.log("Rolling back: Dropping composite FK with explicit constraint name 'user_type_rates_tenant_config_id_foreign'");
      table.dropForeign(['tenant', 'config_id'], 'user_type_rates_tenant_config_id_foreign');
    } catch (e) {
      console.warn(`Could not drop composite FK 'user_type_rates_tenant_config_id_foreign': ${e.message}. Will try without constraint name.`);
      
      try {
        console.log("Rolling back: Dropping composite FK without explicit constraint name");
        table.dropForeign(['tenant', 'config_id']);
      } catch (e2) {
        console.warn(`Could not drop composite FK without constraint name: ${e2.message}. Will continue with rollback.`);
      }
    }

    // Re-add the original foreign key constraint on config_id
    try {
        console.log("Rolling back: Re-adding original FK 'user_type_rates_config_id_foreign' on config_id");
        table.foreign('config_id', 'user_type_rates_config_id_foreign')
             .references('config_id')
             .inTable('plan_service_hourly_config')
             .onDelete('CASCADE');
    } catch (e) {
        console.error(`Could not re-add original FK during rollback: ${e.message}. Will try without constraint name.`);
        
        try {
            console.log("Rolling back: Re-adding FK on config_id without explicit constraint name");
            table.foreign('config_id')
                 .references('config_id')
                 .inTable('plan_service_hourly_config')
                 .onDelete('CASCADE');
        } catch (e2) {
            console.error(`Could not re-add FK on config_id without constraint name: ${e2.message}. Manual fix may be required.`);
        }
    }
  });
  
  // Then, drop the unique constraint we added to plan_service_hourly_config
  try {
    console.log("Rolling back: Dropping unique constraint on plan_service_hourly_config");
    await knex.schema.alterTable('plan_service_hourly_config', function(table) {
      table.dropUnique(['tenant', 'config_id'], 'plan_service_hourly_config_tenant_config_id_unique');
    });
    console.log("Successfully dropped unique constraint on plan_service_hourly_config.");
  } catch (e) {
    console.warn(`Could not drop unique constraint on plan_service_hourly_config: ${e.message}. This might be okay if it was never created.`);
  }
};
