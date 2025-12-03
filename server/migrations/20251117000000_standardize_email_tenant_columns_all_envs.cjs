/**
 * Standardize email tables tenant columns for ALL environments (including non-Citus)
 * This migration renames tenant_id to tenant and changes type to uuid
 * to ensure consistent schema across all environments
 */
exports.config = { transaction: false };

exports.up = async function(knex) {
  console.log('Standardizing email tables tenant columns for all environments...');

  // List of email tables that need tenant column standardization
  const emailTables = [
    'email_domains',
    'email_provider_health',
    'email_rate_limits',
    'email_sending_logs',
    'email_templates',
    'tenant_email_settings'
  ];

  for (const tableName of emailTables) {
    try {
      // Check if table exists
      const tableExists = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public'
          AND table_name = ?
        ) as exists
      `, [tableName]);

      if (!tableExists.rows[0].exists) {
        console.log(`  - ${tableName} does not exist, skipping`);
        continue;
      }

      // Check if tenant column already exists (already standardized)
      const hasTenant = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
          AND table_name = ?
          AND column_name = 'tenant'
        ) as exists
      `, [tableName]);

      if (hasTenant.rows[0].exists) {
        console.log(`  - ${tableName} already has tenant column, skipping`);
        continue;
      }

      // Check if tenant_id column exists
      const hasTenantId = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
          AND table_name = ?
          AND column_name = 'tenant_id'
        ) as exists
      `, [tableName]);

      if (!hasTenantId.rows[0].exists) {
        console.log(`  - ${tableName} does not have tenant_id column, skipping`);
        continue;
      }

      // Drop indexes that reference tenant_id
      const indexes = await knex.raw(`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = 'public'
        AND tablename = ?
        AND indexdef LIKE '%tenant_id%'
      `, [tableName]);

      for (const idx of indexes.rows) {
        await knex.raw(`DROP INDEX IF EXISTS ${idx.indexname}`);
        console.log(`  - Dropped index ${idx.indexname} from ${tableName}`);
      }

      // Drop any unique constraints that reference tenant_id
      const uniqueConstraints = await knex.raw(`
        SELECT con.conname
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
        WHERE nsp.nspname = 'public'
        AND rel.relname = ?
        AND con.contype = 'u'
        AND EXISTS (
          SELECT 1 FROM unnest(con.conkey) AS col
          WHERE col = (
            SELECT attnum FROM pg_attribute
            WHERE attrelid = rel.oid
            AND attname = 'tenant_id'
          )
        )
      `, [tableName]);

      for (const constraint of uniqueConstraints.rows) {
        await knex.raw(`ALTER TABLE ${tableName} DROP CONSTRAINT IF EXISTS ${constraint.conname}`);
        console.log(`  - Dropped unique constraint ${constraint.conname} from ${tableName}`);
      }

      // Drop any foreign key constraints that reference tenant_id
      const fkConstraints = await knex.raw(`
        SELECT con.conname
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
        WHERE nsp.nspname = 'public'
        AND rel.relname = ?
        AND con.contype = 'f'
        AND EXISTS (
          SELECT 1 FROM unnest(con.conkey) AS col
          WHERE col = (
            SELECT attnum FROM pg_attribute
            WHERE attrelid = rel.oid
            AND attname = 'tenant_id'
          )
        )
      `, [tableName]);

      for (const constraint of fkConstraints.rows) {
        await knex.raw(`ALTER TABLE ${tableName} DROP CONSTRAINT IF EXISTS ${constraint.conname}`);
        console.log(`  - Dropped FK constraint ${constraint.conname} from ${tableName}`);
      }

      // Drop primary key if it includes tenant_id
      const pkConstraint = await knex.raw(`
        SELECT con.conname
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
        WHERE nsp.nspname = 'public'
        AND rel.relname = ?
        AND con.contype = 'p'
        AND EXISTS (
          SELECT 1 FROM unnest(con.conkey) AS col
          WHERE col = (
            SELECT attnum FROM pg_attribute
            WHERE attrelid = rel.oid
            AND attname = 'tenant_id'
          )
        )
      `, [tableName]);

      if (pkConstraint.rows.length > 0) {
        await knex.raw(`ALTER TABLE ${tableName} DROP CONSTRAINT ${pkConstraint.rows[0].conname} CASCADE`);
        console.log(`  - Dropped primary key ${pkConstraint.rows[0].conname} from ${tableName}`);
      }

      // Rename tenant_id to tenant
      await knex.raw(`ALTER TABLE ${tableName} RENAME COLUMN tenant_id TO tenant`);
      console.log(`  - Renamed tenant_id to tenant in ${tableName}`);

      // Change column type to uuid
      await knex.raw(`ALTER TABLE ${tableName} ALTER COLUMN tenant TYPE uuid USING tenant::uuid`);
      console.log(`  - Changed tenant column type to uuid in ${tableName}`);

      // Re-add foreign key constraint to tenants table
      await knex.raw(`
        ALTER TABLE ${tableName}
        ADD CONSTRAINT ${tableName}_tenant_fkey
        FOREIGN KEY (tenant) REFERENCES tenants(tenant) ON DELETE CASCADE
      `);
      console.log(`  - Added FK constraint to tenants table`);

      // Re-create indexes with tenant column
      await knex.raw(`CREATE INDEX IF NOT EXISTS idx_${tableName}_tenant ON ${tableName}(tenant)`);
      console.log(`  - Created index idx_${tableName}_tenant`);

      console.log(`  ✓ Standardized ${tableName} tenant column`);

    } catch (error) {
      console.error(`  ✗ Failed to standardize ${tableName}: ${error.message}`);
      throw error;
    }
  }

  console.log('Email tables tenant column standardization complete');
};

exports.down = async function(knex) {
  console.log('Reverting email tables tenant column standardization...');

  const emailTables = [
    'email_domains',
    'email_provider_health',
    'email_rate_limits',
    'email_sending_logs',
    'email_templates',
    'tenant_email_settings'
  ];

  for (const tableName of emailTables) {
    try {
      // Check if table exists
      const tableExists = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public'
          AND table_name = ?
        ) as exists
      `, [tableName]);

      if (!tableExists.rows[0].exists) {
        continue;
      }

      // Check if tenant column exists
      const hasTenant = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
          AND table_name = ?
          AND column_name = 'tenant'
        ) as exists
      `, [tableName]);

      if (!hasTenant.rows[0].exists) {
        continue;
      }

      // Check if tenant_id already exists (already reverted)
      const hasTenantId = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
          AND table_name = ?
          AND column_name = 'tenant_id'
        ) as exists
      `, [tableName]);

      if (hasTenantId.rows[0].exists) {
        console.log(`  - ${tableName} already has tenant_id column, skipping`);
        continue;
      }

      // Drop foreign key constraint
      await knex.raw(`ALTER TABLE ${tableName} DROP CONSTRAINT IF EXISTS ${tableName}_tenant_fkey`);

      // Drop tenant index
      await knex.raw(`DROP INDEX IF EXISTS idx_${tableName}_tenant`);

      // Change column type back to varchar
      await knex.raw(`ALTER TABLE ${tableName} ALTER COLUMN tenant TYPE varchar(255) USING tenant::text`);

      // Rename tenant back to tenant_id
      await knex.raw(`ALTER TABLE ${tableName} RENAME COLUMN tenant TO tenant_id`);

      // Re-create original index
      await knex.raw(`CREATE INDEX IF NOT EXISTS idx_${tableName}_tenant_id ON ${tableName}(tenant_id)`);

      console.log(`  ✓ Reverted ${tableName} tenant column`);

    } catch (error) {
      console.error(`  ✗ Failed to revert ${tableName}: ${error.message}`);
    }
  }
};
