/**
 * Standardize email tables tenant columns before distribution
 * This migration renames tenant_id to tenant and changes type to uuid
 * to ensure proper colocation with other tenant-scoped tables
 */
exports.config = { transaction: false };

exports.up = async function(knex) {
  // Check if Citus is enabled
  const citusEnabled = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'citus'
    ) as enabled
  `);
  
  if (!citusEnabled.rows[0].enabled) {
    console.log('Citus not enabled, skipping email tables standardization');
    return;
  }

  console.log('Standardizing email tables tenant columns...');
  
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
      
      // Check if tenant column already exists
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
      
      // First, drop any foreign key constraints that reference tenant_id
      const fkConstraints = await knex.raw(`
        SELECT conname 
        FROM pg_constraint 
        WHERE contype = 'f' 
        AND conrelid = ?::regclass
        AND EXISTS (
          SELECT 1 FROM unnest(conkey) AS col
          WHERE col = (
            SELECT attnum FROM pg_attribute 
            WHERE attrelid = ?::regclass 
            AND attname = 'tenant_id'
          )
        )
      `, [tableName, tableName]);
      
      for (const constraint of fkConstraints.rows) {
        await knex.raw(`ALTER TABLE ${tableName} DROP CONSTRAINT IF EXISTS ${constraint.conname}`);
        console.log(`  - Dropped FK constraint ${constraint.conname} from ${tableName}`);
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
      console.log(`  ✓ Standardized ${tableName} tenant column`);
      
    } catch (error) {
      console.error(`  ✗ Failed to standardize ${tableName}: ${error.message}`);
      throw error;
    }
  }
  
  console.log('Email tables tenant column standardization complete');
};

exports.down = async function(knex) {
  // Check if Citus is enabled
  const citusEnabled = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'citus'
    ) as enabled
  `);
  
  if (!citusEnabled.rows[0].enabled) {
    console.log('Citus not enabled, nothing to undo');
    return;
  }

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
      
      // Drop foreign key constraint
      await knex.raw(`ALTER TABLE ${tableName} DROP CONSTRAINT IF EXISTS ${tableName}_tenant_fkey`);
      
      // Change column type back to varchar
      await knex.raw(`ALTER TABLE ${tableName} ALTER COLUMN tenant TYPE varchar(255) USING tenant::text`);
      
      // Rename tenant back to tenant_id
      await knex.raw(`ALTER TABLE ${tableName} RENAME COLUMN tenant TO tenant_id`);
      
      console.log(`  ✓ Reverted ${tableName} tenant column`);
      
    } catch (error) {
      console.error(`  ✗ Failed to revert ${tableName}: ${error.message}`);
    }
  }
};