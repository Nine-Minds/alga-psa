/**
 * Cleanup any existing Citus distribution from previous runs
 * This should run first to ensure a clean slate
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
    console.log('Citus not enabled, skipping cleanup');
    return;
  }

  console.log('Cleaning up any existing Citus distribution...');
  
  try {
    // Get all distributed tables
    const distributedTables = await knex.raw(`
      SELECT logicalrelid::regclass::text as table_name,
             CASE 
               WHEN partmethod = 'h' THEN 'distributed'
               WHEN partmethod = 'n' THEN 'reference'
             END as table_type
      FROM pg_dist_partition
      ORDER BY table_name
    `);
    
    if (distributedTables.rows.length > 0) {
      console.log(`Found ${distributedTables.rows.length} distributed/reference tables to clean up`);
      
      // First drop all foreign keys that might prevent undistribution
      for (const { table_name, table_type } of distributedTables.rows) {
        try {
          // Get all foreign keys for this table
          const fkeys = await knex.raw(`
            SELECT conname 
            FROM pg_constraint 
            WHERE contype = 'f' 
            AND conrelid = ?::regclass
          `, [table_name]);
          
          for (const fk of fkeys.rows) {
            try {
              await knex.raw(`ALTER TABLE ${table_name} DROP CONSTRAINT IF EXISTS ${fk.conname}`);
              console.log(`  - Dropped FK ${fk.conname} from ${table_name}`);
            } catch (e) {
              // Ignore errors dropping constraints
            }
          }
        } catch (e) {
          // Ignore errors getting constraints
        }
      }
      
      // Now undistribute all tables
      for (const { table_name, table_type } of distributedTables.rows) {
        try {
          await knex.raw(`SELECT undistribute_table('${table_name}')`);
          console.log(`  ✓ Undistributed ${table_type} table: ${table_name}`);
        } catch (e) {
          console.log(`  - Could not undistribute ${table_name}: ${e.message}`);
        }
      }
      
      console.log('Cleanup complete');
    } else {
      console.log('No distributed tables found, starting fresh');
    }
    
  } catch (error) {
    console.log('No existing distribution found or cleanup not needed');
  }
};

exports.down = async function(knex) {
  // Nothing to undo for cleanup
  console.log('Cleanup migration cannot be rolled back');
};