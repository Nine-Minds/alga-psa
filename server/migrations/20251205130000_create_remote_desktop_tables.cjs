/**
 * Migration: Create Remote Desktop Support Tables
 *
 * This migration creates the foundational tables for WebRTC-based remote desktop support:
 * - rd_agents: Stores information about remote desktop agents installed on client machines
 * - rd_sessions: Tracks remote desktop sessions between engineers and agents
 * - rd_session_events: Audit log for session events
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
    // Create rd_agents table
    await knex.schema.createTable('rd_agents', table => {
        table.uuid('tenant').notNullable().references('tenant').inTable('tenants').onDelete('CASCADE');
        table.uuid('agent_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.text('agent_name').notNullable(); // User-friendly name
        table.text('hostname').notNullable();
        table.text('os_type').notNullable(); // 'windows', 'macos'
        table.text('os_version').nullable();
        table.uuid('company_id').nullable(); // Associated client company
        table.text('agent_version').notNullable();
        table.text('status').notNullable().defaultTo('offline'); // 'online', 'offline', 'suspended'
        table.timestamp('last_seen_at', { useTz: true }).nullable();
        table.timestamp('registered_at', { useTz: true }).defaultTo(knex.fn.now());
        table.jsonb('metadata').defaultTo('{}'); // IP address, system info, etc.
        table.text('connection_token').nullable(); // Secure token for agent auth
        table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

        table.primary(['tenant', 'agent_id']);
        table.foreign(['tenant', 'company_id']).references(['tenant', 'company_id']).inTable('companies').onDelete('SET NULL');
        table.index(['tenant', 'status'], 'idx_rd_agents_tenant_status');
        table.index(['tenant', 'company_id'], 'idx_rd_agents_tenant_company');
        table.unique(['tenant', 'connection_token'], { indexName: 'idx_rd_agents_connection_token' });
    });

    // Create rd_sessions table
    await knex.schema.createTable('rd_sessions', table => {
        table.uuid('tenant').notNullable();
        table.uuid('session_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.uuid('agent_id').notNullable();
        table.uuid('engineer_user_id').notNullable(); // User initiating the session
        table.text('status').notNullable().defaultTo('pending');
        // Status: 'pending', 'active', 'ended', 'denied', 'failed'
        table.timestamp('requested_at', { useTz: true }).defaultTo(knex.fn.now());
        table.timestamp('started_at', { useTz: true }).nullable();
        table.timestamp('ended_at', { useTz: true }).nullable();
        table.text('end_reason').nullable(); // 'user_disconnect', 'timeout', 'error', 'agent_offline', 'user_denied'
        table.jsonb('connection_metadata').defaultTo('{}'); // ICE candidates, connection quality
        table.integer('duration_seconds').nullable(); // Calculated on end
        table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

        table.primary(['tenant', 'session_id']);
        table.foreign('tenant').references('tenant').inTable('tenants').onDelete('CASCADE');
        table.foreign(['tenant', 'agent_id']).references(['tenant', 'agent_id']).inTable('rd_agents').onDelete('CASCADE');
        table.foreign(['tenant', 'engineer_user_id']).references(['tenant', 'user_id']).inTable('users').onDelete('CASCADE');
        table.index(['tenant', 'status'], 'idx_rd_sessions_tenant_status');
        table.index(['tenant', 'agent_id'], 'idx_rd_sessions_tenant_agent');
        table.index(['tenant', 'engineer_user_id'], 'idx_rd_sessions_tenant_engineer');
        table.index(['tenant', 'requested_at'], 'idx_rd_sessions_tenant_requested');
    });

    // Create rd_session_events table (for audit trail)
    await knex.schema.createTable('rd_session_events', table => {
        table.uuid('tenant').notNullable();
        table.uuid('event_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.uuid('session_id').notNullable();
        table.text('event_type').notNullable();
        // Event types: 'session_requested', 'session_accepted', 'session_denied',
        // 'connection_established', 'connection_lost', 'input_started', 'input_stopped',
        // 'screenshot_taken', 'session_ended'
        table.jsonb('event_data').defaultTo('{}');
        table.timestamp('timestamp', { useTz: true }).defaultTo(knex.fn.now());

        table.primary(['tenant', 'event_id']);
        table.foreign('tenant').references('tenant').inTable('tenants').onDelete('CASCADE');
        table.foreign(['tenant', 'session_id']).references(['tenant', 'session_id']).inTable('rd_sessions').onDelete('CASCADE');
        table.index(['tenant', 'session_id', 'timestamp'], 'idx_rd_session_events_session_timestamp');
        table.index(['tenant', 'event_type'], 'idx_rd_session_events_type');
    });

    // Create updated_at triggers
    await knex.raw(`
        CREATE TRIGGER set_timestamp_rd_agents
        BEFORE UPDATE ON rd_agents
        FOR EACH ROW
        EXECUTE PROCEDURE on_update_timestamp();

        CREATE TRIGGER set_timestamp_rd_sessions
        BEFORE UPDATE ON rd_sessions
        FOR EACH ROW
        EXECUTE PROCEDURE on_update_timestamp();
    `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
    // Drop triggers
    await knex.raw(`
        DROP TRIGGER IF EXISTS set_timestamp_rd_sessions ON rd_sessions;
        DROP TRIGGER IF EXISTS set_timestamp_rd_agents ON rd_agents;
    `);

    // Drop tables in reverse order of creation
    await knex.schema
        .dropTableIfExists('rd_session_events')
        .dropTableIfExists('rd_sessions')
        .dropTableIfExists('rd_agents');
};
