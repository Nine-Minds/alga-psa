/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
    // First drop the foreign key constraint from assets table
    await knex.schema.table('assets', table => {
        table.dropForeign(['tenant', 'type_id']);
    });

    // Add a new column for the type
    await knex.schema.table('assets', table => {
        table.text('asset_type').notNullable().defaultTo('unknown');
    });

    // Migrate the data based on extension table existence
    await knex.raw(`
        UPDATE assets
        SET asset_type = CASE 
            WHEN EXISTS (
                SELECT 1 FROM workstation_assets wa 
                WHERE wa.tenant = assets.tenant AND wa.asset_id = assets.asset_id
            ) THEN 'workstation'
            WHEN EXISTS (
                SELECT 1 FROM network_device_assets na 
                WHERE na.tenant = assets.tenant AND na.asset_id = assets.asset_id
            ) THEN 'network_device'
            WHEN EXISTS (
                SELECT 1 FROM server_assets sa 
                WHERE sa.tenant = assets.tenant AND sa.asset_id = assets.asset_id
            ) THEN 'server'
            WHEN EXISTS (
                SELECT 1 FROM mobile_device_assets ma 
                WHERE ma.tenant = assets.tenant AND ma.asset_id = assets.asset_id
            ) THEN 'mobile_device'
            WHEN EXISTS (
                SELECT 1 FROM printer_assets pa 
                WHERE pa.tenant = assets.tenant AND pa.asset_id = assets.asset_id
            ) THEN 'printer'
            ELSE 'unknown'
        END
    `);

    // Add a check constraint to ensure only valid types are used
    await knex.raw(`
        ALTER TABLE assets
        ADD CONSTRAINT valid_asset_type CHECK (
            asset_type IN ('workstation', 'network_device', 'server', 'mobile_device', 'printer', 'unknown')
        );
    `);

    // Drop the type_id column
    await knex.schema.table('assets', table => {
        table.dropColumn('type_id');
    });

    // Finally drop the asset_types table
    await knex.schema.dropTable('asset_types');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
    // Recreate the asset_types table
    await knex.schema.createTable('asset_types', table => {
        table.uuid('tenant').notNullable().references('tenant').inTable('tenants');
        table.uuid('type_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.text('type_name').notNullable();
        table.uuid('parent_type_id');
        table.jsonb('attributes_schema');
        table.timestamp('created_at').defaultTo(knex.raw('CURRENT_TIMESTAMP'));
        table.timestamp('updated_at').defaultTo(knex.raw('CURRENT_TIMESTAMP'));
        
        table.primary(['tenant', 'type_id']);
        table.foreign(['tenant', 'parent_type_id']).references(['tenant', 'type_id']).inTable('asset_types');
    });

    // Add RLS policies back
    await knex.raw(`
        ALTER TABLE asset_types ENABLE ROW LEVEL SECURITY;
        
        CREATE POLICY tenant_isolation_policy ON asset_types
            USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);
            
        CREATE POLICY tenant_isolation_insert_policy ON asset_types
            FOR INSERT WITH CHECK (tenant::TEXT = current_setting('app.current_tenant')::TEXT);
    `);

    // Add type_id column back to assets
    await knex.schema.table('assets', table => {
        table.uuid('type_id');
    });

    // Create default types and migrate data back
    await knex('asset_types').insert([
        {
            tenant: knex.raw('current_setting(\'app.current_tenant\')::uuid'),
            type_name: 'workstation'
        },
        {
            tenant: knex.raw('current_setting(\'app.current_tenant\')::uuid'),
            type_name: 'network_device'
        },
        {
            tenant: knex.raw('current_setting(\'app.current_tenant\')::uuid'),
            type_name: 'server'
        },
        {
            tenant: knex.raw('current_setting(\'app.current_tenant\')::uuid'),
            type_name: 'mobile_device'
        },
        {
            tenant: knex.raw('current_setting(\'app.current_tenant\')::uuid'),
            type_name: 'printer'
        }
    ]);

    // Update type_id based on asset_type
    await knex.raw(`
        UPDATE assets a
        SET type_id = t.type_id
        FROM asset_types t
        WHERE t.tenant = a.tenant
        AND t.type_name = a.asset_type
    `);

    // Make type_id not nullable and add foreign key constraint
    await knex.schema.table('assets', table => {
        table.uuid('type_id').notNullable().alter();
        table.foreign(['tenant', 'type_id']).references(['tenant', 'type_id']).inTable('asset_types');
    });

    // Drop the asset_type column
    await knex.schema.table('assets', table => {
        table.dropColumn('asset_type');
    });
};
