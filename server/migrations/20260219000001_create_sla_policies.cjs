/**
 * Migration: Create SLA Policy System Tables
 *
 * Creates tables for SLA policy management:
 * - sla_policies: SLA policy templates
 * - sla_policy_targets: SLA targets per priority within a policy
 * - sla_settings: Global SLA settings per tenant
 * - status_sla_pause_config: Per-status pause configuration
 * - Adds sla_policy_id column to clients (client-level SLA)
 * - Adds sla_policy_id column to boards (board-level SLA)
 *
 * SLA Policy Resolution Hierarchy:
 * 1. Client (clients.sla_policy_id) - if set, use client's policy
 * 2. Board (boards.sla_policy_id) - if set, use board's policy
 * 3. Tenant default (sla_policies.is_default = true)
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
// Helper: distribute a table by tenant if Citus is available
async function distributeIfCitus(knex, tableName) {
    const citusFn = await knex.raw(`
        SELECT EXISTS (
            SELECT 1 FROM pg_proc WHERE proname = 'create_distributed_table'
        ) AS exists;
    `);
    if (citusFn.rows?.[0]?.exists) {
        const alreadyDistributed = await knex.raw(`
            SELECT EXISTS (
                SELECT 1 FROM pg_dist_partition
                WHERE logicalrelid = '${tableName}'::regclass
            ) AS is_distributed;
        `);
        if (!alreadyDistributed.rows?.[0]?.is_distributed) {
            await knex.raw(`SELECT create_distributed_table('${tableName}', 'tenant')`);
        }
    }
}

exports.up = async function(knex) {
    // Create sla_policies table
    if (!(await knex.schema.hasTable('sla_policies'))) {
        await knex.schema.createTable('sla_policies', (table) => {
            table.uuid('tenant').notNullable();
            table.uuid('sla_policy_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
            table.text('policy_name').notNullable();
            table.text('description');
            table.boolean('is_default').defaultTo(false);
            table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
            table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

            table.primary(['tenant', 'sla_policy_id']);
            table.foreign('tenant').references('tenant').inTable('tenants');
        });
    }

    // Distribute sla_policies for Citus (must happen before FKs from other distributed tables)
    await distributeIfCitus(knex, 'sla_policies');

    // Create sla_policy_targets table
    if (!(await knex.schema.hasTable('sla_policy_targets'))) {
        await knex.schema.createTable('sla_policy_targets', (table) => {
            table.uuid('tenant').notNullable();
            table.uuid('target_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
            table.uuid('sla_policy_id').notNullable();
            table.uuid('priority_id').notNullable();
            table.integer('response_time_minutes');
            table.integer('resolution_time_minutes');
            table.integer('escalation_1_percent').defaultTo(70);
            table.integer('escalation_2_percent').defaultTo(90);
            table.integer('escalation_3_percent').defaultTo(110);
            table.boolean('is_24x7').defaultTo(false);
            table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
            table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

            table.primary(['tenant', 'target_id']);
            table.foreign('tenant').references('tenant').inTable('tenants');
            table.foreign(['tenant', 'sla_policy_id']).references(['tenant', 'sla_policy_id']).inTable('sla_policies');
            table.foreign(['tenant', 'priority_id']).references(['tenant', 'priority_id']).inTable('priorities');
        });
    }

    // Distribute sla_policy_targets for Citus
    await distributeIfCitus(knex, 'sla_policy_targets');

    // Create sla_settings table
    if (!(await knex.schema.hasTable('sla_settings'))) {
        await knex.schema.createTable('sla_settings', (table) => {
            table.uuid('tenant').notNullable();
            table.boolean('pause_on_awaiting_client').defaultTo(true);
            table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
            table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

            table.primary(['tenant']);
            table.foreign('tenant').references('tenant').inTable('tenants');
        });
    }

    // Distribute sla_settings for Citus
    await distributeIfCitus(knex, 'sla_settings');

    // Create status_sla_pause_config table
    if (!(await knex.schema.hasTable('status_sla_pause_config'))) {
        await knex.schema.createTable('status_sla_pause_config', (table) => {
            table.uuid('tenant').notNullable();
            table.uuid('config_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
            table.uuid('status_id').notNullable();
            table.boolean('pauses_sla').defaultTo(false);
            table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());

            table.primary(['tenant', 'config_id']);
            table.foreign('tenant').references('tenant').inTable('tenants');
            table.foreign(['tenant', 'status_id']).references(['tenant', 'status_id']).inTable('statuses');
        });
    }

    // Distribute status_sla_pause_config for Citus
    await distributeIfCitus(knex, 'status_sla_pause_config');

    // Add sla_policy_id to clients (client-level SLA)
    if (!(await knex.schema.hasColumn('clients', 'sla_policy_id'))) {
        await knex.schema.alterTable('clients', (table) => {
            table.uuid('sla_policy_id');
        });
    }

    // Add foreign key for sla_policy_id on clients
    await knex.raw(`
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'clients_sla_policy_fkey'
            ) THEN
                ALTER TABLE clients
                ADD CONSTRAINT clients_sla_policy_fkey
                FOREIGN KEY (tenant, sla_policy_id)
                REFERENCES sla_policies(tenant, sla_policy_id);
            END IF;
        END $$;
    `);

    // Add sla_policy_id to boards (board-level SLA)
    if (!(await knex.schema.hasColumn('boards', 'sla_policy_id'))) {
        await knex.schema.alterTable('boards', (table) => {
            table.uuid('sla_policy_id');
        });
    }

    // Add foreign key for sla_policy_id on boards
    await knex.raw(`
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'boards_sla_policy_fkey'
            ) THEN
                ALTER TABLE boards
                ADD CONSTRAINT boards_sla_policy_fkey
                FOREIGN KEY (tenant, sla_policy_id)
                REFERENCES sla_policies(tenant, sla_policy_id);
            END IF;
        END $$;
    `);

    // Create indexes for tenant-based queries
    await knex.raw(`
        CREATE INDEX IF NOT EXISTS idx_sla_policies_tenant ON sla_policies(tenant);
        CREATE INDEX IF NOT EXISTS idx_sla_policies_is_default ON sla_policies(tenant, is_default);
        CREATE INDEX IF NOT EXISTS idx_sla_policy_targets_tenant ON sla_policy_targets(tenant);
        CREATE INDEX IF NOT EXISTS idx_sla_policy_targets_policy ON sla_policy_targets(tenant, sla_policy_id);
        CREATE INDEX IF NOT EXISTS idx_sla_policy_targets_priority ON sla_policy_targets(tenant, priority_id);
        CREATE INDEX IF NOT EXISTS idx_status_sla_pause_config_tenant ON status_sla_pause_config(tenant);
        CREATE INDEX IF NOT EXISTS idx_status_sla_pause_config_status ON status_sla_pause_config(tenant, status_id);
        CREATE INDEX IF NOT EXISTS idx_clients_sla_policy ON clients(tenant, sla_policy_id);
        CREATE INDEX IF NOT EXISTS idx_boards_sla_policy ON boards(tenant, sla_policy_id);
    `);

    // Create unique constraint for sla_policy_targets (one target per policy+priority combination)
    await knex.raw(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_sla_policy_targets_unique_policy_priority
        ON sla_policy_targets(tenant, sla_policy_id, priority_id);
    `);

    // Create unique constraint for status_sla_pause_config (one config per status)
    await knex.raw(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_status_sla_pause_config_unique_status
        ON status_sla_pause_config(tenant, status_id);
    `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
    // Drop indexes
    await knex.raw(`
        DROP INDEX IF EXISTS idx_status_sla_pause_config_unique_status;
        DROP INDEX IF EXISTS idx_sla_policy_targets_unique_policy_priority;
        DROP INDEX IF EXISTS idx_boards_sla_policy;
        DROP INDEX IF EXISTS idx_clients_sla_policy;
        DROP INDEX IF EXISTS idx_status_sla_pause_config_status;
        DROP INDEX IF EXISTS idx_status_sla_pause_config_tenant;
        DROP INDEX IF EXISTS idx_sla_policy_targets_priority;
        DROP INDEX IF EXISTS idx_sla_policy_targets_policy;
        DROP INDEX IF EXISTS idx_sla_policy_targets_tenant;
        DROP INDEX IF EXISTS idx_sla_policies_is_default;
        DROP INDEX IF EXISTS idx_sla_policies_tenant;
    `);

    // Remove foreign key constraint from boards
    await knex.raw(`
        ALTER TABLE boards
        DROP CONSTRAINT IF EXISTS boards_sla_policy_fkey
    `);

    // Remove sla_policy_id column from boards
    if (await knex.schema.hasColumn('boards', 'sla_policy_id')) {
        await knex.schema.alterTable('boards', (table) => {
            table.dropColumn('sla_policy_id');
        });
    }

    // Remove foreign key constraint from clients
    await knex.raw(`
        ALTER TABLE clients
        DROP CONSTRAINT IF EXISTS clients_sla_policy_fkey
    `);

    // Remove sla_policy_id column from clients
    if (await knex.schema.hasColumn('clients', 'sla_policy_id')) {
        await knex.schema.alterTable('clients', (table) => {
            table.dropColumn('sla_policy_id');
        });
    }

    // Drop tables in reverse order of creation (respecting foreign key dependencies)
    await knex.schema.dropTableIfExists('status_sla_pause_config');
    await knex.schema.dropTableIfExists('sla_settings');
    await knex.schema.dropTableIfExists('sla_policy_targets');
    await knex.schema.dropTableIfExists('sla_policies');
};

// Citus requires ALTER TABLE with foreign key constraints to run outside a transaction block
exports.config = { transaction: false };
