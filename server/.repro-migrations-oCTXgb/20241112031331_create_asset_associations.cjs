exports.up = function(knex) {
    return knex.schema
        .createTable('asset_associations', table => {
            table.uuid('tenant').notNullable().references('tenant').inTable('tenants');
            table.uuid('asset_id').notNullable();
            table.uuid('entity_id').notNullable(); // Can be ticket_id, project_id, etc.
            table.string('entity_type').notNullable(); // 'ticket', 'project', etc.
            table.string('relationship_type').notNullable().defaultTo('affected'); // affected, related, etc.
            table.timestamp('created_at').defaultTo(knex.fn.now());
            table.uuid('created_by').notNullable();
            table.text('notes');

            // Primary key
            table.primary(['tenant', 'asset_id', 'entity_id', 'entity_type']);

            // Foreign key to assets using composite key
            table.foreign(['tenant', 'asset_id'])
                .references(['tenant', 'asset_id'])
                .inTable('assets')
                .onDelete('CASCADE');

            // Foreign key to users using composite key
            table.foreign(['tenant', 'created_by'])
                .references(['tenant', 'user_id'])
                .inTable('users');
        })
        .raw(`
            -- Enable RLS
            ALTER TABLE asset_associations ENABLE ROW LEVEL SECURITY;
            
            CREATE POLICY tenant_isolation_policy ON asset_associations
                USING (tenant = current_setting('app.current_tenant')::uuid);
                
            CREATE POLICY tenant_isolation_insert_policy ON asset_associations
                FOR INSERT WITH CHECK (tenant = current_setting('app.current_tenant')::uuid);
        `);
};

exports.down = function(knex) {
    return knex.schema
        .raw(`
            DROP POLICY IF EXISTS tenant_isolation_policy ON asset_associations;
            DROP POLICY IF EXISTS tenant_isolation_insert_policy ON asset_associations;
        `)
        .dropTableIfExists('asset_associations');
};
