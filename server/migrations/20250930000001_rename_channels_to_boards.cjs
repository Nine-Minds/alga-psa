/**
 * Migration to rename channels to boards throughout the database
 * This follows Citus-compliant patterns: create new tables, copy data, then drop old tables
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.config = { transaction: false };

exports.up = async function(knex) {
  console.log('Starting channels to boards rename migration...');

  // Step 1: Create new boards table with all columns from channels
  const boardsExists = await knex.schema.hasTable('boards');

  if (boardsExists) {
    console.log('boards table already exists, skipping creation...');
  } else {
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
      table.boolean('is_inactive').defaultTo(false);
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
  }

  if (!boardsExists) {
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
  }

  // Step 2: Copy data from channels to boards (only missing records)
  console.log('Copying data from channels to boards...');
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

  const insertedCount = await knex.raw(`
    SELECT COUNT(*) as count FROM boards
  `);
  console.log(`Data synced (${insertedCount.rows[0].count} total records in boards)`);

  // Step 3: Create new standard_boards table
  const standardBoardsExists = await knex.schema.hasTable('standard_boards');

  if (standardBoardsExists) {
    console.log('standard_boards table already exists, skipping creation...');
  } else {
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
  }

  // Step 4: Copy data from standard_channels to standard_boards (only missing records)
  console.log('Copying data from standard_channels to standard_boards...');
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

  const standardCount = await knex.raw(`
    SELECT COUNT(*) as count FROM standard_boards
  `);
  console.log(`Standard boards synced (${standardCount.rows[0].count} total records)`);

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

  // Step 6: Foreign key constraints will be added in EE Citus migration
  // after the boards table is distributed (if using Citus)
  // For CE installations, they will be added in a later migration
  console.log('Skipping foreign key constraints (will be added after Citus distribution if applicable)...');

  // Step 7: Keep old foreign key constraints intact for now
  // Both old and new columns will coexist until final cleanup
  console.log('Keeping old foreign key constraints intact...');

  console.log('✓ Migration 1/3 complete: boards tables created, old tables preserved');
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