/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Define dependent tables and their FK constraint names 
  // We're using the ACTUAL constraint names as they exist in the database
  const dependents = [
    { table: 'plan_service_fixed_config', constraint: 'plan_service_fixed_config_config_id_foreign' },
    { table: 'plan_service_hourly_config', constraint: 'plan_service_hourly_config_config_id_foreign' }, // Note: This table might not exist yet when this runs first time, handle potential error
    { table: 'plan_service_usage_config', constraint: 'plan_service_usage_config_config_id_foreign' },
    { table: 'plan_service_bucket_config', constraint: 'plan_service_bucket_config_config_id_foreign' },
    { table: 'plan_service_rate_tiers', constraint: 'plan_service_rate_tiers_config_id_foreign' },
    // Add user_type_rates if it also depends directly on plan_service_configuration PK (check its migration)
    // Based on 20250318200000 migration, user_type_rates depends on plan_service_hourly_config, so it's indirectly handled.
  ];

  // 1. Drop dependent foreign key constraints - using only config_id since that's what exists
  for (const dep of dependents) {
    const tableExists = await knex.schema.hasTable(dep.table);
    if (tableExists) {
        await knex.schema.alterTable(dep.table, function(table) {
          try {
            console.log(`Attempting to drop FK ${dep.constraint} on 'config_id' for table ${dep.table}`);
            table.dropForeign('config_id', dep.constraint);
            console.log(`Successfully dropped FK ${dep.constraint} on config_id for table ${dep.table}`);
          } catch (e) {
            // Log error but continue, it might be that the constraint doesn't exist
            console.warn(`Could not drop FK constraint ${dep.constraint} on table ${dep.table}: ${e.message}. This might be okay if the constraint doesn't exist.`);
          }
        });
    } else {
        console.log(`Table ${dep.table} does not exist, skipping FK drop.`);
    }
  }

  // 2. Drop the existing primary key constraint on plan_service_configuration
  await knex.schema.alterTable('plan_service_configuration', function(table) {
    try {
      console.log("Dropping old PK constraint plan_service_configuration_pkey");
      table.dropPrimary('plan_service_configuration_pkey');
    } catch (e) {
      console.error(`Error dropping PK constraint plan_service_configuration_pkey: ${e.message}. Manual check needed.`);
      throw e;
    }
  });

  // 3. Add the new composite primary key
  await knex.schema.alterTable('plan_service_configuration', function(table) {
    console.log("Adding new composite PK (tenant, config_id)");
    table.primary(['tenant', 'config_id']);
  });

  // 4. Re-add the foreign key constraints as new composite keys
  for (const dep of dependents) {
     // Check if table exists before trying to add constraint (for plan_service_hourly_config case)
     const tableExists = await knex.schema.hasTable(dep.table);
     if (tableExists) {
        // First, add tenant to the table if it doesn't exist (all tables should have tenant already)
        await knex.schema.alterTable(dep.table, function(table) {
            try {
                console.log(`Adding composite FK constraint ${dep.constraint} on table ${dep.table}`);
                table.foreign(['tenant', 'config_id'], dep.constraint) // Use original constraint name
                     .references(['tenant', 'config_id'])
                     .inTable('plan_service_configuration')
                     .onDelete('CASCADE'); // Ensure CASCADE is reapplied if needed
            } catch (e) {
                console.error(`Failed to add composite FK to ${dep.table}: ${e.message}. Will try adding non-composite FK.`);
                
                // Fallback to non-composite FK if composite fails
                try {
                    console.log(`Re-adding original FK constraint ${dep.constraint} on table ${dep.table}`);
                    table.foreign('config_id', dep.constraint)
                         .references('config_id')
                         .inTable('plan_service_configuration')
                         .onDelete('CASCADE');
                } catch (e2) {
                    console.error(`Failed to re-add original FK to ${dep.table}: ${e2.message}. Manual fix required.`);
                }
            }
        });
     } else {
         console.log(`Table ${dep.table} does not exist, skipping FK re-add.`);
     }
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Reverse order of operations for rollback

  const dependents = [
    { table: 'plan_service_fixed_config', constraint: 'plan_service_fixed_config_config_id_foreign' },
    { table: 'plan_service_hourly_config', constraint: 'plan_service_hourly_config_config_id_foreign' },
    { table: 'plan_service_usage_config', constraint: 'plan_service_usage_config_config_id_foreign' },
    { table: 'plan_service_bucket_config', constraint: 'plan_service_bucket_config_config_id_foreign' },
    { table: 'plan_service_rate_tiers', constraint: 'plan_service_rate_tiers_config_id_foreign' },
  ];

  // 1. Drop the foreign key constraints
  for (const dep of dependents) {
     const tableExists = await knex.schema.hasTable(dep.table);
     if (tableExists) {
        // Try dropping composite FK first with and without constraint name
        await knex.schema.alterTable(dep.table, function(table) {
          try {
            console.log(`Rolling back: Dropping composite FK on ${dep.table}`);
            table.dropForeign(['tenant', 'config_id']);
          } catch (e) {
            console.warn(`Error dropping unnamed composite FK on ${dep.table} during rollback: ${e.message}`);
          }
        });
        
        await knex.schema.alterTable(dep.table, function(table) {
          try {
            console.log(`Rolling back: Dropping named FK ${dep.constraint} on ${dep.table}`);
            table.dropForeign(['tenant', 'config_id'], dep.constraint);
          } catch (e) {
            console.warn(`Error dropping named composite FK ${dep.constraint} on ${dep.table} during rollback: ${e.message}`);
          }
        });
        
        // Also try dropping by single column config_id
        await knex.schema.alterTable(dep.table, function(table) {
          try {
            console.log(`Rolling back: Dropping FK on config_id for ${dep.table}`);
            table.dropForeign('config_id');
          } catch (e) {
            console.warn(`Error dropping FK on config_id for ${dep.table} during rollback: ${e.message}`);
          }
        });
     }
  }

  // 2. Drop the composite primary key constraint
  await knex.schema.alterTable('plan_service_configuration', function(table) {
    try {
      console.log("Rolling back: Dropping composite PK");
      // Default name might be plan_service_configuration_pkey again, or based on columns
      table.dropPrimary(['tenant', 'config_id']); // Try dropping by columns
    } catch (e) {
       try {
           console.warn("Failed dropping composite PK by columns, trying default name...");
           table.dropPrimary('plan_service_configuration_pkey');
       } catch (e2) {
           console.error(`Error dropping composite PK during rollback: ${e2.message}`);
           // Don't throw, try to continue rollback
       }
    }
  });

  // 3. Add the old single primary key back
  await knex.schema.alterTable('plan_service_configuration', function(table) {
    console.log("Rolling back: Re-adding old single PK on config_id");
    table.primary('config_id'); // Constraint name will likely be default 'plan_service_configuration_pkey'
  });

  // 4. Re-add the old simple foreign key constraints
  for (const dep of dependents) {
     const tableExists = await knex.schema.hasTable(dep.table);
     if (tableExists) {
        await knex.schema.alterTable(dep.table, function(table) {
          try {
            console.log(`Rolling back: Re-adding simple FK ${dep.constraint} on ${dep.table}`);
            table.foreign('config_id', dep.constraint) // Use original constraint name
                 .references('config_id')
                 .inTable('plan_service_configuration')
                 .onDelete('CASCADE');
          } catch (e) {
            console.error(`Error re-adding simple FK ${dep.constraint} on ${dep.table}: ${e.message}`);
            // Try without specifying constraint name
            try {
              console.log(`Rolling back: Re-adding unnamed simple FK on ${dep.table}`);
              table.foreign('config_id')
                   .references('config_id')
                   .inTable('plan_service_configuration')
                   .onDelete('CASCADE');
            } catch (e2) {
              console.error(`Error re-adding unnamed simple FK on ${dep.table}: ${e2.message}. Manual fix may be required.`);
            }
          }
        });
     }
  }
};
