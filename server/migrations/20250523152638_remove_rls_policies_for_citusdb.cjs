
exports.up = async function(knex) {
  // Remove all RLS policies since CitusDB provides tenant-level restrictions automatically
  console.log('Removing all RLS policies and disabling RLS for CitusDB compatibility...');
  
  // Get all tables with RLS enabled
  const tablesWithRLS = await knex.raw(`
    SELECT tablename 
    FROM pg_tables 
    WHERE schemaname = 'public' AND rowsecurity = true 
    ORDER BY tablename
  `);
  
  const tables = tablesWithRLS.rows.map(row => row.tablename);
  
  for (const tableName of tables) {
    console.log(`Processing table: ${tableName}`);
    
    // Get all policies for this table
    const policies = await knex.raw(`
      SELECT policyname 
      FROM pg_policies 
      WHERE schemaname = 'public' AND tablename = ?
    `, [tableName]);
    
    // Drop all policies for this table
    for (const policy of policies.rows) {
      await knex.raw(`DROP POLICY IF EXISTS "${policy.policyname}" ON "${tableName}"`);
    }
    
    // Disable RLS for this table
    await knex.raw(`ALTER TABLE "${tableName}" DISABLE ROW LEVEL SECURITY`);
  }
  
  console.log(`Removed RLS from ${tables.length} tables`);
  
  // Drop the get_current_tenant_id() function as it's no longer needed
  console.log('Dropping get_current_tenant_id() function...');
  await knex.raw(`DROP FUNCTION IF EXISTS get_current_tenant_id()`);
  
  console.log('CitusDB migration completed - RLS removed, tenant isolation now handled at shard level');
};

exports.down = function(knex) {
  // This migration is intended to be irreversible for CitusDB compatibility
  // RLS policies would need to be recreated manually if needed
  throw new Error('This migration cannot be rolled back - RLS policies have been permanently removed for CitusDB compatibility');
};
