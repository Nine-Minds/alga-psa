/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Define dependent tables and their FK constraint names
  const dependents = [
    { table: 'plan_service_fixed_config', constraint: 'plan_service_fixed_config_config_id_foreign' },
    { table: 'plan_service_hourly_config', constraint: 'plan_service_hourly_config_config_id_foreign' }, // Note: This table might not exist yet when this runs first time, handle potential error
    { table: 'plan_service_usage_config', constraint: 'plan_service_usage_config_config_id_foreign' },
    { table: 'plan_service_bucket_config', constraint: 'plan_service_bucket_config_config_id_foreign' },
    { table: 'plan_service_rate_tiers', constraint: 'plan_service_rate_tiers_config_id_foreign' },
    // Add user_type_rates if it also depends directly on plan_service_configuration PK (check its migration)
    // Based on 20250318200000 migration, user_type_rates depends on plan_service_hourly_config, so it's indirectly handled.
  ];

  // 1. Drop dependent foreign key constraints
  for (const dep of dependents) {
    await knex.schema.alterTable(dep.table, function(table) {
      try {
        console.log(`Dropping FK constraint ${dep.constraint} on table ${dep.table}`);
        table.dropForeign(['config_id'], dep.constraint); // Assuming simple FK on config_id initially
      } catch (e) {
         // If the FK was already composite or named differently, this might fail.
         // Attempt dropping composite FK as a fallback for tables potentially created with composite FKs already
         try {
            console.warn(`Failed to drop simple FK ${dep.constraint}, attempting composite drop...`);
            table.dropForeign(['tenant', 'config_id'], dep.constraint);
         } catch (e2) {
            console.error(`Error dropping FK constraint ${dep.constraint} on table ${dep.table}: ${e2.message}. Manual check might be needed if schema diverged.`);
            // If the table doesn't exist yet (like plan_service_hourly_config on first run), ignore error
            if (!e2.message.includes('does not exist')) {
                 throw e2; // Re-throw if it's not a "table doesn't exist" error
            } else {
                 console.log(`Table ${dep.table} likely doesn't exist yet, skipping FK drop.`);
            }
         }
      }
    });
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

  // 4. Re-add the foreign key constraints referencing the new composite key
  for (const dep of dependents) {
     // Check if table exists before trying to add constraint (for plan_service_hourly_config case)
     const tableExists = await knex.schema.hasTable(dep.table);
     if (tableExists) {
        await knex.schema.alterTable(dep.table, function(table) {
            console.log(`Re-adding composite FK constraint ${dep.constraint} on table ${dep.table}`);
            table.foreign(['tenant', 'config_id'], dep.constraint) // Use original constraint name
                 .references(['tenant', 'config_id'])
                 .inTable('plan_service_configuration')
                 .onDelete('CASCADE'); // Ensure CASCADE is reapplied if needed
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

  // 1. Drop the composite foreign key constraints
  for (const dep of dependents) {
     const tableExists = await knex.schema.hasTable(dep.table);
     if (tableExists) {
        await knex.schema.alterTable(dep.table, function(table) {
          try {
            console.log(`Rolling back: Dropping composite FK ${dep.constraint} on ${dep.table}`);
            table.dropForeign(['tenant', 'config_id'], dep.constraint);
          } catch (e) {
            console.error(`Error dropping composite FK ${dep.constraint} on ${dep.table} during rollback: ${e.message}`);
            // Don't throw, try to continue rollback
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
          console.log(`Rolling back: Re-adding simple FK ${dep.constraint} on ${dep.table}`);
          table.foreign('config_id', dep.constraint) // Use original constraint name
               .references('config_id')
               .inTable('plan_service_configuration')
               .onDelete('CASCADE');
        });
     }
  }
};
