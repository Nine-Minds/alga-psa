/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
    return knex.schema
        .createTable('asset_types', table => {
            table.uuid('tenant').notNullable().references('tenant').inTable('tenants');
            table.uuid('type_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
            table.text('type_name').notNullable();
            table.uuid('parent_type_id');
            table.jsonb('attributes_schema');
            table.timestamp('created_at').defaultTo(knex.raw('CURRENT_TIMESTAMP'));
            table.timestamp('updated_at').defaultTo(knex.raw('CURRENT_TIMESTAMP'));
            
            table.primary(['tenant', 'type_id']);
            table.foreign(['tenant', 'parent_type_id']).references(['tenant', 'type_id']).inTable('asset_types');
        })
        .createTable('assets', table => {
            table.uuid('tenant').notNullable().references('tenant').inTable('tenants');
            table.uuid('asset_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
            table.uuid('type_id').notNullable();
            table.uuid('company_id').notNullable();
            table.text('asset_tag').notNullable();
            table.text('serial_number');
            table.text('name').notNullable();
            table.text('status').notNullable();
            table.text('location');
            table.timestamp('purchase_date');
            table.timestamp('warranty_end_date');
            table.jsonb('attributes');
            table.timestamp('created_at').defaultTo(knex.raw('CURRENT_TIMESTAMP'));
            table.timestamp('updated_at').defaultTo(knex.raw('CURRENT_TIMESTAMP'));
            
            table.primary(['tenant', 'asset_id']);
            table.foreign(['tenant', 'type_id']).references(['tenant', 'type_id']).inTable('asset_types');
            table.foreign(['tenant', 'company_id']).references(['tenant', 'company_id']).inTable('companies');
        })
        .createTable('asset_history', table => {
            table.uuid('tenant').notNullable().references('tenant').inTable('tenants');
            table.uuid('history_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
            table.uuid('asset_id').notNullable();
            table.uuid('changed_by').notNullable();
            table.text('change_type').notNullable();
            table.jsonb('changes').notNullable();
            table.timestamp('changed_at').defaultTo(knex.raw('CURRENT_TIMESTAMP'));
            
            table.primary(['tenant', 'history_id']);
            table.foreign(['tenant', 'asset_id']).references(['tenant', 'asset_id']).inTable('assets');
            table.foreign(['tenant', 'changed_by']).references(['tenant', 'user_id']).inTable('users');
        })
        .raw(`
            -- Enable RLS for asset_types
            ALTER TABLE asset_types ENABLE ROW LEVEL SECURITY;
            
            CREATE POLICY tenant_isolation_policy ON asset_types
                USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);
                
            CREATE POLICY tenant_isolation_insert_policy ON asset_types
                FOR INSERT WITH CHECK (tenant::TEXT = current_setting('app.current_tenant')::TEXT);
            
            -- Enable RLS for assets
            ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
            
            CREATE POLICY tenant_isolation_policy ON assets
                USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);
                
            CREATE POLICY tenant_isolation_insert_policy ON assets
                FOR INSERT WITH CHECK (tenant::TEXT = current_setting('app.current_tenant')::TEXT);
            
            -- Enable RLS for asset_history
            ALTER TABLE asset_history ENABLE ROW LEVEL SECURITY;
            
            CREATE POLICY tenant_isolation_policy ON asset_history
                USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);
                
            CREATE POLICY tenant_isolation_insert_policy ON asset_history
                FOR INSERT WITH CHECK (tenant::TEXT = current_setting('app.current_tenant')::TEXT);
        `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
    return knex.schema
        .raw(`
            DROP POLICY IF EXISTS tenant_isolation_policy ON asset_history;
            DROP POLICY IF EXISTS tenant_isolation_insert_policy ON asset_history;
            DROP POLICY IF EXISTS tenant_isolation_policy ON assets;
            DROP POLICY IF EXISTS tenant_isolation_insert_policy ON assets;
            DROP POLICY IF EXISTS tenant_isolation_policy ON asset_types;
            DROP POLICY IF EXISTS tenant_isolation_insert_policy ON asset_types;
        `)
        .dropTableIfExists('asset_history')
        .dropTableIfExists('assets')
        .dropTableIfExists('asset_types');
};
