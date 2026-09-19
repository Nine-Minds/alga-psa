/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  try {
    // First, check if plan_service_hourly_config table exists
    console.log("Checking if plan_service_hourly_config table exists");
    const hourlyConfigExists = await knex.schema.hasTable('plan_service_hourly_config');
    
    if (!hourlyConfigExists) {
      console.log("Table plan_service_hourly_config doesn't exist yet, migration may be running out of order");
      return; // Exit gracefully, this will be handled in another migration
    }
    
    // Check if the unique constraint already exists
    console.log("Checking if unique constraint already exists on plan_service_hourly_config");
    try {
      const constraintExists = await knex.raw(`
        SELECT COUNT(*) AS count 
        FROM pg_constraint 
        WHERE conname = 'plan_service_hourly_config_tenant_config_id_unique'
      `);
      
      const exists = parseInt(constraintExists.rows[0].count) > 0;
      
      if (!exists) {
        console.log("Unique constraint doesn't exist, adding it");
        await knex.raw(`
          ALTER TABLE plan_service_hourly_config 
          ADD CONSTRAINT plan_service_hourly_config_tenant_config_id_unique 
          UNIQUE (tenant, config_id)
        `);
        console.log("Successfully added unique constraint");
      } else {
        console.log("Unique constraint already exists, skipping");
      }
    } catch (e) {
      console.error(`Error checking/adding unique constraint to plan_service_hourly_config: ${e.message}`);
      // Continue anyway, as we might still be able to update the foreign key
    }

    // Now check if user_type_rates table exists
    console.log("Checking if user_type_rates table exists");
    const userTypeRatesExists = await knex.schema.hasTable('user_type_rates');
    
    if (!userTypeRatesExists) {
      console.log("Table user_type_rates doesn't exist, skipping FK update");
      return; // Exit gracefully
    }
    
    // Use raw SQL to drop any existing foreign key constraints on config_id
    console.log("Looking for existing foreign key constraints on user_type_rates.config_id");
    try {
      const constraints = await knex.raw(`
        SELECT tc.constraint_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu 
          ON tc.constraint_name = kcu.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY' 
          AND tc.table_name = 'user_type_rates'
          AND kcu.column_name = 'config_id'
      `);
      
      if (constraints.rows && constraints.rows.length > 0) {
        for (const constraint of constraints.rows) {
          console.log(`Dropping constraint ${constraint.constraint_name} from user_type_rates`);
          await knex.raw(`ALTER TABLE user_type_rates DROP CONSTRAINT IF EXISTS ${constraint.constraint_name}`);
        }
      } else {
        console.log("No existing FK constraints found on user_type_rates.config_id");
      }
    } catch (e) {
      console.warn(`Error checking/dropping FK constraints: ${e.message}. Will try to continue.`);
    }

    // Check if both tenant and config_id columns exist in the user_type_rates table
    const tableInfo = await knex('user_type_rates').columnInfo();
    
    if (tableInfo.tenant && tableInfo.config_id) {
      // Add the new foreign key constraint using raw SQL
      console.log("Adding new FK constraint to user_type_rates using tenant and config_id columns");
      try {
        await knex.raw(`
          ALTER TABLE user_type_rates
          ADD CONSTRAINT user_type_rates_tenant_config_id_foreign 
          FOREIGN KEY (tenant, config_id) 
          REFERENCES plan_service_hourly_config(tenant, config_id) 
          ON DELETE CASCADE
        `);
        console.log("Successfully added composite FK constraint");
      } catch (e) {
        console.error(`Failed to add composite FK constraint: ${e.message}. Will continue without it.`);
      }
    } else {
      console.log(`Missing column(s) in user_type_rates. Found: ${Object.keys(tableInfo).join(', ')}`);
    }
  } catch (e) {
    console.error(`Unexpected error in migration: ${e.message}`);
    // Don't rethrow, allow knex to continue with other migrations
  }
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
