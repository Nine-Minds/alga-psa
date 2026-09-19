/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Define dependent tables and their CORRECT FK constraint names
  const dependents = [
    { table: 'plan_service_fixed_config', constraint: 'plan_service_fixed_config_tenant_config_id_foreign' },
    { table: 'plan_service_hourly_config', constraint: 'pshc_tenant_config_id_fk' },
    { table: 'plan_service_usage_config', constraint: 'psuc_tenant_config_id_fk' },
    { table: 'plan_service_bucket_config', constraint: 'psbc_tenant_config_id_fk' },
    { table: 'plan_service_rate_tiers', constraint: 'psrt_tenant_config_id_fk' },
  ];

  // Use a transaction for the entire cleanup and modification process
  await knex.transaction(async (trx) => {
    // 1. Dependent foreign keys will be dropped automatically via CASCADE when PK is dropped.
    //    Manual dropping loop removed.

    // 2. Drop the existing primary key constraint on plan_service_configuration
    console.log("Checking for existing primary key on plan_service_configuration...");
    const pkCheck = await trx.raw(`
      SELECT c.conname AS constraint_name
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      WHERE c.contype = 'p'
      AND t.relname = 'plan_service_configuration'
      AND c.connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())
    `); // Added schema check

    const pkName = (pkCheck.rows && pkCheck.rows.length > 0) ? pkCheck.rows[0].constraint_name : null;

    if (pkName) {
      console.log(`Found primary key constraint ${pkName}, dropping it`);
      try {
        // Use raw SQL with IF EXISTS for safety, referencing the found name
        await trx.raw(`ALTER TABLE plan_service_configuration DROP CONSTRAINT IF EXISTS ?? CASCADE`, [pkName]); // Added CASCADE
        console.log(`Successfully dropped primary key constraint ${pkName}`);
      } catch (e) {
         console.error(`CRITICAL ERROR dropping primary key constraint ${pkName}: ${e.message}`);
         throw e; // Abort the transaction
      }
    } else {
      console.log("No primary key constraint found on plan_service_configuration or table doesn't exist.");
    }

    // 3. Add the new composite primary key
    console.log("Adding new composite PK (tenant, config_id) named plan_service_configuration_comp_pkey");
    try {
      // Ensure table exists before adding PK
      const tableExists = await trx.schema.hasTable('plan_service_configuration');
      if (tableExists) {
         // Check if PK already exists before trying to add
         const newPkCheck = await trx.raw(`SELECT conname FROM pg_constraint WHERE conrelid = 'plan_service_configuration'::regclass AND contype = 'p'`);
         if (newPkCheck.rows.length === 0) {
            await trx.raw(`ALTER TABLE plan_service_configuration ADD CONSTRAINT plan_service_configuration_comp_pkey PRIMARY KEY (tenant, config_id)`);
            console.log("Successfully added composite primary key plan_service_configuration_comp_pkey");
         } else {
            console.log(`Primary key ${newPkCheck.rows[0].conname} already exists, skipping add.`);
         }
      } else {
         console.error("Cannot add PK, table plan_service_configuration does not exist.");
         throw new Error("Table plan_service_configuration not found for adding PK.");
      }
    } catch (e) {
       console.error(`CRITICAL ERROR adding composite primary key: ${e.message}`);
       throw e; // Abort the transaction
    }

    // 4. Re-add the foreign key constraints using the correct names
    console.log('Re-adding foreign key constraints...');
    for (const dep of dependents) {
      try {
        const tableExists = await trx.schema.hasTable(dep.table);
        if (tableExists) {
           // Check if constraint already exists before adding
           const fkExistsCheck = await trx.raw(`SELECT conname FROM pg_constraint WHERE conname = ? AND conrelid = ?::regclass`, [dep.constraint, dep.table]);
           if (fkExistsCheck.rows.length === 0) {
              console.log(`Re-adding constraint ${dep.constraint} to table ${dep.table}`);
              await trx.raw(`
                ALTER TABLE ??
                ADD CONSTRAINT ??
                FOREIGN KEY (tenant, config_id)
                REFERENCES plan_service_configuration(tenant, config_id)
                ON DELETE CASCADE
              `, [dep.table, dep.constraint]); // Use correct constraint name from dependents array
              console.log(`Successfully re-added FK ${dep.constraint} to ${dep.table}`);
           } else {
              console.log(`Constraint ${dep.constraint} already exists on ${dep.table}, skipping re-add.`);
           }
        } else {
           console.log(`Table ${dep.table} does not exist, skipping FK re-add.`);
        }
      } catch (e) {
        console.error(`CRITICAL ERROR re-adding constraint ${dep.constraint} to ${dep.table}: ${e.message}`);
        throw e; // Abort the transaction
      }
    }
    console.log('Finished re-adding foreign keys.');

  }); // End transaction
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Reverse order of operations for rollback
  console.log("Starting rollback for alter_plan_service_configuration_pk migration...");

  const dependents = [
    { table: 'plan_service_fixed_config', constraint: 'plan_service_fixed_config_tenant_config_id_foreign' },
    { table: 'plan_service_hourly_config', constraint: 'pshc_tenant_config_id_fk' },
    { table: 'plan_service_usage_config', constraint: 'psuc_tenant_config_id_fk' },
    { table: 'plan_service_bucket_config', constraint: 'psbc_tenant_config_id_fk' },
    { table: 'plan_service_rate_tiers', constraint: 'psrt_tenant_config_id_fk' },
  ];

  await knex.transaction(async (trx) => {
    // 1. Drop the foreign key constraints added in the 'up' migration
    console.log("Rolling back: Dropping foreign key constraints...");
    for (const dep of dependents) {
      try {
        const tableExists = await trx.schema.hasTable(dep.table);
        if (tableExists) {
          console.log(`Rolling back: Dropping constraint ${dep.constraint} on ${dep.table} IF EXISTS`);
          await trx.raw(`ALTER TABLE ?? DROP CONSTRAINT IF EXISTS ??`, [dep.table, dep.constraint]);
        } else {
           console.log(`Table ${dep.table} does not exist, skipping constraint drop during rollback.`);
        }
      } catch (e) {
        console.warn(`Warning during rollback: Error dropping constraint ${dep.constraint} on ${dep.table}: ${e.message}. Continuing rollback.`);
      }
    }

    // 2. Drop the composite primary key constraint added in the 'up' migration
    console.log("Rolling back: Dropping composite PK plan_service_configuration_comp_pkey IF EXISTS");
    try {
      await trx.raw(`ALTER TABLE plan_service_configuration DROP CONSTRAINT IF EXISTS plan_service_configuration_comp_pkey`);
    } catch (e) {
       console.warn(`Warning during rollback: Error dropping composite PK plan_service_configuration_comp_pkey: ${e.message}. Continuing rollback.`);
    }

    // 3. Re-add the original primary key (assuming it was single column 'config_id' and named 'plan_service_configuration_pkey')
    console.log("Rolling back: Attempting to re-add original PK plan_service_configuration_pkey on config_id");
    try {
       const tableExists = await trx.schema.hasTable('plan_service_configuration');
       if (tableExists) {
          const colInfo = await trx('plan_service_configuration').columnInfo();
          if (colInfo.config_id) {
             const pkCheck = await trx.raw(`SELECT conname FROM pg_constraint WHERE conrelid = 'plan_service_configuration'::regclass AND contype = 'p'`);
             if (pkCheck.rows.length === 0) {
                await trx.raw(`ALTER TABLE plan_service_configuration ADD CONSTRAINT plan_service_configuration_pkey PRIMARY KEY (config_id)`);
                console.log("Rolling back: Successfully re-added original PK plan_service_configuration_pkey");
             } else {
                console.log(`Rolling back: PK ${pkCheck.rows[0].conname} already exists, skipping re-add.`);
             }
          } else {
             console.warn("Rolling back: Column config_id not found, cannot re-add original PK.");
          }
       } else {
          console.warn("Rolling back: Table plan_service_configuration not found, cannot re-add original PK.");
       }
    } catch (e) {
       console.error(`Error during rollback: Failed to re-add original PK: ${e.message}`);
    }

    // 4. Re-add the original foreign key constraints (assuming simple FKs on config_id)
    console.log("Rolling back: Attempting to re-add original simple FKs...");
    for (const dep of dependents) {
       try {
          const tableExists = await trx.schema.hasTable(dep.table);
          const colInfo = tableExists ? await trx(dep.table).columnInfo() : null;
          if (tableExists && colInfo && colInfo.config_id) {
             const fkCheck = await trx.raw(`SELECT conname FROM pg_constraint WHERE conrelid = ?::regclass AND confrelid = 'plan_service_configuration'::regclass AND contype = 'f'`, [dep.table]);
             if (fkCheck.rows.length === 0) {
                console.log(`Rolling back: Re-adding simple FK on ${dep.table} referencing config_id`);
                await trx.raw(`ALTER TABLE ?? ADD CONSTRAINT ?? FOREIGN KEY (config_id) REFERENCES plan_service_configuration(config_id) ON DELETE CASCADE`, [dep.table, `${dep.table}_config_id_fk_rollback`]);
             } else {
                console.log(`Rolling back: FK already exists on ${dep.table}, skipping re-add.`);
             }
          } else {
             console.log(`Rolling back: Table ${dep.table} or column config_id missing, skipping FK re-add.`);
          }
       } catch (e) {
          console.warn(`Warning during rollback: Error re-adding simple FK on ${dep.table}: ${e.message}. Continuing rollback.`);
       }
    }
  }); // End transaction
  console.log("Finished rollback attempt for alter_plan_service_configuration_pk migration.");
};
