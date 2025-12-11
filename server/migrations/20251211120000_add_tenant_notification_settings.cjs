/**
 * Create tenant-specific notification settings tables
 * This migration moves notification category/subtype settings from global to per-tenant
 */

exports.config = { transaction: false };

exports.up = async function(knex) {
  console.log('Creating tenant-specific notification settings tables...');

  // Create tenant_notification_category_settings
  await knex.schema.createTable('tenant_notification_category_settings', table => {
    table.uuid('tenant').notNullable();
    table.uuid('tenant_notification_category_setting_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.integer('category_id').notNullable();
    table.boolean('is_enabled').notNullable().defaultTo(true);
    table.boolean('is_default_enabled').notNullable().defaultTo(true);
    table.timestamps(true, true);

    // Composite primary key with tenant first for Citus
    table.primary(['tenant_notification_category_setting_id', 'tenant']);

    // Foreign keys
    table.foreign('tenant').references('tenant').inTable('tenants').onDelete('CASCADE');
    table.foreign('category_id').references('id').inTable('notification_categories').onDelete('CASCADE');

    // Unique constraint on tenant + category_id
    table.unique(['tenant', 'category_id']);
  });
  console.log('  ✓ Created tenant_notification_category_settings');

  // Create tenant_notification_subtype_settings
  await knex.schema.createTable('tenant_notification_subtype_settings', table => {
    table.uuid('tenant').notNullable();
    table.uuid('tenant_notification_subtype_setting_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.integer('subtype_id').notNullable();
    table.boolean('is_enabled').notNullable().defaultTo(true);
    table.boolean('is_default_enabled').notNullable().defaultTo(true);
    table.timestamps(true, true);

    // Composite primary key with tenant first for Citus
    table.primary(['tenant_notification_subtype_setting_id', 'tenant']);

    // Foreign keys
    table.foreign('tenant').references('tenant').inTable('tenants').onDelete('CASCADE');
    table.foreign('subtype_id').references('id').inTable('notification_subtypes').onDelete('CASCADE');

    // Unique constraint on tenant + subtype_id
    table.unique(['tenant', 'subtype_id']);
  });
  console.log('  ✓ Created tenant_notification_subtype_settings');

  // Create tenant_internal_notification_category_settings
  await knex.schema.createTable('tenant_internal_notification_category_settings', table => {
    table.uuid('tenant').notNullable();
    table.uuid('tenant_internal_notification_category_setting_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.integer('category_id').notNullable();
    table.boolean('is_enabled').notNullable().defaultTo(true);
    table.boolean('is_default_enabled').notNullable().defaultTo(true);
    table.timestamps(true, true);

    // Composite primary key with tenant first for Citus
    table.primary(['tenant_internal_notification_category_setting_id', 'tenant']);

    // Foreign keys
    table.foreign('tenant').references('tenant').inTable('tenants').onDelete('CASCADE');
    table.foreign('category_id')
      .references('internal_notification_category_id')
      .inTable('internal_notification_categories')
      .onDelete('CASCADE');

    // Unique constraint on tenant + category_id
    table.unique(['tenant', 'category_id']);
  });
  console.log('  ✓ Created tenant_internal_notification_category_settings');

  // Create tenant_internal_notification_subtype_settings
  await knex.schema.createTable('tenant_internal_notification_subtype_settings', table => {
    table.uuid('tenant').notNullable();
    table.uuid('tenant_internal_notification_subtype_setting_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.integer('subtype_id').notNullable();
    table.boolean('is_enabled').notNullable().defaultTo(true);
    table.boolean('is_default_enabled').notNullable().defaultTo(true);
    table.timestamps(true, true);

    // Composite primary key with tenant first for Citus
    table.primary(['tenant_internal_notification_subtype_setting_id', 'tenant']);

    // Foreign keys
    table.foreign('tenant').references('tenant').inTable('tenants').onDelete('CASCADE');
    table.foreign('subtype_id')
      .references('internal_notification_subtype_id')
      .inTable('internal_notification_subtypes')
      .onDelete('CASCADE');

    // Unique constraint on tenant + subtype_id
    table.unique(['tenant', 'subtype_id']);
  });
  console.log('  ✓ Created tenant_internal_notification_subtype_settings');

  // Create indexes for lookups
  await knex.raw(`
    CREATE INDEX idx_tenant_notification_category_settings_lookup
      ON tenant_notification_category_settings(tenant, category_id);

    CREATE INDEX idx_tenant_notification_subtype_settings_lookup
      ON tenant_notification_subtype_settings(tenant, subtype_id);

    CREATE INDEX idx_tenant_internal_notification_category_settings_lookup
      ON tenant_internal_notification_category_settings(tenant, category_id);

    CREATE INDEX idx_tenant_internal_notification_subtype_settings_lookup
      ON tenant_internal_notification_subtype_settings(tenant, subtype_id);
  `);
  console.log('  ✓ Created lookup indexes');

  // Check if Citus is enabled and distribute tables
  console.log('Checking for Citus...');
  const citusFn = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_proc
      WHERE proname = 'create_distributed_table'
    ) AS exists;
  `);

  if (citusFn.rows?.[0]?.exists) {
    console.log('  Citus detected, distributing tables...');

    const tables = [
      'tenant_notification_category_settings',
      'tenant_notification_subtype_settings',
      'tenant_internal_notification_category_settings',
      'tenant_internal_notification_subtype_settings'
    ];

    for (const tableName of tables) {
      // Check if table is already distributed
      const isDistributed = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM pg_dist_partition
          WHERE logicalrelid = '${tableName}'::regclass
        ) AS distributed;
      `);

      if (!isDistributed.rows[0].distributed) {
        await knex.raw(`SELECT create_distributed_table('${tableName}', 'tenant')`);
        console.log(`    ✓ Distributed ${tableName}`);
      } else {
        console.log(`    - ${tableName} already distributed`);
      }
    }
  } else {
    console.warn('  Citus not detected, skipping table distribution');
  }

  // Seed tenant settings from current global values
  console.log('Seeding tenant settings from global values...');

  // Get all tenants
  const tenants = await knex('tenants').select('tenant');
  console.log(`  Found ${tenants.length} tenants`);

  if (tenants.length > 0) {
    // Seed notification_categories
    const categories = await knex('notification_categories')
      .select('id', 'is_enabled', 'is_default_enabled');

    if (categories.length > 0) {
      const categorySettings = [];
      for (const tenant of tenants) {
        for (const category of categories) {
          categorySettings.push({
            tenant: tenant.tenant,
            tenant_notification_category_setting_id: knex.raw('gen_random_uuid()'),
            category_id: category.id,
            is_enabled: category.is_enabled,
            is_default_enabled: category.is_default_enabled,
            created_at: knex.fn.now(),
            updated_at: knex.fn.now()
          });
        }
      }

      // Insert in batches of 100
      for (let i = 0; i < categorySettings.length; i += 100) {
        const batch = categorySettings.slice(i, i + 100);
        await knex('tenant_notification_category_settings')
          .insert(batch)
          .onConflict(['tenant', 'category_id'])
          .ignore();
      }
      console.log(`  ✓ Seeded ${categorySettings.length} category settings`);
    }

    // Seed notification_subtypes
    const subtypes = await knex('notification_subtypes')
      .select('id', 'is_enabled', 'is_default_enabled');

    if (subtypes.length > 0) {
      const subtypeSettings = [];
      for (const tenant of tenants) {
        for (const subtype of subtypes) {
          subtypeSettings.push({
            tenant: tenant.tenant,
            tenant_notification_subtype_setting_id: knex.raw('gen_random_uuid()'),
            subtype_id: subtype.id,
            is_enabled: subtype.is_enabled,
            is_default_enabled: subtype.is_default_enabled,
            created_at: knex.fn.now(),
            updated_at: knex.fn.now()
          });
        }
      }

      // Insert in batches of 100
      for (let i = 0; i < subtypeSettings.length; i += 100) {
        const batch = subtypeSettings.slice(i, i + 100);
        await knex('tenant_notification_subtype_settings')
          .insert(batch)
          .onConflict(['tenant', 'subtype_id'])
          .ignore();
      }
      console.log(`  ✓ Seeded ${subtypeSettings.length} subtype settings`);
    }

    // Seed internal_notification_categories
    const internalCategories = await knex('internal_notification_categories')
      .select('internal_notification_category_id', 'is_enabled', 'is_default_enabled');

    if (internalCategories.length > 0) {
      const internalCategorySettings = [];
      for (const tenant of tenants) {
        for (const category of internalCategories) {
          internalCategorySettings.push({
            tenant: tenant.tenant,
            tenant_internal_notification_category_setting_id: knex.raw('gen_random_uuid()'),
            category_id: category.internal_notification_category_id,
            is_enabled: category.is_enabled,
            is_default_enabled: category.is_default_enabled,
            created_at: knex.fn.now(),
            updated_at: knex.fn.now()
          });
        }
      }

      // Insert in batches of 100
      for (let i = 0; i < internalCategorySettings.length; i += 100) {
        const batch = internalCategorySettings.slice(i, i + 100);
        await knex('tenant_internal_notification_category_settings')
          .insert(batch)
          .onConflict(['tenant', 'category_id'])
          .ignore();
      }
      console.log(`  ✓ Seeded ${internalCategorySettings.length} internal category settings`);
    }

    // Seed internal_notification_subtypes
    const internalSubtypes = await knex('internal_notification_subtypes')
      .select('internal_notification_subtype_id', 'is_enabled', 'is_default_enabled');

    if (internalSubtypes.length > 0) {
      const internalSubtypeSettings = [];
      for (const tenant of tenants) {
        for (const subtype of internalSubtypes) {
          internalSubtypeSettings.push({
            tenant: tenant.tenant,
            tenant_internal_notification_subtype_setting_id: knex.raw('gen_random_uuid()'),
            subtype_id: subtype.internal_notification_subtype_id,
            is_enabled: subtype.is_enabled,
            is_default_enabled: subtype.is_default_enabled,
            created_at: knex.fn.now(),
            updated_at: knex.fn.now()
          });
        }
      }

      // Insert in batches of 100
      for (let i = 0; i < internalSubtypeSettings.length; i += 100) {
        const batch = internalSubtypeSettings.slice(i, i + 100);
        await knex('tenant_internal_notification_subtype_settings')
          .insert(batch)
          .onConflict(['tenant', 'subtype_id'])
          .ignore();
      }
      console.log(`  ✓ Seeded ${internalSubtypeSettings.length} internal subtype settings`);
    }
  }

  // Reset global tables to all enabled (they become reference data)
  console.log('Resetting global tables to enabled state...');
  await knex('notification_categories').update({
    is_enabled: true,
    is_default_enabled: true,
    updated_at: knex.fn.now()
  });
  await knex('notification_subtypes').update({
    is_enabled: true,
    is_default_enabled: true,
    updated_at: knex.fn.now()
  });
  await knex('internal_notification_categories').update({
    is_enabled: true,
    is_default_enabled: true,
    updated_at: knex.fn.now()
  });
  await knex('internal_notification_subtypes').update({
    is_enabled: true,
    is_default_enabled: true,
    updated_at: knex.fn.now()
  });
  console.log('  ✓ Global tables reset to enabled');

  console.log('Migration completed successfully!');
};

