/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {

    // Create asset relationships table
    await knex.schema
        .createTable('asset_relationships', table => {
            table.uuid('tenant').notNullable();
            table.uuid('parent_asset_id').notNullable();
            table.uuid('child_asset_id').notNullable();
            table.string('relationship_type').notNullable();
            table.timestamp('created_at').defaultTo(knex.raw('CURRENT_TIMESTAMP'));
            table.timestamp('updated_at').defaultTo(knex.raw('CURRENT_TIMESTAMP'));
            table.primary(['tenant', 'parent_asset_id', 'child_asset_id']);
            
            // Foreign keys
            table.foreign(['tenant', 'parent_asset_id']).references(['tenant', 'asset_id']).inTable('assets').onDelete('CASCADE');
            table.foreign(['tenant', 'child_asset_id']).references(['tenant', 'asset_id']).inTable('assets').onDelete('CASCADE');
            
            // Indexes
            table.index(['tenant', 'parent_asset_id']);
            table.index(['tenant', 'child_asset_id']);
            table.index(['tenant', 'relationship_type']);
        });

    // Add RLS policy
    await knex.raw(`
        ALTER TABLE asset_relationships ENABLE ROW LEVEL SECURITY;
        
        CREATE POLICY tenant_isolation_policy ON asset_relationships
            USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);
    `);

};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
    // Save relationships back to JSON before dropping table
    await knex.raw(`
        UPDATE assets a
        SET attributes = jsonb_set(
            COALESCE(attributes, '{}'::jsonb),
            '{child_assets}',
            (
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'asset_id', r.child_asset_id,
                        'relationship_type', r.relationship_type
                    )
                )
                FROM asset_relationships r
                WHERE r.parent_asset_id = a.asset_id AND r.tenant = a.tenant
            )
        )
        WHERE EXISTS (
            SELECT 1 
            FROM asset_relationships r 
            WHERE r.parent_asset_id = a.asset_id AND r.tenant = a.tenant
        );
    `);

    // Drop table
    await knex.schema.dropTableIfExists('asset_relationships');
};
