/**
 * Distribute the boards table (renamed from channels) in Citus
 * This migration should run after the base migration that renames channels to boards
 * Dependencies: tenants, categories, tickets, tags, tag_definitions must be distributed first
 */
const {
  dropAndCaptureForeignKeys,
  recreateForeignKeys
} = require('./utils/foreign_key_manager.cjs');

exports.config = { transaction: false };

exports.up = async function(knex) {
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
      await knex.raw(`SELECT undistribute_table('channels')`);
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
    console.log('  Capturing and dropping foreign key constraints for boards...');
    const capturedFKs = await dropAndCaptureForeignKeys(knex, 'boards');

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
    await knex.raw(`SELECT create_distributed_table('boards', 'tenant', colocate_with => 'tenants')`);
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
    await recreateForeignKeys(knex, 'boards', capturedFKs);

    console.log('\n✓ boards table distributed successfully');

  } catch (error) {
    console.error(`  ✗ Failed to distribute boards table: ${error.message}`);
    throw error;
  }

  // Now update foreign keys in related tables to reference boards instead of channels
  console.log('\nUpdating foreign keys in related tables to reference boards...');

  const relatedTables = ['categories', 'tickets', 'tags', 'tag_definitions'];

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