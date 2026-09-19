exports.up = async function(knex) {
    await knex.schema.createTable('asset_document_associations', function(table) {
        table.uuid('tenant').notNullable();
        table.uuid('association_id').defaultTo(knex.raw('gen_random_uuid()')).primary();
        table.uuid('asset_id').notNullable();
        table.uuid('document_id').notNullable();
        table.text('notes');
        table.timestamp('created_at').defaultTo(knex.raw('CURRENT_TIMESTAMP'));
        table.uuid('created_by').notNullable();
        
        // Foreign keys
        table.foreign(['tenant', 'asset_id']).references(['tenant', 'asset_id']).inTable('assets').onDelete('CASCADE');
        table.foreign(['tenant', 'document_id']).references(['tenant', 'document_id']).inTable('documents').onDelete('CASCADE');
        table.foreign(['tenant', 'created_by']).references(['tenant', 'user_id']).inTable('users');
        
        // Unique constraint to prevent duplicate associations
        table.unique(['tenant', 'asset_id', 'document_id']);
    });

    // Add RLS policy
    await knex.raw(`
        ALTER TABLE asset_document_associations ENABLE ROW LEVEL SECURITY;
        
        CREATE POLICY tenant_isolation_policy ON asset_document_associations
            USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);
    `);
};

exports.down = async function(knex) {
    await knex.schema.dropTableIfExists('asset_document_associations');
};
