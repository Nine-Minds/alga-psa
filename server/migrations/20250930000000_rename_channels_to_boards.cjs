/**
 * Migration to rename channels to boards throughout the database
 * This follows Citus-compliant patterns: create new tables, copy data, then drop old tables
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.config = { transaction: false };

exports.up = async function(knex) {
  console.log('Starting channels to boards rename migration...');

  // Step 0: If Citus is enabled, undistribute channels table first
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
      console.log('Undistributing channels table before migration...');
      await knex.raw(`SELECT undistribute_table('channels')`);
      console.log('  ✓ Channels table undistributed');
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
        console.log('Undistributing standard_channels table before migration...');
        await knex.raw(`SELECT undistribute_table('standard_channels')`);
        console.log('  ✓ Standard_channels table undistributed');
      }
    }
  }

  // Step 1: Create new boards table with all columns from channels
  console.log('Creating boards table...');
  await knex.schema.createTable('boards', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('board_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.text('board_name').notNullable();
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
    table.primary(['tenant', 'board_id']);
    table.foreign('tenant').references('tenants.tenant');
  });

  // Add check constraints
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

  // Add indexes
  await knex.raw('CREATE INDEX idx_boards_tenant_category_type ON boards(tenant, category_type)');
  await knex.raw('CREATE INDEX idx_boards_tenant_priority_type ON boards(tenant, priority_type)');

  // Step 2: Copy data from channels to boards
  console.log('Copying data from channels to boards...');
  await knex.raw(`
    INSERT INTO boards (
      tenant, board_id, board_name, display_contact_name_id, display_priority,
      display_severity, display_urgency, display_impact, display_category,
      display_subcategory, display_assigned_to, display_status, display_due_date,
      is_default, display_itil_impact, display_itil_urgency, category_type,
      priority_type, display_order, description
    )
    SELECT
      tenant, channel_id, channel_name, display_contact_name_id, display_priority,
      display_severity, display_urgency, display_impact, display_category,
      display_subcategory, display_assigned_to, display_status, display_due_date,
      is_default, display_itil_impact, display_itil_urgency, category_type,
      priority_type, display_order, description
    FROM channels
  `);

  console.log('Data copied successfully');

  // Step 3: Create new standard_boards table
  console.log('Creating standard_boards table...');
  await knex.schema.createTable('standard_boards', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.text('board_name').notNullable().unique();
    table.text('description');
    table.integer('display_order').notNullable().defaultTo(0);
    table.boolean('is_inactive').defaultTo(false);
    table.boolean('is_default').defaultTo(false);
    table.text('category_type').defaultTo('custom');
    table.text('priority_type').defaultTo('custom');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  // Add check constraints for standard_boards
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

  // Add indexes for standard_boards
  await knex.raw('CREATE INDEX idx_standard_boards_category_type ON standard_boards(category_type)');
  await knex.raw('CREATE INDEX idx_standard_boards_priority_type ON standard_boards(priority_type)');

  // Step 4: Copy data from standard_channels to standard_boards
  console.log('Copying data from standard_channels to standard_boards...');
  await knex.raw(`
    INSERT INTO standard_boards (
      id, board_name, description, display_order, is_inactive, is_default,
      category_type, priority_type, created_at, updated_at
    )
    SELECT
      id, channel_name, description, display_order, is_inactive, is_default,
      category_type, priority_type, created_at, updated_at
    FROM standard_channels
  `);

  console.log('Standard boards data copied successfully');

  // Step 5: Add board_id column to related tables and copy data
  console.log('Updating categories table...');
  await knex.schema.alterTable('categories', (table) => {
    table.uuid('board_id');
  });

  await knex.raw(`
    UPDATE categories
    SET board_id = channel_id
  `);

  console.log('Updating tickets table...');
  await knex.schema.alterTable('tickets', (table) => {
    table.uuid('board_id');
  });

  await knex.raw(`
    UPDATE tickets
    SET board_id = channel_id
  `);

  console.log('Updating tags table...');
  const hasTagsTable = await knex.schema.hasTable('tags');
  if (hasTagsTable) {
    const hasChannelId = await knex.schema.hasColumn('tags', 'channel_id');
    if (hasChannelId) {
      await knex.schema.alterTable('tags', (table) => {
        table.uuid('board_id');
      });

      await knex.raw(`
        UPDATE tags
        SET board_id = channel_id
      `);
    }
  }

  console.log('Updating tag_definitions table...');
  const hasTagDefinitions = await knex.schema.hasTable('tag_definitions');
  if (hasTagDefinitions) {
    const hasChannelId = await knex.schema.hasColumn('tag_definitions', 'channel_id');
    if (hasChannelId) {
      await knex.schema.alterTable('tag_definitions', (table) => {
        table.uuid('board_id');
      });

      await knex.raw(`
        UPDATE tag_definitions
        SET board_id = channel_id
        WHERE channel_id IS NOT NULL
      `);
    }
  }

  // Step 6: Add foreign key constraints for new board_id columns
  console.log('Adding foreign key constraints...');

  await knex.schema.alterTable('categories', (table) => {
    table.foreign(['tenant', 'board_id']).references(['tenant', 'board_id']).inTable('boards');
  });

  await knex.schema.alterTable('tickets', (table) => {
    table.foreign(['tenant', 'board_id']).references(['tenant', 'board_id']).inTable('boards');
  });

  if (hasTagsTable) {
    const hasChannelId = await knex.schema.hasColumn('tags', 'channel_id');
    if (hasChannelId) {
      await knex.schema.alterTable('tags', (table) => {
        table.foreign(['tenant', 'board_id']).references(['tenant', 'board_id']).inTable('boards');
      });
    }
  }

  if (hasTagDefinitions) {
    const hasChannelId = await knex.schema.hasColumn('tag_definitions', 'channel_id');
    if (hasChannelId) {
      await knex.schema.alterTable('tag_definitions', (table) => {
        table.foreign(['tenant', 'board_id']).references(['tenant', 'board_id']).inTable('boards');
      });
    }
  }

  // Step 7: Drop old foreign key constraints referencing channels
  console.log('Dropping old foreign key constraints...');

  // Get constraint names dynamically
  const categoriesFK = await knex.raw(`
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'categories'::regclass
    AND confrelid = 'channels'::regclass
    AND contype = 'f'
  `);

  for (const constraint of categoriesFK.rows) {
    await knex.raw(`ALTER TABLE categories DROP CONSTRAINT ${constraint.conname}`);
  }

  const ticketsFK = await knex.raw(`
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'tickets'::regclass
    AND confrelid = 'channels'::regclass
    AND contype = 'f'
  `);

  for (const constraint of ticketsFK.rows) {
    await knex.raw(`ALTER TABLE tickets DROP CONSTRAINT ${constraint.conname}`);
  }

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
        await knex.raw(`ALTER TABLE tags DROP CONSTRAINT ${constraint.conname}`);
      }
    }
  }

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
        await knex.raw(`ALTER TABLE tag_definitions DROP CONSTRAINT ${constraint.conname}`);
      }
    }
  }

  // Step 8: Keep old channel_id columns and tables for now
  // They will be dropped in a separate cleanup migration after verification
  console.log('✓ Channels to boards rename migration completed successfully');
  console.log('Note: Old channel_id columns and channels/standard_channels tables are kept for safety.');
  console.log('They will be removed in the cleanup migration: 20250930000001_cleanup_old_channels_tables.cjs');
};

/**
 * Rollback migration - recreate channels tables and restore data
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  console.log('Rolling back channels to boards rename migration...');

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

  // Add check constraints
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

  // Step 4: Copy data back from standard_boards to standard_channels
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

  console.log('Restoring channel_id in tickets table...');
  await knex.schema.alterTable('tickets', (table) => {
    table.uuid('channel_id');
  });

  await knex.raw(`
    UPDATE tickets
    SET channel_id = board_id
  `);

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
    }
  }

  // Step 6: Restore foreign key constraints
  console.log('Restoring foreign key constraints...');

  await knex.schema.alterTable('categories', (table) => {
    table.foreign(['tenant', 'channel_id']).references(['tenant', 'channel_id']).inTable('channels');
  });

  await knex.schema.alterTable('tickets', (table) => {
    table.foreign(['tenant', 'channel_id']).references(['tenant', 'channel_id']).inTable('channels');
  });

  if (hasTagsTable) {
    const hasBoardId = await knex.schema.hasColumn('tags', 'board_id');
    if (hasBoardId) {
      await knex.schema.alterTable('tags', (table) => {
        table.foreign(['tenant', 'channel_id']).references(['tenant', 'channel_id']).inTable('channels');
      });
    }
  }

  if (hasTagDefinitions) {
    const hasBoardId = await knex.schema.hasColumn('tag_definitions', 'board_id');
    if (hasBoardId) {
      await knex.schema.alterTable('tag_definitions', (table) => {
        table.foreign(['tenant', 'channel_id']).references(['tenant', 'channel_id']).inTable('channels');
      });
    }
  }

  // Step 7: Drop board_id columns
  console.log('Dropping board_id columns...');

  await knex.schema.alterTable('categories', (table) => {
    table.dropForeign(['tenant', 'board_id']);
    table.dropColumn('board_id');
  });

  await knex.schema.alterTable('tickets', (table) => {
    table.dropForeign(['tenant', 'board_id']);
    table.dropColumn('board_id');
  });

  if (hasTagsTable) {
    const hasBoardId = await knex.schema.hasColumn('tags', 'board_id');
    if (hasBoardId) {
      await knex.schema.alterTable('tags', (table) => {
        table.dropForeign(['tenant', 'board_id']);
        table.dropColumn('board_id');
      });
    }
  }

  if (hasTagDefinitions) {
    const hasBoardId = await knex.schema.hasColumn('tag_definitions', 'board_id');
    if (hasBoardId) {
      await knex.schema.alterTable('tag_definitions', (table) => {
        table.dropForeign(['tenant', 'board_id']);
        table.dropColumn('board_id');
      });
    }
  }

  // Step 8: Drop new tables
  console.log('Dropping boards table...');
  await knex.schema.dropTableIfExists('boards');

  console.log('Dropping standard_boards table...');
  await knex.schema.dropTableIfExists('standard_boards');

  console.log('✓ Rollback completed successfully');
};