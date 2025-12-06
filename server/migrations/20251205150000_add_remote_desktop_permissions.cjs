/**
 * Migration: Add Remote Desktop Permissions and Audit Logs
 *
 * This migration creates:
 * - rd_permissions: Role/user-based access control for remote desktop
 * - rd_audit_logs: Compliance-ready audit trail for all remote desktop actions
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
    // Create rd_permissions table
    await knex.schema.createTable('rd_permissions', table => {
        table.uuid('tenant').notNullable().references('tenant').inTable('tenants').onDelete('CASCADE');
        table.uuid('permission_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();

        // Permission can be for a user or a role (but not both)
        table.uuid('user_id').nullable();
        table.uuid('role_id').nullable();

        // Permission type: view (watch only), control (input), admin (manage agents)
        table.text('permission_type').notNullable();

        // Resource scope: 'all', 'company', 'device', 'device_group'
        table.text('resource_type').notNullable().defaultTo('all');
        // Optional: specific resource ID based on type
        table.uuid('resource_id').nullable();

        // Metadata
        table.uuid('created_by').notNullable();
        table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

        // Optional expiration
        table.timestamp('expires_at', { useTz: true }).nullable();

        // Active/disabled flag
        table.boolean('is_active').notNullable().defaultTo(true);

        // Constraints
        table.primary(['tenant', 'permission_id']);
        table.foreign(['tenant', 'user_id']).references(['tenant', 'user_id']).inTable('users').onDelete('CASCADE');
        table.foreign(['tenant', 'role_id']).references(['tenant', 'role_id']).inTable('roles').onDelete('CASCADE');
        table.foreign(['tenant', 'created_by']).references(['tenant', 'user_id']).inTable('users').onDelete('CASCADE');

        // Indexes
        table.index(['tenant', 'user_id'], 'idx_rd_permissions_user');
        table.index(['tenant', 'role_id'], 'idx_rd_permissions_role');
        table.index(['tenant', 'resource_type', 'resource_id'], 'idx_rd_permissions_resource');
        table.index(['tenant', 'is_active', 'expires_at'], 'idx_rd_permissions_active');

        // Check constraint: must have either user_id or role_id (XOR)
        table.check('(?? IS NOT NULL AND ?? IS NULL) OR (?? IS NULL AND ?? IS NOT NULL)',
            ['user_id', 'role_id', 'user_id', 'role_id']);

        // Check constraint: valid permission types
        table.check("?? IN ('view', 'control', 'admin')", ['permission_type']);

        // Check constraint: valid resource types
        table.check("?? IN ('all', 'company', 'device', 'device_group')", ['resource_type']);
    });

    // Create rd_audit_logs table
    await knex.schema.createTable('rd_audit_logs', table => {
        table.uuid('tenant').notNullable().references('tenant').inTable('tenants').onDelete('CASCADE');
        table.uuid('log_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();

        // Session reference
        table.uuid('session_id').notNullable();

        // Actor (who performed the action)
        table.uuid('user_id').notNullable();

        // Target device
        table.uuid('agent_id').notNullable();

        // Event type
        table.text('event_type').notNullable();

        // Event data (JSON with event-specific details)
        table.jsonb('event_data').nullable();

        // Network info
        table.specificType('ip_address', 'inet').nullable();
        table.text('user_agent').nullable();

        // Timestamp (with high precision for ordering)
        table.timestamp('timestamp', { useTz: true, precision: 6 }).notNullable().defaultTo(knex.fn.now());

        // Constraints
        table.primary(['tenant', 'log_id']);
        table.foreign(['tenant', 'session_id']).references(['tenant', 'session_id']).inTable('rd_sessions').onDelete('CASCADE');
        table.foreign(['tenant', 'user_id']).references(['tenant', 'user_id']).inTable('users').onDelete('CASCADE');
        table.foreign(['tenant', 'agent_id']).references(['tenant', 'agent_id']).inTable('rd_agents').onDelete('CASCADE');

        // Indexes for efficient querying
        table.index(['tenant', 'timestamp'], 'idx_rd_audit_logs_timestamp');
        table.index(['tenant', 'session_id'], 'idx_rd_audit_logs_session');
        table.index(['tenant', 'user_id'], 'idx_rd_audit_logs_user');
        table.index(['tenant', 'agent_id'], 'idx_rd_audit_logs_agent');
        table.index(['tenant', 'event_type'], 'idx_rd_audit_logs_event_type');

        // Check constraint: valid event types
        table.check("?? IN ('session_start', 'session_end', 'session_pause', 'session_resume', " +
            "'input_mouse', 'input_keyboard', 'input_special_key', " +
            "'file_upload_start', 'file_upload_complete', 'file_upload_failed', " +
            "'file_download_start', 'file_download_complete', 'file_download_failed', " +
            "'clipboard_copy', 'clipboard_paste', " +
            "'permission_granted', 'permission_denied', 'permission_revoked', " +
            "'desktop_switch', 'monitor_change', " +
            "'error', 'warning')", ['event_type']);
    });

    // Add trigger for updating updated_at on rd_permissions
    await knex.raw(`
        CREATE OR REPLACE FUNCTION set_timestamp_rd_permissions()
        RETURNS TRIGGER AS $$
        BEGIN
            NEW.updated_at = NOW();
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        CREATE TRIGGER set_timestamp_rd_permissions
        BEFORE UPDATE ON rd_permissions
        FOR EACH ROW
        EXECUTE FUNCTION set_timestamp_rd_permissions();
    `);

    // Create partial index for active permissions
    await knex.raw(`
        CREATE INDEX idx_rd_permissions_active_users ON rd_permissions (tenant, user_id)
        WHERE is_active = true AND (expires_at IS NULL OR expires_at > NOW());
    `);

    // Create partial index for active permissions by role
    await knex.raw(`
        CREATE INDEX idx_rd_permissions_active_roles ON rd_permissions (tenant, role_id)
        WHERE is_active = true AND (expires_at IS NULL OR expires_at > NOW());
    `);

    // Add comment for documentation
    await knex.raw(`
        COMMENT ON TABLE rd_permissions IS 'Remote Desktop access permissions for users and roles';
        COMMENT ON TABLE rd_audit_logs IS 'Compliance audit trail for remote desktop sessions and actions';
        COMMENT ON COLUMN rd_permissions.permission_type IS 'view: watch only, control: input allowed, admin: manage agents';
        COMMENT ON COLUMN rd_permissions.resource_type IS 'Scope of permission: all, company, device, device_group';
        COMMENT ON COLUMN rd_audit_logs.event_data IS 'JSON object with event-specific data (e.g., file name, key pressed)';
    `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
    // Drop trigger and function
    await knex.raw(`
        DROP TRIGGER IF EXISTS set_timestamp_rd_permissions ON rd_permissions;
        DROP FUNCTION IF EXISTS set_timestamp_rd_permissions();
    `);

    // Drop partial indexes
    await knex.raw(`
        DROP INDEX IF EXISTS idx_rd_permissions_active_users;
        DROP INDEX IF EXISTS idx_rd_permissions_active_roles;
    `);

    // Drop tables
    await knex.schema.dropTableIfExists('rd_audit_logs');
    await knex.schema.dropTableIfExists('rd_permissions');
};
