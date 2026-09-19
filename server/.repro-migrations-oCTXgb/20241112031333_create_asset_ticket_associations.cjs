// ⚠️ `asset_ticket_associations` is effectively an ORPHAN table — nothing in the
// UI or server actions reads it. Asset↔ticket links actually live in
// `asset_associations` (entity_type='ticket', entity_id=ticket_id), created in
// 20241112031331_create_asset_associations.cjs. Use `asset_associations` for any
// new asset/ticket linkage. (`asset_service_history`, also created here, IS used.)
exports.up = async function(knex) {
    await knex.schema.createTable('asset_ticket_associations', function(table) {
        table.uuid('tenant').notNullable();
        table.uuid('association_id').defaultTo(knex.raw('gen_random_uuid()')).primary();
        table.uuid('asset_id').notNullable();
        table.uuid('ticket_id').notNullable();
        table.enum('association_type', ['primary', 'affected', 'related']).notNullable();
        table.text('notes');
        table.timestamp('created_at').defaultTo(knex.raw('CURRENT_TIMESTAMP'));
        table.uuid('created_by').notNullable();
        
        // Foreign keys
        table.foreign(['tenant', 'asset_id']).references(['tenant', 'asset_id']).inTable('assets').onDelete('CASCADE');
        table.foreign(['tenant', 'ticket_id']).references(['tenant', 'ticket_id']).inTable('tickets').onDelete('CASCADE');
        table.foreign(['tenant', 'created_by']).references(['tenant', 'user_id']).inTable('users');
        
        // Unique constraint to prevent duplicate associations
        table.unique(['tenant', 'asset_id', 'ticket_id']);

        // Index for performance
        table.index(['tenant', 'ticket_id']);
        table.index(['tenant', 'asset_id']);
    });

    // Add RLS policy
    await knex.raw(`
        ALTER TABLE asset_ticket_associations ENABLE ROW LEVEL SECURITY;
        
        CREATE POLICY tenant_isolation_policy ON asset_ticket_associations
            USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);
    `);

    // Create service history table for tracking maintenance and service records
    await knex.schema.createTable('asset_service_history', function(table) {
        table.uuid('tenant').notNullable();
        table.uuid('history_id').defaultTo(knex.raw('gen_random_uuid()')).primary();
        table.uuid('asset_id').notNullable();
        table.uuid('ticket_id').notNullable();
        table.enum('service_type', ['maintenance', 'repair', 'upgrade', 'inspection']).notNullable();
        table.text('description').notNullable();
        table.jsonb('service_details'); // For storing service-specific data
        table.timestamp('service_date').notNullable();
        table.timestamp('next_service_date');
        table.uuid('performed_by').notNullable();
        table.timestamp('created_at').defaultTo(knex.raw('CURRENT_TIMESTAMP'));
        
        // Foreign keys
        table.foreign(['tenant', 'asset_id']).references(['tenant', 'asset_id']).inTable('assets').onDelete('CASCADE');
        table.foreign(['tenant', 'ticket_id']).references(['tenant', 'ticket_id']).inTable('tickets').onDelete('CASCADE');
        table.foreign(['tenant', 'performed_by']).references(['tenant', 'user_id']).inTable('users');
        
        // Indexes for performance
        table.index(['tenant', 'asset_id']);
        table.index(['tenant', 'service_date']);
        table.index(['tenant', 'next_service_date']);
    });

    // Add RLS policy
    await knex.raw(`
        ALTER TABLE asset_service_history ENABLE ROW LEVEL SECURITY;
        
        CREATE POLICY tenant_isolation_policy ON asset_service_history
            USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);
    `);
};

exports.down = async function(knex) {
    await knex.schema.dropTableIfExists('asset_service_history');
    await knex.schema.dropTableIfExists('asset_ticket_associations');
};