exports.down = async function(knex) {
  console.log('Reverting tenant-specific notification settings tables...');

  // Drop indexes first
  await knex.raw(`
    DROP INDEX IF EXISTS idx_tenant_internal_notification_subtype_settings_lookup;
    DROP INDEX IF EXISTS idx_tenant_internal_notification_category_settings_lookup;
    DROP INDEX IF EXISTS idx_tenant_notification_subtype_settings_lookup;
    DROP INDEX IF EXISTS idx_tenant_notification_category_settings_lookup;
  `);
  console.log('  ✓ Dropped indexes');

  // Drop tables in reverse dependency order
  await knex.schema.dropTableIfExists('tenant_internal_notification_subtype_settings');
  console.log('  ✓ Dropped tenant_internal_notification_subtype_settings');

  await knex.schema.dropTableIfExists('tenant_internal_notification_category_settings');
  console.log('  ✓ Dropped tenant_internal_notification_category_settings');

  await knex.schema.dropTableIfExists('tenant_notification_subtype_settings');
  console.log('  ✓ Dropped tenant_notification_subtype_settings');

  await knex.schema.dropTableIfExists('tenant_notification_category_settings');
  console.log('  ✓ Dropped tenant_notification_category_settings');

  console.log('Rollback completed successfully!');
};
