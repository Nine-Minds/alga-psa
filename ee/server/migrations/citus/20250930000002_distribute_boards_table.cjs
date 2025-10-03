/**
 * Distribute the boards table (renamed from channels) in Citus
 * This migration should run after 20250930000001_rename_channels_to_boards.cjs
 * Dependencies: tenants, categories, tickets, tags, tag_definitions must be distributed first
 */

exports.config = { transaction: false };

exports.up = async function(knex) {
  // Check if we're in recovery mode (read replica/standby)
  const inRecovery = await knex.raw(`SELECT pg_is_in_recovery() as in_recovery`);

  if (inRecovery.rows[0].in_recovery) {
    console.log('Database is in recovery mode (read replica). Skipping Citus distribution.');
    console.log('This migration must run on the primary/coordinator node.');
    return;
  }

  // Check if Citus is enabled
  const citusEnabled = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'citus'
    ) as enabled
  `);

  if (!citusEnabled.rows[0].enabled) {
    console.log('Citus not enabled, skipping boards table distribution');
    return;
  }

  console.log('Distributing boards table (renamed from channels)...');

  // Check if boards table exists
  const boardsExists = await knex.schema.hasTable('boards');
  if (!boardsExists) {
    console.log('boards table does not exist yet - base migration may not have run');
    return;
  }

  // Check if channels table is still distributed (shouldn't be if migration ran)
  const channelsDistributed = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_dist_partition
      WHERE logicalrelid = 'channels'::regclass
    ) as distributed
  `);

  if (channelsDistributed.rows[0].distributed) {
    console.log('Undistributing old channels table...');
    try {
      // First, drop all foreign keys referencing channels
      const foreignKeys = await knex.raw(`
        SELECT DISTINCT
          tc.table_name,
          tc.constraint_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.constraint_column_usage AS ccu USING (constraint_schema, constraint_name)
        WHERE tc.constraint_type = 'FOREIGN KEY'
        AND ccu.table_name = 'channels'
      `);

      for (const fk of foreignKeys.rows) {
        console.log(`  Dropping ${fk.constraint_name} from ${fk.table_name}...`);
        await knex.raw(`ALTER TABLE ${fk.table_name} DROP CONSTRAINT IF EXISTS ${fk.constraint_name}`);
      }

      // Check for any remaining FKs from channels to other tables (like channels -> tenants)
      const channelsFKs = await knex.raw(`
        SELECT
          conname as constraint_name,
          confrelid::regclass as referenced_table
        FROM pg_constraint
        WHERE conrelid = 'channels'::regclass
        AND contype = 'f'
      `);

      for (const fk of channelsFKs.rows) {
        console.log(`  Dropping ${fk.constraint_name} from channels (references ${fk.referenced_table})...`);
        await knex.raw(`ALTER TABLE channels DROP CONSTRAINT IF EXISTS ${fk.constraint_name}`);
      }

      // Use cascade option to handle any remaining FK dependencies
      await knex.raw(`SELECT undistribute_table('channels', cascade_via_foreign_keys=>true)`);
      console.log('  ✓ Undistributed channels table');
    } catch (error) {
      console.log(`  - Could not undistribute channels: ${error.message}`);
    }
  }

  // Check if boards table is already distributed
  const boardsDistributed = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_dist_partition
      WHERE logicalrelid = 'boards'::regclass
    ) as distributed
  `);

  if (boardsDistributed.rows[0].distributed) {
    console.log('  boards table already distributed');
    return;
  }

  try {
    console.log('  Capturing foreign key constraints for boards...');

    // Manually capture FKs instead of using utility
    const capturedFKs = await knex.raw(`
      SELECT
        conname as constraint_name,
        pg_get_constraintdef(c.oid) as definition
      FROM pg_constraint c
      JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE c.conrelid = 'boards'::regclass
      AND c.contype = 'f'
    `);

    console.log('  Dropping foreign key constraints for boards...');
    for (const fk of capturedFKs.rows) {
      try {
        await knex.raw(`ALTER TABLE boards DROP CONSTRAINT IF EXISTS ${fk.constraint_name}`);
        console.log(`    ✓ Dropped FK: ${fk.constraint_name}`);
      } catch (e) {
        console.log(`    - Could not drop ${fk.constraint_name}: ${e.message}`);
      }
    }

    // Drop unique constraints with CASCADE
    console.log('  Dropping unique constraints for boards...');
    const uniqueConstraints = await knex.raw(`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'boards'::regclass
      AND contype = 'u'
    `);

    for (const constraint of uniqueConstraints.rows) {
      try {
        await knex.raw(`ALTER TABLE boards DROP CONSTRAINT ${constraint.conname} CASCADE`);
        console.log(`    ✓ Dropped constraint: ${constraint.conname} with CASCADE`);
      } catch (e) {
        console.log(`    - Could not drop ${constraint.conname}: ${e.message}`);
      }
    }

    // Drop check constraints (except not null)
    console.log('  Dropping check constraints for boards...');
    const checkConstraints = await knex.raw(`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'boards'::regclass
      AND contype = 'c'
      AND conname NOT LIKE '%_not_null'
    `);

    for (const constraint of checkConstraints.rows) {
      try {
        await knex.raw(`ALTER TABLE boards DROP CONSTRAINT ${constraint.conname} CASCADE`);
        console.log(`    ✓ Dropped check constraint: ${constraint.conname}`);
      } catch (e) {
        console.log(`    - Could not drop check ${constraint.conname}: ${e.message}`);
      }
    }

    // Drop triggers if any
    console.log('  Dropping triggers for boards...');
    const triggers = await knex.raw(`
      SELECT tgname
      FROM pg_trigger
      WHERE tgrelid = 'boards'::regclass
      AND tgisinternal = false
    `);

    for (const trigger of triggers.rows) {
      try {
        await knex.raw(`DROP TRIGGER IF EXISTS ${trigger.tgname} ON boards`);
        console.log(`    ✓ Dropped trigger: ${trigger.tgname}`);
      } catch (e) {
        console.log(`    - Could not drop trigger ${trigger.tgname}: ${e.message}`);
      }
    }

    // Distribute the boards table
    console.log('  Distributing boards table...');
    try {
      await knex.raw(`SELECT create_distributed_table('boards', 'tenant', colocate_with => 'tenants')`);
    } catch (e) {
      // If colocation fails, try without it
      console.log(`    Colocation not available, distributing without it...`);
      await knex.raw(`SELECT create_distributed_table('boards', 'tenant')`);
    }
    console.log('    ✓ Distributed boards table');

    // Recreate check constraints
    console.log('  Recreating check constraints for boards...');
    await knex.raw(`
      ALTER TABLE boards
      ADD CONSTRAINT boards_category_type_check
      CHECK (category_type IN ('custom', 'itil'))
    `);

    await knex.raw(`
      ALTER TABLE boards
      ADD CONSTRAINT boards_priority_type_check
      CHECK (priority_type IN ('custom', 'itil'))
    `);
    console.log('    ✓ Recreated check constraints');

    // Recreate indexes
    console.log('  Recreating indexes for boards...');
    await knex.raw(`
      CREATE INDEX IF NOT EXISTS idx_boards_tenant_category_type
      ON boards(tenant, category_type)
    `);

    await knex.raw(`
      CREATE INDEX IF NOT EXISTS idx_boards_tenant_priority_type
      ON boards(tenant, priority_type)
    `);
    console.log('    ✓ Recreated indexes');

    // Recreate foreign keys
    console.log('  Recreating foreign keys for boards...');
    for (const fk of capturedFKs.rows) {
      try {
        await knex.raw(`ALTER TABLE boards ADD CONSTRAINT ${fk.constraint_name} ${fk.definition}`);
        console.log(`    ✓ Recreated FK: ${fk.constraint_name}`);
      } catch (e) {
        console.log(`    - Could not recreate ${fk.constraint_name}: ${e.message}`);
      }
    }

    console.log('\n✓ boards table distributed successfully');

  } catch (error) {
    console.error(`  ✗ Failed to distribute boards table: ${error.message}`);
    throw error;
  }

  // Distribute standard_boards as a reference table
  console.log('\nDistributing standard_boards table...');

  const standardBoardsExists = await knex.schema.hasTable('standard_boards');
  if (standardBoardsExists) {
    const standardBoardsDistributed = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition
        WHERE logicalrelid = 'standard_boards'::regclass
      ) as distributed
    `);

    if (!standardBoardsDistributed.rows[0].distributed) {
      try {
        // Drop check constraints before distribution
        console.log('  Dropping check constraints for standard_boards...');
        const checkConstraints = await knex.raw(`
          SELECT conname
          FROM pg_constraint
          WHERE conrelid = 'standard_boards'::regclass
          AND contype = 'c'
          AND conname NOT LIKE '%_not_null'
        `);

        for (const constraint of checkConstraints.rows) {
          try {
            await knex.raw(`ALTER TABLE standard_boards DROP CONSTRAINT ${constraint.conname} CASCADE`);
            console.log(`    ✓ Dropped check constraint: ${constraint.conname}`);
          } catch (e) {
            console.log(`    - Could not drop check ${constraint.conname}: ${e.message}`);
          }
        }

        // Create reference table
        await knex.raw(`SELECT create_reference_table('standard_boards')`);
        console.log('  ✓ Created standard_boards as reference table');

        // Recreate check constraints
        console.log('  Recreating check constraints for standard_boards...');
        await knex.raw(`
          ALTER TABLE standard_boards
          ADD CONSTRAINT standard_boards_category_type_check
          CHECK (category_type IN ('custom', 'itil'))
        `);

        await knex.raw(`
          ALTER TABLE standard_boards
          ADD CONSTRAINT standard_boards_priority_type_check
          CHECK (priority_type IN ('custom', 'itil'))
        `);
        console.log('    ✓ Recreated check constraints');

      } catch (error) {
        console.error(`  ✗ Failed to distribute standard_boards: ${error.message}`);
        // Don't throw - this is not critical
      }
    } else {
      console.log('  standard_boards already distributed');
    }
  }

  // Now update foreign keys in related tables to reference boards instead of channels
  console.log('\nUpdating foreign keys in related tables to reference boards...');

  const relatedTables = ['categories', 'tickets', 'tag_definitions'];

  for (const table of relatedTables) {
    try {
      const tableExists = await knex.schema.hasTable(table);
      if (!tableExists) {
        console.log(`  ${table} table does not exist, skipping`);
        continue;
      }

      const hasBoardId = await knex.schema.hasColumn(table, 'board_id');
      if (!hasBoardId) {
        console.log(`  ${table} does not have board_id column, skipping`);
        continue;
      }

      const isDistributed = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM pg_dist_partition
          WHERE logicalrelid = '${table}'::regclass
        ) as distributed
      `);

      if (!isDistributed.rows[0].distributed) {
        console.log(`  ${table} is not distributed, skipping FK update`);
        continue;
      }

      console.log(`  Updating ${table} foreign keys...`);

      // Check if foreign key to boards already exists
      const existingFK = await knex.raw(`
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = '${table}'::regclass
        AND confrelid = 'boards'::regclass
        AND contype = 'f'
      `);

      if (existingFK.rows.length === 0) {
        // Create foreign key to boards
        try {
          await knex.raw(`
            ALTER TABLE ${table}
            ADD CONSTRAINT ${table}_board_fkey
            FOREIGN KEY (tenant, board_id)
            REFERENCES boards(tenant, board_id)
          `);
          console.log(`    ✓ Added foreign key from ${table} to boards`);
        } catch (e) {
          console.log(`    - Could not add FK from ${table} to boards: ${e.message}`);
        }
      } else {
        console.log(`    - Foreign key from ${table} to boards already exists`);
      }

    } catch (error) {
      console.log(`  - Error updating ${table}: ${error.message}`);
    }
  }

  console.log('\n✓ Boards table distribution and FK updates completed');
};

exports.down = async function(knex) {
  const citusEnabled = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'citus'
    ) as enabled
  `);

  if (!citusEnabled.rows[0].enabled) {
    return;
  }

  console.log('Undistributing boards table...');

  try {
    const isDistributed = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition
        WHERE logicalrelid = 'boards'::regclass
      ) as distributed
    `);

    if (isDistributed.rows[0].distributed) {
      await knex.raw(`SELECT undistribute_table('boards')`);
      console.log('  ✓ Undistributed boards table');
    }
  } catch (error) {
    console.error(`  ✗ Failed to undistribute boards: ${error.message}`);
  }

  // If channels table exists, re-distribute it
  const channelsExists = await knex.schema.hasTable('channels');
  if (channelsExists) {
    console.log('Re-distributing channels table...');
    try {
      const channelsDistributed = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM pg_dist_partition
          WHERE logicalrelid = 'channels'::regclass
        ) as distributed
      `);

      if (!channelsDistributed.rows[0].distributed) {
        await knex.raw(`SELECT create_distributed_table('channels', 'tenant', colocate_with => 'tenants')`);
        console.log('  ✓ Re-distributed channels table');
      }
    } catch (error) {
      console.error(`  ✗ Failed to re-distribute channels: ${error.message}`);
    }
  }
};