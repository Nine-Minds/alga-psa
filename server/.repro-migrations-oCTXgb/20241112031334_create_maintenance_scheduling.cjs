exports.up = async function(knex) {
    // Create maintenance schedules table
    await knex.schema.createTable('asset_maintenance_schedules', function(table) {
        table.uuid('tenant').notNullable();
        table.uuid('schedule_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.uuid('asset_id').notNullable();
        table.string('schedule_name').notNullable();
        table.text('description');
        table.enum('maintenance_type', ['preventive', 'inspection', 'calibration', 'replacement']).notNullable();
        table.enum('frequency', ['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'custom']).notNullable();
        table.integer('frequency_interval').notNullable(); // For custom frequencies (e.g., every 45 days)
        table.jsonb('schedule_config').notNullable(); // Flexible configuration for different schedule types
        table.timestamp('last_maintenance');
        table.timestamp('next_maintenance').notNullable();
        table.boolean('is_active').defaultTo(true);
        table.uuid('created_by').notNullable();
        table.timestamp('created_at').defaultTo(knex.raw('CURRENT_TIMESTAMP'));
        table.timestamp('updated_at').defaultTo(knex.raw('CURRENT_TIMESTAMP'));

        // Primary key
        table.primary(['tenant', 'schedule_id']);

        // Foreign keys
        table.foreign(['tenant', 'asset_id']).references(['tenant', 'asset_id']).inTable('assets').onDelete('CASCADE');
        table.foreign(['tenant', 'created_by']).references(['tenant', 'user_id']).inTable('users');

        // Indexes
        table.index(['tenant', 'asset_id']);
        table.index(['tenant', 'next_maintenance']);
        table.index(['tenant', 'maintenance_type']);
    });

    // Create maintenance notifications table
    await knex.schema.createTable('asset_maintenance_notifications', function(table) {
        table.uuid('tenant').notNullable();
        table.uuid('notification_id').defaultTo(knex.raw('gen_random_uuid()')).primary();
        table.uuid('schedule_id').notNullable();
        table.uuid('asset_id').notNullable();
        table.enum('notification_type', ['upcoming', 'due', 'overdue']).notNullable();
        table.timestamp('notification_date').notNullable();
        table.boolean('is_sent').defaultTo(false);
        table.timestamp('sent_at');
        table.jsonb('notification_data').notNullable(); // Flexible data structure for different notification types
        table.timestamp('created_at').defaultTo(knex.raw('CURRENT_TIMESTAMP'));

        // Foreign keys
        table.foreign(['tenant', 'schedule_id']).references(['tenant', 'schedule_id']).inTable('asset_maintenance_schedules').onDelete('CASCADE');
        table.foreign(['tenant', 'asset_id']).references(['tenant', 'asset_id']).inTable('assets').onDelete('CASCADE');

        // Indexes
        table.index(['tenant', 'notification_date']);
        table.index(['tenant', 'is_sent']);
    });

    // Create maintenance history table
    await knex.schema.createTable('asset_maintenance_history', function(table) {
        table.uuid('tenant').notNullable();
        table.uuid('history_id').defaultTo(knex.raw('gen_random_uuid()')).primary();
        table.uuid('schedule_id').notNullable();
        table.uuid('asset_id').notNullable();
        table.enum('maintenance_type', ['preventive', 'inspection', 'calibration', 'replacement']).notNullable();
        table.text('description').notNullable();
        table.jsonb('maintenance_data').notNullable(); // Detailed maintenance information
        table.timestamp('performed_at').notNullable();
        table.uuid('performed_by').notNullable();
        table.timestamp('created_at').defaultTo(knex.raw('CURRENT_TIMESTAMP'));

        // Foreign keys
        table.foreign(['tenant', 'schedule_id']).references(['tenant', 'schedule_id']).inTable('asset_maintenance_schedules').onDelete('CASCADE');
        table.foreign(['tenant', 'asset_id']).references(['tenant', 'asset_id']).inTable('assets').onDelete('CASCADE');
        table.foreign(['tenant', 'performed_by']).references(['tenant', 'user_id']).inTable('users');

        // Indexes
        table.index(['tenant', 'asset_id']);
        table.index(['tenant', 'performed_at']);
    });

    // Add RLS policies
    await knex.raw(`
        ALTER TABLE asset_maintenance_schedules ENABLE ROW LEVEL SECURITY;
        ALTER TABLE asset_maintenance_notifications ENABLE ROW LEVEL SECURITY;
        ALTER TABLE asset_maintenance_history ENABLE ROW LEVEL SECURITY;
        
        CREATE POLICY tenant_isolation_policy ON asset_maintenance_schedules
            USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);
        
        CREATE POLICY tenant_isolation_policy ON asset_maintenance_notifications
            USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);
        
        CREATE POLICY tenant_isolation_policy ON asset_maintenance_history
            USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);
    `);
};

exports.down = async function(knex) {
    await knex.schema.dropTableIfExists('asset_maintenance_history');
    await knex.schema.dropTableIfExists('asset_maintenance_notifications');
    await knex.schema.dropTableIfExists('asset_maintenance_schedules');
};
