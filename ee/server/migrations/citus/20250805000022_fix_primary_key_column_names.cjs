/**
 * Fix primary keys with correct column names for Citus distribution
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
    console.log('Citus not enabled, skipping primary key fixes');
    return;
  }

  console.log('Fixing primary keys with correct column names...');
  
  // Map of table name to correct primary key column name
  const primaryKeyFixes = [
    { table: 'task_checklist_items', column: 'checklist_item_id' },
    { table: 'service_types', column: 'id' },
    { table: 'document_content', column: 'id' },
    { table: 'notification_settings', column: 'id' },
    { table: 'email_provider_health', column: 'id' },
    { table: 'credit_tracking', column: 'credit_id' },
    { table: 'notification_logs', column: 'id' }
  ];
  
  for (const fix of primaryKeyFixes) {
    try {
      console.log(`\nFixing primary key for ${fix.table}...`);
      
      // Check if table exists
      const tableExists = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = ?
        ) as exists
      `, [fix.table]);
      
      if (!tableExists.rows[0].exists) {
        console.log(`  Table ${fix.table} does not exist, skipping`);
        continue;
      }
      
      // Check if table has tenant column
      const hasTenant = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_schema = 'public' 
          AND table_name = ?
          AND column_name IN ('tenant', 'tenant_id')
        ) as has_tenant
      `, [fix.table]);
      
      if (!hasTenant.rows[0].has_tenant) {
        console.log(`  Table ${fix.table} does not have tenant column, skipping`);
        continue;
      }
      
      // Get the tenant column name
      const tenantColumn = await knex.raw(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = ?
        AND column_name IN ('tenant', 'tenant_id')
        LIMIT 1
      `, [fix.table]);
      
      const tenantColName = tenantColumn.rows[0]?.column_name || 'tenant';
      
      // Check current primary key
      const currentPK = await knex.raw(`
        SELECT con.conname, 
               array_agg(att.attname ORDER BY unnest.ord) as columns
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
        CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS unnest(attnum, ord)
        JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = unnest.attnum
        WHERE nsp.nspname = 'public'
        AND rel.relname = ?
        AND con.contype = 'p'
        GROUP BY con.conname
      `, [fix.table]);
      
      if (currentPK.rows.length > 0) {
        const currentColumns = currentPK.rows[0].columns;
        
        // Check if PK already includes tenant and the correct column
        if (currentColumns.includes(tenantColName) && currentColumns.includes(fix.column)) {
          console.log(`  Primary key already correct for ${fix.table}`);
          continue;
        }
        
        // Drop existing primary key with CASCADE
        console.log(`  Dropping old primary key ${currentPK.rows[0].conname}...`);
        await knex.raw(`ALTER TABLE ${fix.table} DROP CONSTRAINT ${currentPK.rows[0].conname} CASCADE`);
      }
      
      // Add new primary key with tenant and correct column
      console.log(`  Adding new primary key (${tenantColName}, ${fix.column})...`);
      await knex.raw(`
        ALTER TABLE ${fix.table} 
        ADD CONSTRAINT ${fix.table}_pkey 
        PRIMARY KEY (${tenantColName}, ${fix.column})
      `);
      
      console.log(`  ✓ Fixed primary key for ${fix.table}`);
      
    } catch (error) {
      console.error(`  ✗ Failed to fix primary key for ${fix.table}: ${error.message}`);
      // Continue with other tables instead of throwing
    }
  }
  
  console.log('\n✓ Primary key fixes completed');
};

exports.down = async function(knex) {
  // Reverting primary keys is complex and risky
  // This would need to be done manually based on the original schema
  console.log('Reverting primary key changes must be done manually');
};