/**
 * Create tenant-specific notification settings tables
 * This migration moves notification category/subtype settings from global to per-tenant
 */

// Citus reference-table conversion cannot share a transaction with parallel
// distributed operations from earlier migrations in the same knex batch.
exports.config = { transaction: false };

exports.up = async function(knex) {
  console.log('Creating tenant-specific notification settings tables...');

  // Check if Citus is enabled - we need to know this to handle FK constraints properly
  const citusFn = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_proc
      WHERE proname = 'create_distributed_table'
    ) AS exists;
  `);
  const isCitus = citusFn.rows?.[0]?.exists;

  // The notification catalogs (categories/subtypes/system_email_templates)
  // are reference tables on production Citus, and the tenant-scoped tables
  // that FK into them (notification_logs, user_notification_preferences,
  // tenant_email_templates) are distributed. A fresh Citus chain reaches this
  // point with all six still local, holding FKs out to already-distributed
  // users/tenants — so neither group can be converted while the cross-FKs tie
  // them into one local graph. Drop the cross-FKs, convert each group to its
  // production shape, then re-add them (distributed -> reference FKs are
  // supported). No-op on prod, where everything is already converted.
  if (isCitus) {
    await knex.raw("SET citus.multi_shard_modify_mode TO 'sequential'");

    const isReference = async (table) => {
      const { rows } = await knex.raw(
        "SELECT 1 FROM pg_dist_partition WHERE logicalrelid = ?::regclass AND partmethod = 'n' AND repmodel = 't'",
        [table]
      );
      return rows.length > 0;
    };
    const isDistributed = async (table) => {
      const { rows } = await knex.raw(
        "SELECT 1 FROM pg_dist_partition WHERE logicalrelid = ?::regclass AND partmethod = 'h'",
        [table]
      );
      return rows.length > 0;
    };

    const referenceTables = ['notification_categories', 'notification_subtypes', 'system_email_templates'];
    const distributedTables = ['notification_logs', 'user_notification_preferences', 'tenant_email_templates'];

    const pendingReference = [];
    for (const t of referenceTables) {
      if (!(await isReference(t))) pendingReference.push(t);
    }
    const pendingDistributed = [];
    for (const t of distributedTables) {
      if (!(await isDistributed(t))) pendingDistributed.push(t);
    }

    if (pendingReference.length > 0 || pendingDistributed.length > 0) {
      const { rows: crossFks } = await knex.raw(`
        SELECT conrelid::regclass::text AS tbl, conname, pg_get_constraintdef(oid) AS def
        FROM pg_constraint
        WHERE contype = 'f'
          AND conrelid::regclass::text = ANY(ARRAY['notification_logs', 'user_notification_preferences', 'tenant_email_templates'])
          AND confrelid::regclass::text = ANY(ARRAY['notification_categories', 'notification_subtypes', 'system_email_templates'])
      `);

      for (const fk of crossFks) {
        await knex.raw(`ALTER TABLE ${fk.tbl} DROP CONSTRAINT "${fk.conname}"`);
      }
      // create_reference_table also accepts the citus-local tables that the
      // first conversion auto-creates from the rest of the catalog FK graph.
      for (const t of pendingReference) {
        await knex.raw('SELECT create_reference_table(?)', [t]);
      }
      for (const t of pendingDistributed) {
        await knex.raw("SELECT create_distributed_table(?, 'tenant')", [t]);
      }
      for (const fk of crossFks) {
        await knex.raw(`ALTER TABLE ${fk.tbl} ADD CONSTRAINT "${fk.conname}" ${fk.def}`);
      }
      for (const t of [...pendingReference, ...pendingDistributed]) {
        await knex.raw('SELECT truncate_local_data_after_distributing_table(?::regclass)', [t]);
      }
    }
  }

  // Helper function to check if table exists
  const tableExists = async (tableName) => {
    const result = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ?
      ) AS exists;
    `, [tableName]);
    return result.rows[0].exists;
  };

  // Helper function to check if constraint exists
  const constraintExists = async (tableName, constraintName) => {
    const result = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_schema = 'public'
        AND table_name = ?
        AND constraint_name = ?
      ) AS exists;
    `, [tableName, constraintName]);
    return result.rows[0].exists;
  };

  // In Citus, we need to:
  // 1. Create tables WITHOUT foreign keys
  // 2. Distribute the tables
  // 3. Add foreign keys AFTER distribution
  // This avoids "out of shared memory" errors when Citus tries to convert local tables

  // Create tenant_notification_category_settings (without FKs for Citus)
  if (!await tableExists('tenant_notification_category_settings')) {
    await knex.schema.createTable('tenant_notification_category_settings', table => {
      table.uuid('tenant').notNullable();
      table.uuid('tenant_notification_category_setting_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
      table.integer('category_id').notNullable();
      table.boolean('is_enabled').notNullable().defaultTo(true);
      table.boolean('is_default_enabled').notNullable().defaultTo(true);
      table.timestamps(true, true);

      // Composite primary key with tenant first for Citus
      table.primary(['tenant_notification_category_setting_id', 'tenant']);

      // Foreign keys - only add in non-Citus environments
      // In Citus, these will be added AFTER distribution
      if (!isCitus) {
        table.foreign('tenant').references('tenant').inTable('tenants').onDelete('CASCADE');
        table.foreign('category_id').references('id').inTable('notification_categories').onDelete('CASCADE');
      }

      // Unique constraint on tenant + category_id
      table.unique(['tenant', 'category_id']);
    });
    console.log('  ✓ Created tenant_notification_category_settings');
  } else {
    console.log('  - tenant_notification_category_settings already exists');
  }

  // Create tenant_notification_subtype_settings (without FKs for Citus)
  if (!await tableExists('tenant_notification_subtype_settings')) {
    await knex.schema.createTable('tenant_notification_subtype_settings', table => {
      table.uuid('tenant').notNullable();
      table.uuid('tenant_notification_subtype_setting_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
      table.integer('subtype_id').notNullable();
      table.boolean('is_enabled').notNullable().defaultTo(true);
      table.boolean('is_default_enabled').notNullable().defaultTo(true);
      table.timestamps(true, true);

      // Composite primary key with tenant first for Citus
      table.primary(['tenant_notification_subtype_setting_id', 'tenant']);

      // Foreign keys - only add in non-Citus environments
      if (!isCitus) {
        table.foreign('tenant').references('tenant').inTable('tenants').onDelete('CASCADE');
        table.foreign('subtype_id').references('id').inTable('notification_subtypes').onDelete('CASCADE');
      }

      // Unique constraint on tenant + subtype_id
      table.unique(['tenant', 'subtype_id']);
    });
    console.log('  ✓ Created tenant_notification_subtype_settings');
  } else {
    console.log('  - tenant_notification_subtype_settings already exists');
  }

  // Create tenant_internal_notification_category_settings (without FKs for Citus)
  if (!await tableExists('tenant_internal_notification_category_settings')) {
    await knex.schema.createTable('tenant_internal_notification_category_settings', table => {
      table.uuid('tenant').notNullable();
      table.uuid('tenant_internal_notification_category_setting_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
      table.integer('category_id').notNullable();
      table.boolean('is_enabled').notNullable().defaultTo(true);
      table.boolean('is_default_enabled').notNullable().defaultTo(true);
      table.timestamps(true, true);

      // Composite primary key with tenant first for Citus
      table.primary(['tenant_internal_notification_category_setting_id', 'tenant']);

      // Foreign keys - only add in non-Citus environments
      if (!isCitus) {
        table.foreign('tenant').references('tenant').inTable('tenants').onDelete('CASCADE');
        table.foreign('category_id')
          .references('internal_notification_category_id')
          .inTable('internal_notification_categories')
          .onDelete('CASCADE');
      }

      // Unique constraint on tenant + category_id
      table.unique(['tenant', 'category_id']);
    });
    console.log('  ✓ Created tenant_internal_notification_category_settings');
  } else {
    console.log('  - tenant_internal_notification_category_settings already exists');
  }

  // Create tenant_internal_notification_subtype_settings (without FKs for Citus)
  if (!await tableExists('tenant_internal_notification_subtype_settings')) {
    await knex.schema.createTable('tenant_internal_notification_subtype_settings', table => {
      table.uuid('tenant').notNullable();
      table.uuid('tenant_internal_notification_subtype_setting_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
      table.integer('subtype_id').notNullable();
      table.boolean('is_enabled').notNullable().defaultTo(true);
      table.boolean('is_default_enabled').notNullable().defaultTo(true);
      table.timestamps(true, true);

      // Composite primary key with tenant first for Citus
      table.primary(['tenant_internal_notification_subtype_setting_id', 'tenant']);

      // Foreign keys - only add in non-Citus environments
      if (!isCitus) {
        table.foreign('tenant').references('tenant').inTable('tenants').onDelete('CASCADE');
        table.foreign('subtype_id')
          .references('internal_notification_subtype_id')
          .inTable('internal_notification_subtypes')
          .onDelete('CASCADE');
      }

      // Unique constraint on tenant + subtype_id
      table.unique(['tenant', 'subtype_id']);
    });
    console.log('  ✓ Created tenant_internal_notification_subtype_settings');
  } else {
    console.log('  - tenant_internal_notification_subtype_settings already exists');
  }

  // Create indexes for lookups (IF NOT EXISTS)
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_tenant_notification_category_settings_lookup
      ON tenant_notification_category_settings(tenant, category_id);

    CREATE INDEX IF NOT EXISTS idx_tenant_notification_subtype_settings_lookup
      ON tenant_notification_subtype_settings(tenant, subtype_id);

    CREATE INDEX IF NOT EXISTS idx_tenant_internal_notification_category_settings_lookup
      ON tenant_internal_notification_category_settings(tenant, category_id);

    CREATE INDEX IF NOT EXISTS idx_tenant_internal_notification_subtype_settings_lookup
      ON tenant_internal_notification_subtype_settings(tenant, subtype_id);
  `);
  console.log('  ✓ Created lookup indexes');

  // Handle Citus distribution and FK constraints
  if (isCitus) {
    console.log('  Citus detected, handling distribution and foreign keys...');

    // Note: We skip making internal_notification_* tables reference tables
    // because they have complex FK relationships that prevent conversion.
    // The FK constraints to these tables will also be skipped in Citus.

    // Distribute the new tenant settings tables
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

    // Now add foreign key constraints AFTER distribution (idempotent)
    console.log('  Adding foreign key constraints after distribution...');

    // Define FK constraints to add
    // Note: We skip FK constraints to internal_notification_* tables in Citus
    // because those tables cannot be converted to reference tables
    const fkConstraints = [
      // FK to tenants table (distributed table)
      {
        table: 'tenant_notification_category_settings',
        constraint: 'tenant_notification_category_settings_tenant_foreign',
        sql: `ALTER TABLE tenant_notification_category_settings
              ADD CONSTRAINT tenant_notification_category_settings_tenant_foreign
              FOREIGN KEY (tenant) REFERENCES tenants(tenant) ON DELETE CASCADE`
      },
      {
        table: 'tenant_notification_subtype_settings',
        constraint: 'tenant_notification_subtype_settings_tenant_foreign',
        sql: `ALTER TABLE tenant_notification_subtype_settings
              ADD CONSTRAINT tenant_notification_subtype_settings_tenant_foreign
              FOREIGN KEY (tenant) REFERENCES tenants(tenant) ON DELETE CASCADE`
      },
      {
        table: 'tenant_internal_notification_category_settings',
        constraint: 'tenant_internal_notification_category_settings_tenant_foreign',
        sql: `ALTER TABLE tenant_internal_notification_category_settings
              ADD CONSTRAINT tenant_internal_notification_category_settings_tenant_foreign
              FOREIGN KEY (tenant) REFERENCES tenants(tenant) ON DELETE CASCADE`
      },
      {
        table: 'tenant_internal_notification_subtype_settings',
        constraint: 'tenant_internal_notification_subtype_settings_tenant_foreign',
        sql: `ALTER TABLE tenant_internal_notification_subtype_settings
              ADD CONSTRAINT tenant_internal_notification_subtype_settings_tenant_foreign
              FOREIGN KEY (tenant) REFERENCES tenants(tenant) ON DELETE CASCADE`
      },
      // FK to reference tables (notification_categories, notification_subtypes)
      // These are already reference tables in Citus
      {
        table: 'tenant_notification_category_settings',
        constraint: 'tenant_notification_category_settings_category_id_foreign',
        sql: `ALTER TABLE tenant_notification_category_settings
              ADD CONSTRAINT tenant_notification_category_settings_category_id_foreign
              FOREIGN KEY (category_id) REFERENCES notification_categories(id) ON DELETE CASCADE`
      },
      {
        table: 'tenant_notification_subtype_settings',
        constraint: 'tenant_notification_subtype_settings_subtype_id_foreign',
        sql: `ALTER TABLE tenant_notification_subtype_settings
              ADD CONSTRAINT tenant_notification_subtype_settings_subtype_id_foreign
              FOREIGN KEY (subtype_id) REFERENCES notification_subtypes(id) ON DELETE CASCADE`
      }
      // Note: FK constraints to internal_notification_categories and internal_notification_subtypes
      // are intentionally skipped in Citus - referential integrity is enforced at application level
    ];

    for (const fk of fkConstraints) {
      if (!await constraintExists(fk.table, fk.constraint)) {
        await knex.raw(fk.sql);
        console.log(`    ✓ Added ${fk.constraint}`);
      } else {
        console.log(`    - ${fk.constraint} already exists`);
      }
    }

  } else {
    console.log('  Citus not detected, skipping table distribution');
  }

  // Seed tenant settings from current global values
  // Skip seeding if data already exists (idempotent)
  console.log('Seeding tenant settings from global values...');

  // Check if seeding is needed (any existing data means we skip)
  const existingCategorySettings = await knex('tenant_notification_category_settings').first();
  if (existingCategorySettings) {
    console.log('  - Seeding skipped: data already exists');
  } else {
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
          await knex('tenant_notification_category_settings').insert(batch);
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
          await knex('tenant_notification_subtype_settings').insert(batch);
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
          await knex('tenant_internal_notification_category_settings').insert(batch);
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
          await knex('tenant_internal_notification_subtype_settings').insert(batch);
        }
        console.log(`  ✓ Seeded ${internalSubtypeSettings.length} internal subtype settings`);
      }
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
