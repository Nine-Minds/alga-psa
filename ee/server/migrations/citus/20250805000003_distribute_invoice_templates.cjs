/**
 * Distribute invoice_templates table
 * This must happen before companies since companies has FK to invoice_templates
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
    console.log('Citus not enabled, skipping table distribution');
    return;
  }

  console.log('Distributing invoice_templates table...');
  
  try {
    // Check if table exists
    const tableExists = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'invoice_templates'
      ) as exists
    `);
    
    if (!tableExists.rows[0].exists) {
      console.log('  invoice_templates table does not exist, skipping');
      return;
    }

    // Check if already distributed
    const isDistributed = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition 
        WHERE logicalrelid = 'invoice_templates'::regclass
      ) as distributed
    `);
    
    if (isDistributed.rows[0].distributed) {
      console.log('  invoice_templates table already distributed');
      return;
    }

    // Distribute the table
    await knex.raw(`SELECT create_distributed_table('invoice_templates', 'tenant', colocate_with => 'tenants')`);
    console.log('  ✓ Distributed invoice_templates table');
    
  } catch (error) {
    console.error(`  ✗ Failed to distribute invoice_templates: ${error.message}`);
    throw error;
  }
};

exports.down = async function(knex) {
  // Check if Citus is enabled
  const citusEnabled = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'citus'
    ) as enabled
  `);
  
  if (!citusEnabled.rows[0].enabled) {
    return;
  }

  console.log('Undistributing invoice_templates table...');
  
  try {
    const isDistributed = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition 
        WHERE logicalrelid = 'invoice_templates'::regclass
      ) as distributed
    `);
    
    if (isDistributed.rows[0].distributed) {
      await knex.raw(`SELECT undistribute_table('invoice_templates')`);
      console.log('  ✓ Undistributed invoice_templates table');
    }
  } catch (error) {
    console.error(`  ✗ Failed to undistribute invoice_templates: ${error.message}`);
  }
};