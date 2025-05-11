'use strict';

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  // Phase 1: Database Schema and Data Migration
  // 1.A. Create system_workflow_task_definitions Table
  // Check if table already exists from a previous partial run, if so, skip creation.
  const systemTableExists = await knex.schema.hasTable('system_workflow_task_definitions');
  if (!systemTableExists) {
    await knex.schema.createTable('system_workflow_task_definitions', function (table) {
      table.text('task_type').primary();
      table.text('name').notNullable();
      table.text('description').nullable();
      // Assuming system_workflow_form_definitions.name is the correct reference
      table.text('form_id').notNullable().references('name').inTable('system_workflow_form_definitions');
      table.text('form_type').notNullable().defaultTo('system');
      table.text('default_priority').nullable();
      table.integer('default_sla_days').nullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());
    });
  }

  // 1.B. Migrate Data to system_workflow_task_definitions
  const systemTaskDefinitionsToMigrate = await knex('workflow_task_definitions')
    .where('tenant', 'system')
    .select(
      'task_definition_id', // This holds the task_type for system tasks
      'name',
      'description',
      'form_id', // This should be the name of the form in system_workflow_form_definitions
      'default_priority',
      'default_sla_days',
      'created_at',
      'updated_at'
    );

  if (systemTaskDefinitionsToMigrate.length > 0) {
    const mappedSystemTaskDefinitions = systemTaskDefinitionsToMigrate.map((def) => ({
      task_type: def.task_definition_id, // task_definition_id from old table is task_type in new
      name: def.name,
      description: def.description,
      form_id: def.form_id, // Ensure this maps to system_workflow_form_definitions.name
      form_type: 'system', // Explicitly set for system definitions
      default_priority: def.default_priority,
      default_sla_days: def.default_sla_days,
      created_at: def.created_at || knex.fn.now(),
      updated_at: def.updated_at || knex.fn.now(),
    }));
    // Use onConflict to avoid issues if this migration is re-run and data already exists.
    // This assumes 'task_type' is the primary key and conflict target.
    await knex('system_workflow_task_definitions').insert(mappedSystemTaskDefinitions).onConflict('task_type').merge();
  }

  // 1.C. Remove Migrated Data from workflow_task_definitions
  await knex('workflow_task_definitions').where('tenant', 'system').del();

  // 1.D. Modify workflow_tasks Table
  // Add task_definition_type column if it doesn't exist
  if (!(await knex.schema.hasColumn('workflow_tasks', 'task_definition_type'))) {
    await knex.schema.alterTable('workflow_tasks', function (table) {
      table.text('task_definition_type').nullable();
    });
  }

  // Add system_task_definition_task_type column if it doesn't exist
  if (!(await knex.schema.hasColumn('workflow_tasks', 'system_task_definition_task_type'))) {
    await knex.schema.alterTable('workflow_tasks', function (table) {
      table.text('system_task_definition_task_type').nullable();
    });
  }

  // 3. Data Update Pass 1: For existing tasks that should link to system definitions
  // The previous raw SQL update has been removed.
  // We will rely on the systemTaskTypes derived from explicitly migrated definitions.

  // The systemTaskDefinitionsToMigrate variable contains definitions that were in workflow_task_definitions with tenant = 'system'.
  // Their task_definition_id field held the string task_type.
  const systemTaskTypes = systemTaskDefinitionsToMigrate.map(def => def.task_definition_id);

  if (systemTaskTypes.length > 0) {
    // This update targets tasks whose task_definition_id matches one of the identified system task types.
    await knex('workflow_tasks')
        .whereIn('task_definition_id', systemTaskTypes)
        .update({
            task_definition_type: 'system',
            system_task_definition_task_type: knex.raw('task_definition_id'), // Copy the string task_type to the new system FK column
            task_definition_id: null, // Nullify the old task_definition_id for these system tasks
        });
  }


  // 4. Data Update Pass 2: For remaining tasks (which link to tenant definitions)
  await knex('workflow_tasks')
    .whereNull('task_definition_type') // Only update those not set in Pass 1
    .whereNotNull('task_definition_id') // And have a tenant definition
    .update({
      task_definition_type: 'tenant',
    });
  
    // Destructive Data Cleaning: Nullify task_definition_id for tenant tasks if it's not a valid UUID string
    console.log("Destructive Data Cleaning: Nullifying invalid task_definition_ids for tenant tasks.");
    // This regex checks for a standard UUID format.
    // We only care about rows that are supposed to be tenant tasks.
    // task_definition_type should be 'tenant' for these at this point,
    // or task_definition_id is not NULL AND task_definition_type is not 'system'.
    await knex.raw(`
      UPDATE workflow_tasks
      SET task_definition_id = NULL
      WHERE
        (
          task_definition_type = 'tenant' OR
          (task_definition_id IS NOT NULL AND (task_definition_type IS NULL OR task_definition_type != 'system'))
        )
        AND task_definition_id IS NOT NULL
        AND NOT task_definition_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
    `);
    console.log("Destructive Data Cleaning: Finished nullifying invalid task_definition_ids.");
  
    // Phase C: Ensure tenant_task_definition_id column exists and is correctly typed using knex.raw()
  console.log("Starting Phase C: Ensure tenant_task_definition_id column via raw DDL.");

  const initialHasTenantTaskDefId = await knex.schema.hasColumn('workflow_tasks', 'tenant_task_definition_id');
  const initialHasOriginalTaskDefId = await knex.schema.hasColumn('workflow_tasks', 'task_definition_id');

  if (!initialHasTenantTaskDefId && initialHasOriginalTaskDefId) {
    console.log("Raw DDL: 'task_definition_id' exists, 'tenant_task_definition_id' does not. Renaming.");
    try {
      await knex.raw('ALTER TABLE workflow_tasks DROP CONSTRAINT IF EXISTS workflow_tasks_task_definition_id_foreign;');
      console.log("Raw DDL: Dropped FK 'workflow_tasks_task_definition_id_foreign' (if existed).");
    } catch (e) {
      console.warn("Raw DDL: Error dropping FK 'workflow_tasks_task_definition_id_foreign':", e.message);
    }
    await knex.raw('ALTER TABLE workflow_tasks RENAME COLUMN task_definition_id TO tenant_task_definition_id;');
    console.log("Raw DDL: Renamed 'task_definition_id' to 'tenant_task_definition_id'.");
  } else if (!initialHasTenantTaskDefId && !initialHasOriginalTaskDefId) {
    console.log("Raw DDL: Neither column exists. Adding 'tenant_task_definition_id' as UUID NULL.");
    await knex.raw('ALTER TABLE workflow_tasks ADD COLUMN tenant_task_definition_id UUID NULL;');
  } else if (initialHasTenantTaskDefId && initialHasOriginalTaskDefId) {
    console.warn("Raw DDL: Both 'tenant_task_definition_id' and 'task_definition_id' exist. Dropping 'task_definition_id'.");
    try {
      await knex.raw('ALTER TABLE workflow_tasks DROP CONSTRAINT IF EXISTS workflow_tasks_task_definition_id_foreign;');
      console.log("Raw DDL: Dropped FK 'workflow_tasks_task_definition_id_foreign' (if existed) before dropping column.");
    } catch (e) {
      console.warn("Raw DDL: Error dropping FK 'workflow_tasks_task_definition_id_foreign' before dropping column:", e.message);
    }
    await knex.raw('ALTER TABLE workflow_tasks DROP COLUMN IF EXISTS task_definition_id;');
    console.log("Raw DDL: Dropped 'task_definition_id'.");
  } else {
    console.log("Raw DDL: 'tenant_task_definition_id' already exists, 'task_definition_id' does not. No action needed for column presence.");
  }

  // Ensure the column type is UUID and nullable after creation/rename.
  // This is important because RENAME might not preserve type details perfectly or ADD might need specific casting.
  // Only attempt if we believe the column should now exist.
  const afterRenameHasTenantTaskDefId = await knex.schema.hasColumn('workflow_tasks', 'tenant_task_definition_id');
  if (afterRenameHasTenantTaskDefId) {
    console.log("Raw DDL: Ensuring 'tenant_task_definition_id' is type UUID and nullable.");
    // PostgreSQL specific way to alter type.
    // With the destructive cleaning step, all remaining non-NULL values should be valid UUID strings.
    console.log("Raw DDL: Altering 'tenant_task_definition_id' TYPE UUID USING explicit cast.");
    await knex.raw('ALTER TABLE workflow_tasks ALTER COLUMN tenant_task_definition_id TYPE UUID USING tenant_task_definition_id::uuid, ALTER COLUMN tenant_task_definition_id SET DEFAULT NULL, ALTER COLUMN tenant_task_definition_id DROP NOT NULL;');
    // The above ensures it's UUID (with explicit cast), allows NULLs, and removes any NOT NULL constraint if accidentally set.
  } else {
    console.error("CRITICAL ERROR: 'tenant_task_definition_id' column STILL does not exist after raw DDL attempts. Further operations will likely fail.");
  }

  // Phase D: Schema changes for Foreign Keys and NOT NULL constraints using Knex schema builder
  console.log("Starting Phase D: Add Foreign Keys and NOT NULL constraints using Knex schema builder.");
  await knex.schema.alterTable('workflow_tasks', async function (table) {
    // Add FK for tenant_task_definition_id
    if (await knex.schema.hasColumn('workflow_tasks', 'tenant_task_definition_id')) {
      console.log("Knex Schema: Setting up FK for 'tenant_task_definition_id'.");
      try {
        // Attempt to drop by specific name first for robustness
        await knex.raw('ALTER TABLE workflow_tasks DROP CONSTRAINT IF EXISTS workflow_tasks_tenant_task_definition_id_fkey;');
        // Fallback to Knex's dropForeign by column list
        table.dropForeign(['tenant_task_definition_id']);
      } catch (e) {
        // console.warn("Knex Schema: Could not drop FK on 'tenant_task_definition_id' (may not exist or different name):", e.message);
      }
      table.foreign('tenant_task_definition_id')
           .references('task_definition_id').inTable('workflow_task_definitions')
           .onDelete('SET NULL').onUpdate('CASCADE');
      console.log("Knex Schema: Configured FK for 'tenant_task_definition_id'.");
    } else {
      console.error("Knex Schema: Cannot add FK - 'tenant_task_definition_id' column missing in Phase D.");
    }

    // Add FK for system_task_definition_task_type
    if (await knex.schema.hasColumn('workflow_tasks', 'system_task_definition_task_type')) {
      console.log("Knex Schema: Setting up FK for 'system_task_definition_task_type'.");
      try {
        await knex.raw('ALTER TABLE workflow_tasks DROP CONSTRAINT IF EXISTS workflow_tasks_system_task_definition_task_type_fkey;');
        table.dropForeign(['system_task_definition_task_type']);
      } catch (e) { /* ignore */ }
      table.foreign('system_task_definition_task_type').references('task_type').inTable('system_workflow_task_definitions').onDelete('SET NULL').onUpdate('CASCADE');
      console.log("Knex Schema: Configured FK for 'system_task_definition_task_type'.");
    }

    // Make task_definition_type NOT NULL
    if (await knex.schema.hasColumn('workflow_tasks', 'task_definition_type')) {
      console.log("Knex Schema: Altering 'task_definition_type' to NOT NULL.");
      // Data population for this column happens in lines 83-101.
      // If any rows are still NULL, this will fail, which is the correct behavior.
      table.text('task_definition_type').notNullable().alter();
    }
  });

  // Phase E: Add CHECK constraint
    // Note: SQLite does not support adding check constraints via ALTER TABLE directly in older versions.
    // For PostgreSQL, MySQL 8.0.16+, SQL Server this is fine.
    // This raw query is more portable for complex constraints.
    // The constraint name chk_task_def_type might need to be unique globally or per schema depending on DB.
    try {
        await knex.raw(`
        ALTER TABLE workflow_tasks
        ADD CONSTRAINT chk_task_def_type CHECK (
            (task_definition_type = 'tenant' AND tenant_task_definition_id IS NOT NULL AND system_task_definition_task_type IS NULL) OR
            (task_definition_type = 'system' AND system_task_definition_task_type IS NOT NULL AND tenant_task_definition_id IS NULL)
        );
        `);
    } catch (e) {
        // console.warn("Could not add CHECK constraint 'chk_task_def_type'. This might be due to DB limitations (e.g., older SQLite) or existing data violating it.", e.message);
        // If data violates it, the previous steps need to ensure data consistency.
    }

    // Ensure specific system task definitions like 'qbo_mapping_error' and 'secret_fetch_error' exist.
    // This was in the original script, good to keep.
    const systemDefsToEnsure = [
        {
            task_type: 'qbo_mapping_error',
            name: 'QBO Mapping Error',
            description: 'Resolve QuickBooks Online mapping errors.',
            form_id: 'qbo-mapping-error-form', // Ensure this form exists in system_workflow_form_definitions
            form_type: 'system',
            default_priority: 'high',
        },
        {
            task_type: 'secret_fetch_error',
            name: 'Secret Fetch Error',
            description: 'Resolve errors related to fetching secrets.',
            form_id: 'secret-fetch-error-form', // Ensure this form exists
            form_type: 'system',
            default_priority: 'high',
        }
    ];

    for (const def of systemDefsToEnsure) {
        const exists = await knex('system_workflow_task_definitions').where('task_type', def.task_type).first();
        if (!exists) {
            await knex('system_workflow_task_definitions').insert(def);
        }
    }
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function (knex) {
  // Revert all changes made in the `up` method in reverse order

  // Drop CHECK constraint (if it was successfully added)
  try {
    await knex.raw('ALTER TABLE workflow_tasks DROP CONSTRAINT IF EXISTS chk_task_def_type;');
  } catch (e) {
    // console.warn("Could not drop CHECK constraint 'chk_task_def_type'. It might not exist or DB doesn't support IF EXISTS easily.", e.message);
  }

  await knex.schema.alterTable('workflow_tasks', async function (table) {
    // Drop Foreign Key for system_task_definition_task_type
    // Constraint name might be auto-generated, e.g., workflow_tasks_system_task_definition_task_type_foreign
    // It's safer to specify the column if Knex supports it, or find the constraint name.
    if (await knex.schema.hasColumn('workflow_tasks', 'system_task_definition_task_type')) {
        try {
            // Knex typically uses [table]_[column]_foreign convention for FK names
            await table.dropForeign(['system_task_definition_task_type']);
        } catch (e) {
            // console.warn("Could not drop FK on system_task_definition_task_type. Constraint name might be different.", e.message);
        }
    }

    // Drop Foreign Key for tenant_task_definition_id (if it was re-added on this name)
    // Constraint name might be workflow_tasks_tenant_task_definition_id_foreign
    if (await knex.schema.hasColumn('workflow_tasks', 'tenant_task_definition_id')) {
        try {
            await table.dropForeign(['tenant_task_definition_id']);
        } catch (e) {
            // console.warn("Could not drop FK on tenant_task_definition_id. Constraint name might be different.", e.message);
        }
    }
  });


  // Data restoration and column renaming logic for workflow_tasks
  const sysTaskDefTypeColExists = await knex.schema.hasColumn('workflow_tasks', 'system_task_definition_task_type');
  const taskDefTypeColExists = await knex.schema.hasColumn('workflow_tasks', 'task_definition_type');
  const tnTaskDefIdExists = await knex.schema.hasColumn('workflow_tasks', 'tenant_task_definition_id');
  const originalTaskDefIdExists = await knex.schema.hasColumn('workflow_tasks', 'task_definition_id');

  if (sysTaskDefTypeColExists && taskDefTypeColExists) { // Only attempt to use these columns if they exist
    if (tnTaskDefIdExists) {
      // `tenant_task_definition_id` exists.
      // Populate `tenant_task_definition_id` with system task types for system tasks.
      await knex.raw(`
        UPDATE workflow_tasks
        SET tenant_task_definition_id = system_task_definition_task_type
        WHERE task_definition_type = 'system' AND system_task_definition_task_type IS NOT NULL;
      `);

      await knex.schema.alterTable('workflow_tasks', async function (table) {
        if (originalTaskDefIdExists) {
          // console.warn("Both tenant_task_definition_id and task_definition_id exist. Dropping task_definition_id before rename.");
          await table.dropColumn('task_definition_id');
        }
        await table.renameColumn('tenant_task_definition_id', 'task_definition_id');
      });
    } else if (originalTaskDefIdExists) {
      // `tenant_task_definition_id` does NOT exist, but `task_definition_id` (original name) DOES.
      // Populate `task_definition_id` directly.
      await knex.raw(`
        UPDATE workflow_tasks
        SET task_definition_id = system_task_definition_task_type
        WHERE task_definition_type = 'system' AND system_task_definition_task_type IS NOT NULL;
      `);
    } else {
      // console.warn("Neither tenant_task_definition_id nor task_definition_id exist for data restoration. Skipping.");
    }
  } else {
    // console.warn("system_task_definition_task_type or task_definition_type column does not exist. Skipping data restoration for system tasks.");
    // If these columns don't exist, it implies the 'up' migration didn't get far enough to create them,
    // or a previous 'down' already removed them. So, no data to copy from them.
    // Still need to handle renaming if tenant_task_definition_id exists but task_definition_id doesn't.
    if (tnTaskDefIdExists && !originalTaskDefIdExists) {
        await knex.schema.alterTable('workflow_tasks', async function (table) {
            await table.renameColumn('tenant_task_definition_id', 'task_definition_id');
        });
    }
  }

  // Drop the new columns introduced by the 'up' migration
  await knex.schema.alterTable('workflow_tasks', async function (table) {
    if (sysTaskDefTypeColExists) { // Check again before dropping
      table.dropColumn('system_task_definition_task_type');
    }
    if (await knex.schema.hasColumn('workflow_tasks', 'task_definition_type')) {
      table.dropColumn('task_definition_type');
    }
  });

  // Move data from system_workflow_task_definitions back to workflow_task_definitions
  const systemTaskDefinitionsToMoveBack = await knex('system_workflow_task_definitions').select('*');

  if (systemTaskDefinitionsToMoveBack.length > 0) {
    const mappedToOldTable = systemTaskDefinitionsToMoveBack.map((def) => ({
      task_definition_id: def.task_type, // task_type becomes task_definition_id (string) for the PK
      task_type: def.task_type,          // Populate the task_type column as well
      tenant: 'system',                   // Set tenant back to 'system'
      name: def.name,
      description: def.description,
      // form_id from system table maps to form_id in old table (assuming it was text)
      // The original migration used form_definition_id, if that was the actual column name:
      form_id: def.form_id, // or form_definition_id: def.form_id
      // form_type: 'system', // Old table workflow_task_definitions didn't have form_type
      default_priority: def.default_priority,
      default_sla_days: def.default_sla_days,
      created_at: def.created_at,
      updated_at: def.updated_at,
      // Any other columns that were in workflow_task_definitions for system tasks
      // e.g., form_definition_type might be needed if it existed.
    }));
    // This assumes workflow_task_definitions can accept these (e.g. task_definition_id can be string)
    // and that tenant column exists.
    await knex('workflow_task_definitions').insert(mappedToOldTable).onConflict('task_definition_id').ignore(); // Or .merge() if appropriate
  }

  // Drop system_workflow_task_definitions table
  await knex.schema.dropTableIfExists('system_workflow_task_definitions');

  // Note: Reverting changes to 20250509175818_add_qbo_invoice_sync_forms.cjs (Step 1.E)
  // would involve manually editing that file's `down` method to re-insert system tasks
  // into workflow_task_definitions if this current migration's `down` method is run.
  // This script cannot directly modify other migration files.
};
