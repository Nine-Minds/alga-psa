
exports.up = async function(knex) {
  // Add the location_id column
  await knex.schema.table('tickets', function(table) {
    table.uuid('location_id').nullable();
  });

  // Check if company_locations is a distributed table
  let isDistributed = false;
  try {
    const result = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition 
        WHERE logicalrelid = 'company_locations'::regclass
      ) as is_distributed
    `);
    isDistributed = result.rows[0].is_distributed;
  } catch (error) {
    // pg_dist_partition doesn't exist, not using Citus
    console.log('Citus not detected, proceeding with foreign key');
  }

  if (!isDistributed) {
    console.log('company_locations is not a distributed table - adding foreign key constraint');
    // Add both foreign key and index for non-distributed tables
    await knex.schema.table('tickets', function(table) {
      // For CitusDB compatibility, reference both location_id and tenant
      // Note: We use RESTRICT instead of SET NULL because PostgreSQL doesn't support 
      // SET NULL on composite foreign keys where only one column should be nulled
      table.foreign(['location_id', 'tenant']).references(['location_id', 'tenant']).inTable('company_locations').onDelete('RESTRICT');
      table.index(['location_id', 'tenant'], 'idx_tickets_location_tenant');
    });
  } else {
    console.log('company_locations is a distributed table - checking if tickets is also distributed');
    
    // Check if tickets is also distributed
    let ticketsDistributed = false;
    try {
      const ticketsResult = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM pg_dist_partition 
          WHERE logicalrelid = 'tickets'::regclass
        ) as is_distributed
      `);
      ticketsDistributed = ticketsResult.rows[0].is_distributed;
    } catch (error) {
      // Ignore error
    }
    
    if (ticketsDistributed) {
      console.log('Both tables are distributed - adding foreign key constraint');
      // Both tables are distributed, can add foreign key
      await knex.schema.table('tickets', function(table) {
        table.foreign(['location_id', 'tenant']).references(['location_id', 'tenant']).inTable('company_locations').onDelete('RESTRICT');
        table.index(['location_id', 'tenant'], 'idx_tickets_location_tenant');
      });
    } else {
      console.log('Tables have incompatible distribution - skipping foreign key, adding index only');
      // Incompatible distribution, skip foreign key
      await knex.schema.table('tickets', function(table) {
        table.index(['location_id', 'tenant'], 'idx_tickets_location_tenant');
      });
    }
  }
};

exports.down = async function(knex) {
  // We need to determine if we added a foreign key in the up migration
  // This depends on whether both tables were distributed or not
  let shouldDropForeignKey = true;
  
  try {
    // Check if company_locations is distributed
    const locResult = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition 
        WHERE logicalrelid = 'company_locations'::regclass
      ) as is_distributed
    `);
    
    if (locResult.rows[0].is_distributed) {
      // If company_locations is distributed, check if tickets is too
      const ticketsResult = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM pg_dist_partition 
          WHERE logicalrelid = 'tickets'::regclass
        ) as is_distributed
      `);
      
      // Only skip foreign key drop if tables have incompatible distribution
      if (!ticketsResult.rows[0].is_distributed) {
        shouldDropForeignKey = false;
      }
    }
  } catch (error) {
    // pg_dist_partition doesn't exist, not using Citus
    // In this case we would have added the foreign key
  }

  await knex.schema.table('tickets', function(table) {
    table.dropIndex(['location_id', 'tenant'], 'idx_tickets_location_tenant');
    if (shouldDropForeignKey) {
      table.dropForeign(['location_id', 'tenant']);
    }
    table.dropColumn('location_id');
  });
};
