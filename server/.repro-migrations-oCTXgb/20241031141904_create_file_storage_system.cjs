/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
    // Create storage_providers table
    await knex.schema.createTable('storage_providers', table => {
        table.uuid('tenant').notNullable().references('tenant').inTable('tenants');
        table.uuid('provider_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.text('provider_type').notNullable().checkIn(['local', 's3', 'azure', 'gcs', 'sftp']);
        table.text('provider_name').notNullable();
        table.boolean('is_active').defaultTo(true);
        table.jsonb('config').notNullable();
        table.timestamp('created_at').defaultTo(knex.fn.now());
        table.timestamp('updated_at').defaultTo(knex.fn.now());
        table.primary(['tenant', 'provider_id']);
    });

    // Create storage_buckets table
    await knex.schema.createTable('storage_buckets', table => {
        table.uuid('tenant').notNullable().references('tenant').inTable('tenants');
        table.uuid('bucket_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.uuid('provider_id').notNullable();
        table.text('bucket_name').notNullable();
        table.text('bucket_path').notNullable();
        table.boolean('is_default').defaultTo(false);
        table.integer('retention_days');
        table.bigInteger('max_file_size');
        table.specificType('allowed_mime_types', 'text[]');
        table.timestamp('created_at').defaultTo(knex.fn.now());
        table.timestamp('updated_at').defaultTo(knex.fn.now());
        table.primary(['tenant', 'bucket_id']);
        table.foreign(['tenant', 'provider_id']).references(['tenant', 'provider_id']).inTable('storage_providers');
    });

    // Create file_stores table
    await knex.schema.createTable('file_stores', table => {
        table.uuid('tenant').notNullable().references('tenant').inTable('tenants');
        table.uuid('file_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.uuid('bucket_id').notNullable();
        table.text('file_name').notNullable();
        table.text('original_name').notNullable();
        table.text('mime_type').notNullable();
        table.bigInteger('file_size').notNullable();
        table.text('storage_path').notNullable();
        table.uuid('uploaded_by').notNullable();
        table.timestamp('created_at').defaultTo(knex.fn.now());
        table.timestamp('updated_at').defaultTo(knex.fn.now());
        table.boolean('is_deleted').defaultTo(false);
        table.timestamp('deleted_at');
        table.uuid('deleted_by');
        table.primary(['tenant', 'file_id']);
        table.foreign(['tenant', 'bucket_id']).references(['tenant', 'bucket_id']).inTable('storage_buckets');
        table.foreign(['tenant', 'uploaded_by']).references(['tenant', 'user_id']).inTable('users');
        table.foreign(['tenant', 'deleted_by']).references(['tenant', 'user_id']).inTable('users');
    });

    // Create file_references table
    await knex.schema.createTable('file_references', table => {
        table.uuid('tenant').notNullable().references('tenant').inTable('tenants');
        table.uuid('reference_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.uuid('file_id').notNullable();
        table.text('entity_type').notNullable();
        table.uuid('entity_id').notNullable();
        table.timestamp('created_at').defaultTo(knex.fn.now());
        table.uuid('created_by').notNullable();
        table.primary(['tenant', 'reference_id']);
        table.foreign(['tenant', 'file_id']).references(['tenant', 'file_id']).inTable('file_stores');
        table.foreign(['tenant', 'created_by']).references(['tenant', 'user_id']).inTable('users');
    });

    // Create provider_events table
    await knex.schema.createTable('provider_events', table => {
        table.uuid('tenant').notNullable().references('tenant').inTable('tenants');
        table.uuid('event_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.uuid('provider_id').notNullable();
        table.text('event_type').notNullable();
        table.text('status').notNullable();
        table.jsonb('details');
        table.timestamp('created_at').defaultTo(knex.fn.now());
        table.primary(['tenant', 'event_id']);
        table.foreign(['tenant', 'provider_id']).references(['tenant', 'provider_id']).inTable('storage_providers');
    });

    // Enable RLS
    await knex.raw('ALTER TABLE public.storage_providers ENABLE ROW LEVEL SECURITY');
    await knex.raw('ALTER TABLE public.storage_buckets ENABLE ROW LEVEL SECURITY');
    await knex.raw('ALTER TABLE public.file_stores ENABLE ROW LEVEL SECURITY');
    await knex.raw('ALTER TABLE public.file_references ENABLE ROW LEVEL SECURITY');
    await knex.raw('ALTER TABLE public.provider_events ENABLE ROW LEVEL SECURITY');    

    // Create RLS policies
    await knex.raw(`
        CREATE POLICY tenant_isolation_policy ON public.storage_providers 
            AS PERMISSIVE FOR ALL
            USING ((tenant)::text = current_setting('app.current_tenant'::text));

        CREATE POLICY tenant_isolation_policy ON public.storage_buckets
            AS PERMISSIVE FOR ALL
            USING ((tenant)::text = current_setting('app.current_tenant'::text));

        CREATE POLICY tenant_isolation_policy ON public.file_stores
            AS PERMISSIVE FOR ALL
            USING ((tenant)::text = current_setting('app.current_tenant'::text));

        CREATE POLICY tenant_isolation_policy ON public.file_references
            AS PERMISSIVE FOR ALL
            USING ((tenant)::text = current_setting('app.current_tenant'::text));

        CREATE POLICY tenant_isolation_policy ON public.provider_events
            AS PERMISSIVE FOR ALL
            USING ((tenant)::text = current_setting('app.current_tenant'::text));
    `);

    // Create recommended indexes
    await knex.schema.raw(`
        CREATE INDEX idx_file_stores_bucket ON public.file_stores(tenant, bucket_id);
        CREATE INDEX idx_file_references_entity ON public.file_references(tenant, entity_type, entity_id);
        CREATE INDEX idx_file_stores_uploaded_by ON public.file_stores(tenant, uploaded_by);
    `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
    // Drop indexes
    await knex.schema.raw(`
        DROP INDEX IF EXISTS idx_file_stores_bucket;
        DROP INDEX IF EXISTS idx_file_references_entity;
        DROP INDEX IF EXISTS idx_file_stores_uploaded_by;
    `);

    // Drop tables in reverse order
    await knex.schema.dropTableIfExists('provider_events');
    await knex.schema.dropTableIfExists('file_references');
    await knex.schema.dropTableIfExists('file_stores');
    await knex.schema.dropTableIfExists('storage_buckets');
    await knex.schema.dropTableIfExists('storage_providers');
};
