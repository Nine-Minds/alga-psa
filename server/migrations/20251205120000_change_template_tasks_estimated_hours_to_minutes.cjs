/**
 * Migration: Change project_template_tasks.estimated_hours to store minutes
 *
 * This migration changes estimated_hours from decimal (storing hours) to bigint (storing minutes)
 * to match the project_tasks table, which also stores estimated_hours in minutes.
 *
 * Data conversion:
 * - Existing values are multiplied by 60 (hours → minutes)
 * - e.g., 1.5 hours becomes 90 minutes
 */

// Disable transaction for Citus DB compatibility
exports.config = { transaction: false };

/**
 * Check if we're running on a Citus distributed database cluster.
 * @param { import("knex").Knex } knex
 * @returns { Promise<boolean> }
 */
async function isCitusCluster(knex) {
  try {
    const result = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'citus'
      ) as has_citus
    `);
    return result.rows[0]?.has_citus === true;
  } catch (error) {
    return false;
  }
}

/**
 * Check if a table is distributed in Citus.
 * @param { import("knex").Knex } knex
 * @param { string } tableName
 * @returns { Promise<boolean> }
 */
async function isTableDistributed(knex, tableName) {
  try {
    const result = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition WHERE logicalrelid = ?::regclass
      ) as is_distributed
    `, [tableName]);
    return result.rows[0]?.is_distributed === true;
  } catch (error) {
    // pg_dist_partition doesn't exist - not Citus
    return false;
  }
}

/**
 * Wait for distributed changes to propagate across Citus shards.
 * @param { import("knex").Knex } knex
 * @param { number } ms
 * @param { string } message
 */
async function waitForCitusPropagation(knex, ms, message) {
  if (await isCitusCluster(knex)) {
    console.log(message);
    await new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  const isCitus = await isCitusCluster(knex);
  const isDistributed = await isTableDistributed(knex, 'project_template_tasks');

  console.log(`Citus cluster: ${isCitus}, Table distributed: ${isDistributed}`);

  // Step 1: Convert existing data from hours to minutes (per-tenant for Citus safety)
  console.log('Converting estimated_hours from hours to minutes...');

  // Get all tenants
  const tenants = await knex('tenants').select('tenant').orderBy('tenant');
  console.log(`Found ${tenants.length} tenant(s)`);

  for (const { tenant } of tenants) {
    // Update only rows for this tenant that have non-null estimated_hours
    const result = await knex('project_template_tasks')
      .where({ tenant })
      .whereNotNull('estimated_hours')
      .update({
        estimated_hours: knex.raw('estimated_hours * 60')
      });

    if (result > 0) {
      console.log(`  Tenant ${tenant}: converted ${result} task(s)`);
    }
  }

  // Wait for propagation on Citus
  await waitForCitusPropagation(knex, 3000, 'Waiting for data conversion to propagate...');

  // Step 2: Change column type from decimal to bigint
  console.log('Changing column type to BIGINT...');

  if (isDistributed) {
    // Citus distributed table - use shard-based approach
    console.log('Using Citus shard-based ALTER TABLE...');

    try {
      // Change type on all shards first
      await knex.raw(`
        SELECT * FROM run_command_on_shards(
          'project_template_tasks',
          $$ALTER TABLE %s ALTER COLUMN estimated_hours TYPE BIGINT USING estimated_hours::BIGINT$$
        )
      `);
      console.log('Changed type on all shards');

      // Update coordinator metadata
      // Note: This updates the pg_attribute to reflect the new type on the coordinator
      await knex.raw(`
        UPDATE pg_attribute
        SET atttypid = 'bigint'::regtype::oid,
            atttypmod = -1
        WHERE attrelid = 'project_template_tasks'::regclass
        AND attname = 'estimated_hours'
      `);
      console.log('Updated coordinator metadata');
    } catch (error) {
      console.error('Citus ALTER failed:', error.message);
      throw error;
    }
  } else {
    // Standard PostgreSQL
    await knex.raw(`
      ALTER TABLE project_template_tasks
      ALTER COLUMN estimated_hours TYPE BIGINT
      USING estimated_hours::BIGINT
    `);
    console.log('Changed column type to BIGINT');
  }

  console.log('Migration complete!');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  const isDistributed = await isTableDistributed(knex, 'project_template_tasks');

  console.log('Reverting estimated_hours to decimal (hours)...');

  if (isDistributed) {
    // Citus distributed table
    console.log('Using Citus shard-based ALTER TABLE...');

    try {
      // Change type back to decimal on all shards
      await knex.raw(`
        SELECT * FROM run_command_on_shards(
          'project_template_tasks',
          $$ALTER TABLE %s ALTER COLUMN estimated_hours TYPE DECIMAL(10,2) USING (estimated_hours / 60.0)::DECIMAL(10,2)$$
        )
      `);

      // Update coordinator metadata
      await knex.raw(`
        UPDATE pg_attribute
        SET atttypid = 'numeric'::regtype::oid,
            atttypmod = ((10 + 4) << 16) | (2 + 4)
        WHERE attrelid = 'project_template_tasks'::regclass
        AND attname = 'estimated_hours'
      `);
    } catch (error) {
      console.error('Citus ALTER failed:', error.message);
      throw error;
    }
  } else {
    // Standard PostgreSQL
    await knex.raw(`
      ALTER TABLE project_template_tasks
      ALTER COLUMN estimated_hours TYPE DECIMAL(10,2)
      USING (estimated_hours / 60.0)::DECIMAL(10,2)
    `);
  }

  console.log('Reverted to decimal (hours)');
};
