/**
 * Shared utilities for Citus-compatible migrations
 */

/**
 * Check if Citus is available by looking for run_command_on_shards function
 * @param {import("knex").Knex} knex
 * @returns {Promise<boolean>}
 */
async function isCitusAvailable(knex) {
    const result = await knex.raw(`
        SELECT EXISTS (
            SELECT 1 FROM pg_proc
            WHERE proname = 'run_command_on_shards'
        ) AS exists
    `);
    return result.rows?.[0]?.exists || false;
}

/**
 * Check if a table is distributed (uses parameterized query to avoid SQL injection)
 * @param {import("knex").Knex} knex
 * @param {string} tableName
 * @returns {Promise<boolean>}
 */
async function isTableDistributed(knex, tableName) {
    try {
        const result = await knex.raw(`
            SELECT EXISTS (
                SELECT 1 FROM pg_dist_partition
                WHERE logicalrelid = to_regclass(?)
            ) AS distributed
        `, [tableName]);
        return result.rows?.[0]?.distributed || false;
    } catch (e) {
        // pg_dist_partition doesn't exist if Citus isn't installed
        return false;
    }
}

/**
 * Run a command on all shards of a distributed table
 * Throws on failure to ensure migration aborts on error
 * @param {import("knex").Knex} knex
 * @param {string} tableName
 * @param {string} command - SQL command with %s placeholder for shard table name
 * @returns {Promise<void>}
 */
async function runCommandOnShards(knex, tableName, command) {
    try {
        const result = await knex.raw(`
            SELECT run_command_on_shards(
                ?,
                $cmd$${command}$cmd$
            )
        `, [tableName]);

        // Check if any shard command failed
        const failures = result.rows?.filter(r => !r.success) || [];
        if (failures.length > 0) {
            const errorDetails = failures.map(f => `Shard ${f.shardid}: ${f.result}`).join('; ');
            throw new Error(`run_command_on_shards failed on ${failures.length} shard(s): ${errorDetails}`);
        }

        return result;
    } catch (e) {
        console.error(`ERROR: run_command_on_shards failed for ${tableName}: ${e.message}`);
        throw e; // Re-throw to abort migration
    }
}

/**
 * Distribute a table if Citus is available and table is not already distributed
 * Colocates with tenants table for efficient cross-table queries
 * @param {import("knex").Knex} knex
 * @param {string} tableName
 * @returns {Promise<void>}
 */
async function distributeTableIfNeeded(knex, tableName) {
    const citusAvailable = await isCitusAvailable(knex);
    if (!citusAvailable) {
        console.log(`  [${tableName}] Skipping distribution (Citus not available)`);
        return;
    }

    const distributed = await isTableDistributed(knex, tableName);
    if (distributed) {
        console.log(`  [${tableName}] Already distributed`);
        return;
    }

    try {
        // Try with colocation first for optimal query performance
        await knex.raw(`SELECT create_distributed_table(?, 'tenant', colocate_with => 'tenants')`, [tableName]);
        console.log(`  ✓ Distributed ${tableName} (colocated with tenants)`);
    } catch (e) {
        // Fall back to distribution without colocation if it fails
        console.log(`  Colocation failed for ${tableName}, retrying without colocation...`);
        try {
            await knex.raw(`SELECT create_distributed_table(?, 'tenant')`, [tableName]);
            console.log(`  ✓ Distributed ${tableName}`);
        } catch (e2) {
            console.error(`ERROR: Failed to distribute ${tableName}: ${e2.message}`);
            throw e2; // Re-throw to abort migration
        }
    }
}

module.exports = {
    isCitusAvailable,
    isTableDistributed,
    runCommandOnShards,
    distributeTableIfNeeded
};
