/**
 * Cleanup migration to drop old channels tables and channel_id columns
 * This should only run AFTER verifying the boards migration was successful
 *
 * IMPORTANT: Only run this after:
 * 1. The base rename migration (20250930000001) has completed
 * 2. The EE Citus distribution migration (20250930000002) has completed (if using EE)
 * 3. Application code has been updated to use boards instead of channels
 * 4. Application has been tested with the new boards tables
 * 5. All data has been verified
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.config = { transaction: false };

exports.up = async function(knex) {
  console.log('Starting cleanup of old channels tables and columns...');

  // Verify boards table exists before proceeding
  const boardsExists = await knex.schema.hasTable('boards');
  if (!boardsExists) {
    console.log('ERROR: boards table does not exist! Aborting cleanup.');
    throw new Error('boards table must exist before running cleanup migration');
  }

  const standardBoardsExists = await knex.schema.hasTable('standard_boards');
  if (!standardBoardsExists) {
    console.log('ERROR: standard_boards table does not exist! Aborting cleanup.');
    throw new Error('standard_boards table must exist before running cleanup migration');
  }

  // Sync any new data that was added between migrations
  const channelsExists = await knex.schema.hasTable('channels');
  if (channelsExists) {
    console.log('Syncing any new data from channels to boards...');

    // Find records in channels that don't exist in boards
    const newRecords = await knex.raw(`
      SELECT c.*
      FROM channels c
      LEFT JOIN boards b ON c.tenant = b.tenant AND c.channel_id = b.board_id
      WHERE b.board_id IS NULL
    `);

    if (newRecords.rows.length > 0) {
      console.log(`  Found ${newRecords.rows.length} new records to sync...`);

      // Insert new records into boards
      await knex.raw(`
        INSERT INTO boards (
          tenant, board_id, board_name, display_contact_name_id, display_priority,
          display_severity, display_urgency, display_impact, display_category,
          display_subcategory, display_assigned_to, display_status, display_due_date,
          is_inactive, is_default, display_itil_impact, display_itil_urgency, category_type,
          priority_type, display_order, description
        )
        SELECT
          c.tenant, c.channel_id, c.channel_name, c.display_contact_name_id, c.display_priority,
          c.display_severity, c.display_urgency, c.display_impact, c.display_category,
          c.display_subcategory, c.display_assigned_to, c.display_status, c.display_due_date,
          c.is_inactive, c.is_default, c.display_itil_impact, c.display_itil_urgency, c.category_type,
          c.priority_type, c.display_order, c.description
        FROM channels c
        LEFT JOIN boards b ON c.tenant = b.tenant AND c.channel_id = b.board_id
        WHERE b.board_id IS NULL
      `);

      console.log(`  ✓ Synced ${newRecords.rows.length} new records`);
    } else {
      console.log('  ✓ No new records to sync');
    }

    // Verify final counts match
    const channelsCount = await knex('channels').count('* as count').first();
    const boardsCount = await knex('boards').count('* as count').first();

    if (channelsCount.count !== boardsCount.count) {
      console.log(`ERROR: Row count mismatch after sync! channels: ${channelsCount.count}, boards: ${boardsCount.count}`);
      throw new Error('Data migration incomplete - row counts do not match after sync');
    }
    console.log(`✓ Verified data migration: ${boardsCount.count} rows in both tables`);
  }

  // Sync standard_channels to standard_boards
  const standardChannelsExistsForSync = await knex.schema.hasTable('standard_channels');
  if (standardChannelsExistsForSync) {
    console.log('Syncing any new data from standard_channels to standard_boards...');

    const newStandardRecords = await knex.raw(`
      SELECT sc.*
      FROM standard_channels sc
      LEFT JOIN standard_boards sb ON sc.id = sb.id
      WHERE sb.id IS NULL
    `);

    if (newStandardRecords.rows.length > 0) {
      console.log(`  Found ${newStandardRecords.rows.length} new standard records to sync...`);

      await knex.raw(`
        INSERT INTO standard_boards (
          id, board_name, description, display_order, is_inactive, is_default,
          category_type, priority_type, created_at, updated_at
        )
        SELECT
          sc.id, sc.channel_name, sc.description, sc.display_order, sc.is_inactive, sc.is_default,
          sc.category_type, sc.priority_type, sc.created_at, sc.updated_at
        FROM standard_channels sc
        LEFT JOIN standard_boards sb ON sc.id = sb.id
        WHERE sb.id IS NULL
      `);

      console.log(`  ✓ Synced ${newStandardRecords.rows.length} new standard records`);
    } else {
      console.log('  ✓ No new standard records to sync');
    }
  }

  // Step 1: If Citus is enabled, check if we need to undistribute tables
  const citusEnabled = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'citus'
    ) as enabled
  `);

  if (citusEnabled.rows[0].enabled) {
    console.log('Citus detected - checking if channels table is distributed...');

    const channelsDistributed = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition
        WHERE logicalrelid = 'channels'::regclass
      ) as distributed
    `);

    if (channelsDistributed.rows[0].distributed) {
      console.log('Need to undistribute channels table before dropping...');

      // First, get all foreign key constraints that reference the channels table
      const foreignKeys = await knex.raw(`
        SELECT
          tc.table_name,
          tc.constraint_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.constraint_column_usage AS ccu USING (constraint_schema, constraint_name)
        WHERE tc.constraint_type = 'FOREIGN KEY'
        AND ccu.table_name = 'channels'
      `);

      // Drop all foreign keys that reference channels
      console.log('Dropping foreign key constraints referencing channels...');
      for (const fk of foreignKeys.rows) {
        console.log(`  Dropping constraint ${fk.constraint_name} from ${fk.table_name}...`);
        await knex.raw(`ALTER TABLE ${fk.table_name} DROP CONSTRAINT IF EXISTS ${fk.constraint_name}`);
      }

      // Now we can undistribute the channels table
      await knex.raw(`SELECT undistribute_table('channels')`);
      console.log('  ✓ Channels table undistributed');
    } else {
      // If not distributed, still need to drop the foreign keys
      console.log('Channels table not distributed, dropping foreign key constraints...');

      const categoriesFK = await knex.raw(`
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'categories'::regclass
        AND confrelid = 'channels'::regclass
        AND contype = 'f'
      `);

      for (const constraint of categoriesFK.rows) {
        await knex.raw(`ALTER TABLE categories DROP CONSTRAINT IF EXISTS ${constraint.conname}`);
        console.log(`  ✓ Dropped constraint ${constraint.conname} from categories`);
      }

      const ticketsFK = await knex.raw(`
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'tickets'::regclass
        AND confrelid = 'channels'::regclass
        AND contype = 'f'
      `);

      for (const constraint of ticketsFK.rows) {
        await knex.raw(`ALTER TABLE tickets DROP CONSTRAINT IF EXISTS ${constraint.conname}`);
        console.log(`  ✓ Dropped constraint ${constraint.conname} from tickets`);
      }

      const hasTagsTable = await knex.schema.hasTable('tags');
      if (hasTagsTable) {
        const hasChannelId = await knex.schema.hasColumn('tags', 'channel_id');
        if (hasChannelId) {
          const tagsFK = await knex.raw(`
            SELECT conname
            FROM pg_constraint
            WHERE conrelid = 'tags'::regclass
            AND confrelid = 'channels'::regclass
            AND contype = 'f'
          `);

          for (const constraint of tagsFK.rows) {
            await knex.raw(`ALTER TABLE tags DROP CONSTRAINT IF EXISTS ${constraint.conname}`);
            console.log(`  ✓ Dropped constraint ${constraint.conname} from tags`);
          }
        }
      }

      const hasTagDefinitions = await knex.schema.hasTable('tag_definitions');
      if (hasTagDefinitions) {
        const hasChannelId = await knex.schema.hasColumn('tag_definitions', 'channel_id');
        if (hasChannelId) {
          const tagDefsFK = await knex.raw(`
            SELECT conname
            FROM pg_constraint
            WHERE conrelid = 'tag_definitions'::regclass
            AND confrelid = 'channels'::regclass
            AND contype = 'f'
          `);

          for (const constraint of tagDefsFK.rows) {
            await knex.raw(`ALTER TABLE tag_definitions DROP CONSTRAINT IF EXISTS ${constraint.conname}`);
            console.log(`  ✓ Dropped constraint ${constraint.conname} from tag_definitions`);
          }
        }
      }
    }

    // Also undistribute standard_channels if it's a reference table
    const standardChannelsExists = await knex.schema.hasTable('standard_channels');
    if (standardChannelsExists) {
      const standardDistributed = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM pg_dist_partition
          WHERE logicalrelid = 'standard_channels'::regclass
        ) as distributed
      `);

      if (standardDistributed.rows[0].distributed) {
        console.log('Undistributing standard_channels table before dropping...');
        await knex.raw(`SELECT undistribute_table('standard_channels')`);
        console.log('  ✓ Standard_channels table undistributed');
      }
    }
  } else {
    // No Citus, just drop the foreign keys normally
    console.log('Dropping foreign key constraints referencing channels...');

    const categoriesFK = await knex.raw(`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'categories'::regclass
      AND confrelid = 'channels'::regclass
      AND contype = 'f'
    `);

    for (const constraint of categoriesFK.rows) {
      await knex.raw(`ALTER TABLE categories DROP CONSTRAINT IF EXISTS ${constraint.conname}`);
      console.log(`  ✓ Dropped constraint ${constraint.conname} from categories`);
    }

    const ticketsFK = await knex.raw(`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'tickets'::regclass
      AND confrelid = 'channels'::regclass
      AND contype = 'f'
    `);

    for (const constraint of ticketsFK.rows) {
      await knex.raw(`ALTER TABLE tickets DROP CONSTRAINT IF EXISTS ${constraint.conname}`);
      console.log(`  ✓ Dropped constraint ${constraint.conname} from tickets`);
    }

    const hasTagsTable = await knex.schema.hasTable('tags');
    if (hasTagsTable) {
      const hasChannelId = await knex.schema.hasColumn('tags', 'channel_id');
      if (hasChannelId) {
        const tagsFK = await knex.raw(`
          SELECT conname
          FROM pg_constraint
          WHERE conrelid = 'tags'::regclass
          AND confrelid = 'channels'::regclass
          AND contype = 'f'
        `);

        for (const constraint of tagsFK.rows) {
          await knex.raw(`ALTER TABLE tags DROP CONSTRAINT IF EXISTS ${constraint.conname}`);
          console.log(`  ✓ Dropped constraint ${constraint.conname} from tags`);
        }
      }
    }

    const hasTagDefinitions = await knex.schema.hasTable('tag_definitions');
    if (hasTagDefinitions) {
      const hasChannelId = await knex.schema.hasColumn('tag_definitions', 'channel_id');
      if (hasChannelId) {
        const tagDefsFK = await knex.raw(`
          SELECT conname
          FROM pg_constraint
          WHERE conrelid = 'tag_definitions'::regclass
          AND confrelid = 'channels'::regclass
          AND contype = 'f'
        `);

        for (const constraint of tagDefsFK.rows) {
          await knex.raw(`ALTER TABLE tag_definitions DROP CONSTRAINT IF EXISTS ${constraint.conname}`);
          console.log(`  ✓ Dropped constraint ${constraint.conname} from tag_definitions`);
        }
      }
    }
  }

  // Step 2: Drop old channel_id columns
  console.log('Dropping old channel_id columns...');

  const hasCategoriesChannelId = await knex.schema.hasColumn('categories', 'channel_id');
  if (hasCategoriesChannelId) {
    await knex.schema.alterTable('categories', (table) => {
      table.dropColumn('channel_id');
    });
    console.log('  ✓ Dropped channel_id from categories');
  }

  const hasTicketsChannelId = await knex.schema.hasColumn('tickets', 'channel_id');
  if (hasTicketsChannelId) {
    await knex.schema.alterTable('tickets', (table) => {
      table.dropColumn('channel_id');
    });
    console.log('  ✓ Dropped channel_id from tickets');
  }

  if (hasTagsTable) {
    const hasChannelId = await knex.schema.hasColumn('tags', 'channel_id');
    if (hasChannelId) {
      await knex.schema.alterTable('tags', (table) => {
        table.dropColumn('channel_id');
      });
      console.log('  ✓ Dropped channel_id from tags');
    }
  }

  if (hasTagDefinitions) {
    const hasChannelId = await knex.schema.hasColumn('tag_definitions', 'channel_id');
    if (hasChannelId) {
      await knex.schema.alterTable('tag_definitions', (table) => {
        table.dropColumn('channel_id');
      });
      console.log('  ✓ Dropped channel_id from tag_definitions');
    }
  }

  // Step 3: Drop old tables
  console.log('Dropping old tables...');

  if (channelsExists) {
    await knex.schema.dropTable('channels');
    console.log('  ✓ Dropped channels table');
  }

  const standardChannelsExists = await knex.schema.hasTable('standard_channels');
  if (standardChannelsExists) {
    await knex.schema.dropTable('standard_channels');
    console.log('  ✓ Dropped standard_channels table');
  }

  console.log('✓ Cleanup migration completed successfully');
  console.log('Old channels tables and channel_id columns have been removed.');
};

/**
 * Rollback - recreate the old channels tables from boards
 * This allows rolling back if issues are discovered
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  console.log('Rolling back cleanup migration - recreating channels tables...');

  // Step 1: Recreate channels table
  console.log('Recreating channels table...');
  await knex.schema.createTable('channels', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('channel_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.text('channel_name').notNullable();
    table.boolean('display_contact_name_id').defaultTo(true);
    table.boolean('display_priority').defaultTo(true);
    table.boolean('display_severity').defaultTo(true);
    table.boolean('display_urgency').defaultTo(true);
    table.boolean('display_impact').defaultTo(true);
    table.boolean('display_category').defaultTo(true);
    table.boolean('display_subcategory').defaultTo(true);
    table.boolean('display_assigned_to').defaultTo(true);
    table.boolean('display_status').defaultTo(true);
    table.boolean('display_due_date').defaultTo(true);
    table.boolean('is_default').defaultTo(false);
    table.boolean('display_itil_impact').defaultTo(false);
    table.boolean('display_itil_urgency').defaultTo(false);
    table.text('category_type').defaultTo('custom');
    table.text('priority_type').defaultTo('custom');
    table.integer('display_order').notNullable().defaultTo(0);
    table.text('description');
    table.primary(['tenant', 'channel_id']);
    table.foreign('tenant').references('tenants.tenant');
  });

  await knex.raw(`
    ALTER TABLE channels
    ADD CONSTRAINT channels_category_type_check
    CHECK (category_type IN ('custom', 'itil'))
  `);

  await knex.raw(`
    ALTER TABLE channels
    ADD CONSTRAINT channels_priority_type_check
    CHECK (priority_type IN ('custom', 'itil'))
  `);

  await knex.raw('CREATE INDEX idx_channels_tenant_category_type ON channels(tenant, category_type)');
  await knex.raw('CREATE INDEX idx_channels_tenant_priority_type ON channels(tenant, priority_type)');

  // Step 2: Copy data back from boards to channels
  console.log('Copying data from boards back to channels...');
  await knex.raw(`
    INSERT INTO channels (
      tenant, channel_id, channel_name, display_contact_name_id, display_priority,
      display_severity, display_urgency, display_impact, display_category,
      display_subcategory, display_assigned_to, display_status, display_due_date,
      is_default, display_itil_impact, display_itil_urgency, category_type,
      priority_type, display_order, description
    )
    SELECT
      tenant, board_id, board_name, display_contact_name_id, display_priority,
      display_severity, display_urgency, display_impact, display_category,
      display_subcategory, display_assigned_to, display_status, display_due_date,
      is_default, display_itil_impact, display_itil_urgency, category_type,
      priority_type, display_order, description
    FROM boards
  `);

  // Step 3: Recreate standard_channels table
  console.log('Recreating standard_channels table...');
  await knex.schema.createTable('standard_channels', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.text('channel_name').notNullable().unique();
    table.text('description');
    table.integer('display_order').notNullable().defaultTo(0);
    table.boolean('is_inactive').defaultTo(false);
    table.boolean('is_default').defaultTo(false);
    table.text('category_type').defaultTo('custom');
    table.text('priority_type').defaultTo('custom');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw(`
    ALTER TABLE standard_channels
    ADD CONSTRAINT standard_channels_category_type_check
    CHECK (category_type IN ('custom', 'itil'))
  `);

  await knex.raw(`
    ALTER TABLE standard_channels
    ADD CONSTRAINT standard_channels_priority_type_check
    CHECK (priority_type IN ('custom', 'itil'))
  `);

  await knex.raw('CREATE INDEX idx_standard_channels_category_type ON standard_channels(category_type)');
  await knex.raw('CREATE INDEX idx_standard_channels_priority_type ON standard_channels(priority_type)');

  // Step 4: Copy data back from standard_boards
  console.log('Copying data from standard_boards back to standard_channels...');
  await knex.raw(`
    INSERT INTO standard_channels (
      id, channel_name, description, display_order, is_inactive, is_default,
      category_type, priority_type, created_at, updated_at
    )
    SELECT
      id, board_name, description, display_order, is_inactive, is_default,
      category_type, priority_type, created_at, updated_at
    FROM standard_boards
  `);

  // Step 5: Restore channel_id columns in related tables
  console.log('Restoring channel_id in categories table...');
  await knex.schema.alterTable('categories', (table) => {
    table.uuid('channel_id');
  });

  await knex.raw(`
    UPDATE categories
    SET channel_id = board_id
  `);

  await knex.schema.alterTable('categories', (table) => {
    table.foreign(['tenant', 'channel_id']).references(['tenant', 'channel_id']).inTable('channels');
  });

  console.log('Restoring channel_id in tickets table...');
  await knex.schema.alterTable('tickets', (table) => {
    table.uuid('channel_id');
  });

  await knex.raw(`
    UPDATE tickets
    SET channel_id = board_id
  `);

  await knex.schema.alterTable('tickets', (table) => {
    table.foreign(['tenant', 'channel_id']).references(['tenant', 'channel_id']).inTable('channels');
  });

  const hasTagsTable = await knex.schema.hasTable('tags');
  if (hasTagsTable) {
    const hasBoardId = await knex.schema.hasColumn('tags', 'board_id');
    if (hasBoardId) {
      console.log('Restoring channel_id in tags table...');
      await knex.schema.alterTable('tags', (table) => {
        table.uuid('channel_id');
      });

      await knex.raw(`
        UPDATE tags
        SET channel_id = board_id
      `);

      await knex.schema.alterTable('tags', (table) => {
        table.foreign(['tenant', 'channel_id']).references(['tenant', 'channel_id']).inTable('channels');
      });
    }
  }

  const hasTagDefinitions = await knex.schema.hasTable('tag_definitions');
  if (hasTagDefinitions) {
    const hasBoardId = await knex.schema.hasColumn('tag_definitions', 'board_id');
    if (hasBoardId) {
      console.log('Restoring channel_id in tag_definitions table...');
      await knex.schema.alterTable('tag_definitions', (table) => {
        table.uuid('channel_id');
      });

      await knex.raw(`
        UPDATE tag_definitions
        SET channel_id = board_id
        WHERE board_id IS NOT NULL
      `);

      await knex.schema.alterTable('tag_definitions', (table) => {
        table.foreign(['tenant', 'channel_id']).references(['tenant', 'channel_id']).inTable('channels');
      });
    }
  }

  console.log('✓ Rollback completed successfully');
  console.log('Old channels tables and channel_id columns have been restored.');
};