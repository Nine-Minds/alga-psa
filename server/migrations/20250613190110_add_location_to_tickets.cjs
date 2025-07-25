
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
    console.log('company_locations is not a distributed table - skipping foreign key constraint');
    // Only add the index
    await knex.schema.table('tickets', function(table) {
      table.index(['location_id', 'tenant'], 'idx_tickets_location_tenant');
    });
  } else {
    console.log('company_locations is a distributed table - adding foreign key constraint');
    // Add both foreign key and index
    await knex.schema.table('tickets', function(table) {
      // For CitusDB compatibility, reference both location_id and tenant
      // Note: We use RESTRICT instead of SET NULL because PostgreSQL doesn't support 
      // SET NULL on composite foreign keys where only one column should be nulled
      table.foreign(['location_id', 'tenant']).references(['location_id', 'tenant']).inTable('company_locations').onDelete('RESTRICT');
      table.index(['location_id', 'tenant'], 'idx_tickets_location_tenant');
    });
  }
};

exports.down = async function(knex) {
  // Check if company_locations was a distributed table when we ran up
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
  }

  await knex.schema.table('tickets', function(table) {
    table.dropIndex(['location_id', 'tenant'], 'idx_tickets_location_tenant');
    if (isDistributed) {
      // Only drop foreign key if it was created
      table.dropForeign(['location_id', 'tenant']);
    }
    table.dropColumn('location_id');
  });
};
