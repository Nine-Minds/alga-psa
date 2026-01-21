/**
 * Migration: Create Ticket Activity Log
 *
 * Creates the ticket_activity_log table for tracking all ticket events
 * in a chronological timeline (Halo-style activity feed)
 *
 * Tracks:
 * - Status changes, assignments, priority changes
 * - Field changes (standard and custom)
 * - Comments, emails, documents
 * - Bundle operations, time entries
 *
 * Citus requires DDL outside of transactions for distributed tables
 */
exports.config = { transaction: false };

const { distributeTableIfNeeded } = require('./_utils.cjs');

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
    // =================================================================
    // Create ticket_activity_log table
    // =================================================================

    await knex.schema.raw(`
        CREATE TABLE IF NOT EXISTS ticket_activity_log (
            activity_id UUID NOT NULL DEFAULT gen_random_uuid(),
            tenant UUID NOT NULL REFERENCES tenants(tenant),
            ticket_id UUID NOT NULL,
            -- Activity type classification
            activity_type VARCHAR(50) NOT NULL,
            -- Actor information
            actor_id UUID DEFAULT NULL,
            actor_type VARCHAR(20) DEFAULT 'internal'
                CHECK (actor_type IN ('internal', 'client', 'system', 'email', 'automation')),
            actor_name VARCHAR(255) DEFAULT NULL,
            -- Change details for field changes
            field_name VARCHAR(100) DEFAULT NULL,
            old_value JSONB DEFAULT NULL,
            new_value JSONB DEFAULT NULL,
            -- Related entity references
            comment_id UUID DEFAULT NULL,
            email_id UUID DEFAULT NULL,
            document_id UUID DEFAULT NULL,
            time_entry_id UUID DEFAULT NULL,
            linked_entity_type VARCHAR(50) DEFAULT NULL,
            linked_entity_id UUID DEFAULT NULL,
            -- Additional metadata
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            -- Description for display (optional override)
            description TEXT DEFAULT NULL,
            -- Visibility flags
            is_internal BOOLEAN NOT NULL DEFAULT false,
            is_system BOOLEAN NOT NULL DEFAULT false,
            -- Timestamps
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            -- Citus-compatible composite primary key
            PRIMARY KEY (activity_id, tenant)
        )
    `);
    console.log('✓ Created ticket_activity_log table with composite PK (activity_id, tenant)');

    // =================================================================
    // Create indexes for efficient lookups
    // =================================================================

    // Main lookup: all activities for a ticket, newest first
    await knex.schema.raw(`
        CREATE INDEX IF NOT EXISTS idx_ticket_activity_ticket
        ON ticket_activity_log(tenant, ticket_id, created_at DESC)
    `);

    // Filter by activity type
    await knex.schema.raw(`
        CREATE INDEX IF NOT EXISTS idx_ticket_activity_type
        ON ticket_activity_log(tenant, ticket_id, activity_type, created_at DESC)
    `);

    // Filter by actor
    await knex.schema.raw(`
        CREATE INDEX IF NOT EXISTS idx_ticket_activity_actor
        ON ticket_activity_log(tenant, actor_id, created_at DESC)
        WHERE actor_id IS NOT NULL
    `);

    // Recent activity across all tickets (for dashboard)
    await knex.schema.raw(`
        CREATE INDEX IF NOT EXISTS idx_ticket_activity_recent
        ON ticket_activity_log(tenant, created_at DESC)
    `);

    // Non-internal activities (client-visible)
    await knex.schema.raw(`
        CREATE INDEX IF NOT EXISTS idx_ticket_activity_public
        ON ticket_activity_log(tenant, ticket_id, created_at DESC)
        WHERE is_internal = false
    `);

    console.log('✓ Created indexes for ticket_activity_log');

    // =================================================================
    // Distribute table if Citus is available
    // =================================================================

    await distributeTableIfNeeded(knex, 'ticket_activity_log');

    console.log('✓ Completed ticket_activity_log migration');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
    // Drop indexes
    await knex.schema.raw(`DROP INDEX IF EXISTS idx_ticket_activity_public`);
    await knex.schema.raw(`DROP INDEX IF EXISTS idx_ticket_activity_recent`);
    await knex.schema.raw(`DROP INDEX IF EXISTS idx_ticket_activity_actor`);
    await knex.schema.raw(`DROP INDEX IF EXISTS idx_ticket_activity_type`);
    await knex.schema.raw(`DROP INDEX IF EXISTS idx_ticket_activity_ticket`);

    // Drop table
    await knex.schema.raw(`DROP TABLE IF EXISTS ticket_activity_log`);

    console.log('✓ Dropped ticket_activity_log table and indexes');
};
