/**
 * ⚠️ SCHEMA RENAME NOTICE: Many tables in this file have been renamed.
 * DO NOT use names from this file directly - check the rename migrations:
 *
 * - companies → clients (see 20251003000001_company_to_client_migration.cjs)
 * - channels → boards (see 20250930000001_rename_channels_to_boards.cjs)
 * - billing_plans → contract_lines (see 20251008000001_rename_billing_to_contracts.cjs)
 * - service_categories → ticket_categories (see 20250327144330_rename_service_categories_to_ticket_categories.cjs)
 */

exports.up = async function(knex) {
    await knex.schema.createTable('tenants', (table) => {
        table.uuid('tenant').primary().defaultTo(knex.raw('gen_random_uuid()'));
        table.text('company_name').notNullable();
        table.text('phone_number');
        table.text('email').notNullable();
        table.text('industry');
        table.timestamp('created_at', { useTz: true });
        table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
        table.text('payment_platform_id');
        table.text('payment_method_id');
        table.text('auth_service_id');
        table.text('plan');
    });

    await knex.schema.createTable('users', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('user_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.text('username').notNullable();
        table.text('hashed_password').notNullable();
        table.text('first_name');
        table.text('last_name');
        table.timestamp('date_of_birth');
        table.text('role').notNullable();
        table.text('email');
        table.text('icon');
        table.text('auth_method');
        table.timestamp('created_at',{ useTz: true }).defaultTo(knex.fn.now());
        table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
        table.boolean('two_factor_enabled').defaultTo(false);
        table.text('two_factor_secret');
        table.boolean('is_google_user').defaultTo(false);
        table.bigInteger('rate');
        table.jsonb('roles').defaultTo('[]');
        table.primary(['tenant', 'user_id', 'email']);
        table.foreign('tenant').references('tenants.tenant');
        table.unique(['tenant', 'user_id']);
    });

    await knex.schema.createTable('sessions', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('session_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.uuid('user_id').notNullable();
        table.text('token').notNullable();
        table.timestamp('created_at', { useTz: true });
        table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
        table.primary(['tenant', 'session_id']);
        table.foreign('tenant').references('tenants.tenant');
        table.foreign(['tenant', 'user_id']).references(['tenant', 'user_id']).inTable('users');
    });

    await knex.schema.raw('CREATE INDEX "session_user_id_index" ON "sessions"("user_id")');

    await knex.schema.createTable('companies', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('company_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.text('company_name').notNullable();
        table.text('phone_no');
        table.text('url');
        table.text('address');
        table.text('status');
        table.text('type');
        table.jsonb('properties');
        table.text('billing_type');
        table.text('payment_terms');
        table.text('billing_cycle');
        table.bigInteger('credit_limit');
        table.text('preferred_payment_method');
        table.boolean('auto_invoice').defaultTo(false);
        table.text('invoice_delivery_method');
        table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
        table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
        table.primary(['tenant', 'company_id']);
        table.foreign('tenant').references('tenants.tenant');
    });

    await knex.schema.createTable('contacts', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('contact_name_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.text('full_name');
        table.uuid('company_id');
        table.text('phone_number');
        table.text('email');
        table.text('role');
        table.boolean('approver');
        table.timestamp('date_of_birth');
        table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
        table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
        table.primary(['tenant', 'contact_name_id']);
        table.foreign('tenant').references('tenants.tenant');
        table.foreign(['tenant', 'company_id']).references(['tenant', 'company_id']).inTable('companies');
    });    

    await knex.schema.createTable('statuses', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('status_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.text('status_name').notNullable();
        table.text('status_type').notNullable().checkIn(['project', 'ticket', 'project_task']);
        table.integer('order_number').notNullable();
        table.uuid('created_by').notNullable();
        table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
        table.primary(['tenant', 'status_id']);
        table.foreign('tenant').references('tenants.tenant');
        table.foreign(['tenant', 'created_by']).references(['tenant', 'user_id']).inTable('users');
    });

    await knex.schema.createTable('channels', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('channel_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.text('channel_name').notNullable();
        table.boolean('display_contact_name_id').defaultTo(true);
        table.boolean('display_priority').defaultTo(true);
        table.boolean('display_severity').defaultTo(true);
        table.boolean('display_urgency').defaultTo(true);
        table.boolean('display_impact').defaultTo(true);
        table.boolean('display_category').defaultTo(true);
        table.boolean('display_subcategory').defaultTo(true);
        table.boolean('display_assigned_to').defaultTo(true);
        table.boolean('display_status').defaultTo(true);
        table.boolean('display_due_date').defaultTo(true);
        table.primary(['tenant', 'channel_id']);
        table.foreign('tenant').references('tenants.tenant');
    });

    await knex.schema.createTable('categories', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('category_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.text('category_name').notNullable();
        table.uuid('parent_category');
        table.uuid('channel_id').notNullable();
        table.uuid('created_by').notNullable();
        table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
        table.primary(['tenant', 'category_id']);
        table.foreign('tenant').references('tenants.tenant');
        table.foreign(['tenant', 'created_by']).references(['tenant', 'user_id']).inTable('users');
        table.foreign(['tenant', 'channel_id']).references(['tenant', 'channel_id']).inTable('channels');
        table.foreign(['tenant', 'parent_category']).references(['tenant', 'category_id']).inTable('categories');
    });

    await knex.schema.createTable('priorities', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('priority_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.text('priority_name').notNullable();
        table.uuid('created_by').notNullable();
        table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
        table.primary(['tenant', 'priority_id']);
        table.foreign('tenant').references('tenants.tenant');
        table.foreign(['tenant', 'created_by']).references(['tenant', 'user_id']).inTable('users');
    });

    await knex.schema.createTable('severities', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('severity_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.text('severity_name').notNullable();
        table.uuid('created_by').notNullable();
        table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
        table.primary(['tenant', 'severity_id']);
        table.foreign('tenant').references('tenants.tenant');
        table.foreign(['tenant', 'created_by']).references(['tenant', 'user_id']).inTable('users');
    });

    await knex.schema.createTable('urgencies', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('urgency_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.text('urgency_name').notNullable();
        table.uuid('created_by').notNullable();
        table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
        table.primary(['tenant', 'urgency_id']);
        table.foreign('tenant').references('tenants.tenant');
        table.foreign(['tenant', 'created_by']).references(['tenant', 'user_id']).inTable('users');
    });

    await knex.schema.createTable('impacts', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('impact_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.text('impact_name').notNullable();
        table.uuid('created_by').notNullable();
        table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
        table.primary(['tenant', 'impact_id']);
        table.foreign('tenant').references('tenants.tenant');
        table.foreign(['tenant', 'created_by']).references(['tenant', 'user_id']).inTable('users');
    });

    await knex.schema.createTable('next_number', (table) => {
        table.uuid('tenant').notNullable();
        table.text('entity_type').notNullable();
        table.bigInteger('last_number').notNullable().defaultTo(0);
        table.bigInteger('initial_value').notNullable().defaultTo(1000);
        table.text('prefix').defaultTo('TIC');
        table.primary(['tenant', 'entity_type']);
        table.foreign('tenant').references('tenants.tenant');
    });

    await knex.schema.raw('CREATE INDEX idx_next_number_tenant_entity ON next_number (tenant, entity_type)');

    await knex.schema.createTable('attribute_definitions', (table) => {
        table.uuid('tenant').notNullable();
        table.text('attribute_name').notNullable();
        table.text('description');
        table.text('type').notNullable();
        table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
        table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
        table.primary(['tenant', 'attribute_name']);
        table.foreign('tenant').references('tenants.tenant');
    });

    await knex.schema.raw(`
        CREATE OR REPLACE FUNCTION user_has_role(user_roles JSONB, role_name TEXT)
        RETURNS BOOLEAN AS $$
        BEGIN
        RETURN EXISTS (SELECT 1 FROM jsonb_array_elements(user_roles) AS role WHERE role->>'role_name' = role_name);
        END;
        $$ LANGUAGE plpgsql;
        `);

    await knex.schema.raw(`
        CREATE OR REPLACE FUNCTION user_has_permission(user_roles JSONB, resource TEXT, action TEXT)
        RETURNS BOOLEAN AS $$
        BEGIN
        RETURN EXISTS (
            SELECT 1
            FROM jsonb_array_elements(user_roles) AS role,
                jsonb_array_elements(role->'permissions') AS permission
            WHERE permission->>'resource' = resource AND permission->>'action' = action
        );
        END;
        $$ LANGUAGE plpgsql;
    `);

    await knex.schema.createTable('tickets', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('ticket_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.text('ticket_number').notNullable();
        table.text('title');
        table.text('url');
        table.uuid('company_id');
        table.uuid('contact_name_id');
        table.uuid('status_id');
        table.uuid('channel_id');
        table.uuid('category_id');
        table.uuid('subcategory_id');
        table.uuid('priority_id');
        table.uuid('severity_id');
        table.uuid('urgency_id');
        table.uuid('impact_id');
        table.uuid('entered_by');
        table.uuid('updated_by');
        table.uuid('assigned_to');
        table.uuid('closed_by');
        table.timestamp('entered_at', { useTz: true });
        table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
        table.timestamp('closed_at', { useTz: true });
        table.boolean('is_closed');
        table.jsonb('attributes');
        table.primary(['tenant', 'ticket_id']);
        table.foreign('tenant').references('tenants.tenant');
        table.foreign(['tenant', 'company_id']).references(['tenant', 'company_id']).inTable('companies');
        table.foreign(['tenant', 'contact_name_id']).references(['tenant', 'contact_name_id']).inTable('contacts');
        table.foreign(['tenant', 'channel_id']).references(['tenant', 'channel_id']).inTable('channels');
        table.foreign(['tenant', 'status_id']).references(['tenant', 'status_id']).inTable('statuses');
        table.foreign(['tenant', 'category_id']).references(['tenant', 'category_id']).inTable('categories');
        table.foreign(['tenant', 'subcategory_id']).references(['tenant', 'category_id']).inTable('categories');
        table.foreign(['tenant', 'priority_id']).references(['tenant', 'priority_id']).inTable('priorities');
        table.foreign(['tenant', 'severity_id']).references(['tenant', 'severity_id']).inTable('severities');
        table.foreign(['tenant', 'urgency_id']).references(['tenant', 'urgency_id']).inTable('urgencies');
        table.foreign(['tenant', 'impact_id']).references(['tenant', 'impact_id']).inTable('impacts');
        table.unique(['tenant', 'ticket_id', 'assigned_to']);
        table.unique(['tenant', 'ticket_number']);
    });

    await knex.schema.createTable('comments', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('comment_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.uuid('ticket_id').notNullable();
        table.uuid('user_id');
        table.uuid('contact_name_id');
        table.text('note').notNullable();
        table.boolean('is_internal').notNullable();
        table.boolean('is_resolution').notNullable();
        table.boolean('is_initial_description').notNullable();
        table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
        table.primary(['tenant', 'comment_id']);
        table.foreign('tenant').references('tenants.tenant');
        table.foreign(['tenant', 'ticket_id']).references(['tenant', 'ticket_id']).inTable('tickets');
        table.foreign(['tenant', 'user_id']).references(['tenant', 'user_id']).inTable('users');
    });

    await knex.schema.createTable('schedules', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('schedule_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.uuid('ticket_id').notNullable();
        table.uuid('user_id');
        table.uuid('contact_name_id');
        table.uuid('company_id');
        table.text('status').notNullable();
        table.timestamp('scheduled_start', { useTz: true });
        table.timestamp('scheduled_end', { useTz: true });
        table.timestamp('actual_start', { useTz: true });
        table.timestamp('actual_end', { useTz: true });
        table.integer('duration_minutes');
        table.text('description');
        table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
        table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
        table.primary(['tenant', 'schedule_id']);
        table.foreign('tenant').references('tenants.tenant');
        table.foreign(['tenant', 'ticket_id']).references(['tenant', 'ticket_id']).inTable('tickets');
        table.foreign(['tenant', 'user_id']).references(['tenant', 'user_id']).inTable('users');
        table.foreign(['tenant', 'contact_name_id']).references(['tenant', 'contact_name_id']).inTable('contacts');
        table.foreign(['tenant', 'company_id']).references(['tenant', 'company_id']).inTable('companies');
    });

    await knex.schema.createTable('document_types', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('type_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.text('type_name').notNullable();
        table.text('icon');
        table.primary(['tenant', 'type_id']);
        table.foreign('tenant').references('tenants.tenant');
    });

    await knex.schema.createTable('documents', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('document_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.text('document_name').notNullable();
        table.uuid('type_id').notNullable();
        table.uuid('user_id').notNullable();
        table.uuid('contact_name_id');
        table.uuid('company_id');
        table.uuid('ticket_id');
        table.uuid('schedule_id');
        table.increments('order_number').notNullable();
        table.uuid('created_by').notNullable();
        table.uuid('edited_by');
        table.timestamp('entered_at', { useTz: true });
        table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
        table.text('content');
        table.primary(['tenant', 'document_id']);
        table.foreign('tenant').references('tenants.tenant');
        table.foreign(['tenant', 'type_id']).references(['tenant', 'type_id']).inTable('document_types');
        table.foreign(['tenant', 'created_by']).references(['tenant', 'user_id']).inTable('users');
        table.foreign(['tenant', 'contact_name_id']).references(['tenant', 'contact_name_id']).inTable('contacts');
        table.foreign(['tenant', 'company_id']).references(['tenant', 'company_id']).inTable('companies');
    });

    await knex.schema.createTable('tags', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('tag_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.uuid('channel_id');
        table.text('tag_text').notNullable();
        table.uuid('tagged_id').notNullable();
        table.text('tagged_type').notNullable();
        table.primary(['tenant', 'tag_id']);
        table.foreign('tenant').references('tenants.tenant');
        table.foreign(['tenant', 'channel_id']).references(['tenant', 'channel_id']).inTable('channels');
    });

    await knex.schema.createTable('interaction_types', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('type_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.text('type_name').notNullable();
        table.text('icon');
        table.primary(['tenant', 'type_id']);
        table.foreign('tenant').references('tenants.tenant');
    });

    await knex.schema.createTable('interactions', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('interaction_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.uuid('type_id').notNullable();
        table.uuid('contact_name_id');
        table.uuid('company_id');
        table.uuid('user_id').notNullable();
        table.uuid('ticket_id');
        table.text('description');
        table.timestamp('interaction_date', { useTz: true }).defaultTo(knex.fn.now());
        table.integer('duration');
        table.primary(['tenant', 'interaction_id']);
        table.foreign('tenant').references('tenants.tenant');
        table.foreign(['tenant', 'type_id']).references(['tenant', 'type_id']).inTable('interaction_types');
        table.foreign(['tenant', 'contact_name_id']).references(['tenant', 'contact_name_id']).inTable('contacts');
        table.foreign(['tenant', 'company_id']).references(['tenant', 'company_id']).inTable('companies');
        table.foreign(['tenant', 'user_id']).references(['tenant', 'user_id']).inTable('users');
        table.foreign(['tenant', 'ticket_id']).references(['tenant', 'ticket_id']).inTable('tickets');
    });

    await knex.schema.createTable('service_categories', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('category_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.text('category_name').notNullable();
        table.text('description');
        table.primary(['tenant', 'category_id']);
        table.foreign('tenant').references('tenants.tenant');
    });

    await knex.schema.createTable('service_catalog', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('service_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.text('service_name').notNullable();
        table.text('description');
        table.text('service_type').notNullable();
        table.bigInteger('default_rate');
        table.text('unit_of_measure');
        table.uuid('category_id');
        table.primary(['tenant', 'service_id']);
        table.foreign('tenant').references('tenants.tenant');
        table.foreign(['tenant', 'category_id']).references(['tenant', 'category_id']).inTable('service_categories');
    });

    await knex.schema.createTable('billing_plans', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('plan_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.text('plan_name').notNullable();
        table.text('description');
        table.text('billing_frequency').notNullable();
        table.boolean('is_custom').defaultTo(false);
        table.text('plan_type').checkIn(['Fixed', 'Hourly', 'Usage', 'Bucket']);
        table.primary(['tenant', 'plan_id']);
        table.foreign('tenant').references('tenants.tenant');
    });

    await knex.schema.createTable('bucket_plans', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('bucket_plan_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.uuid('plan_id').notNullable();
        table.integer('total_hours').notNullable();
        table.text('billing_period').notNullable();
        table.bigInteger('overage_rate').notNullable();
        table.primary(['tenant', 'bucket_plan_id']);
        table.foreign('tenant').references('tenants.tenant');
        table.foreign(['tenant', 'plan_id']).references(['tenant', 'plan_id']).inTable('billing_plans');
    });

    await knex.schema.createTable('bucket_usage', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('usage_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.uuid('bucket_plan_id').notNullable();
        table.uuid('company_id').notNullable();
        table.timestamp('period_start').notNullable();
        table.timestamp('period_end').notNullable();
        table.bigInteger('hours_used').notNullable();
        table.bigInteger('overage_hours').notNullable();
        table.primary(['tenant', 'usage_id']);
        table.foreign('tenant').references('tenants.tenant');
        table.foreign(['tenant', 'bucket_plan_id']).references(['tenant', 'bucket_plan_id']).inTable('bucket_plans');
        table.foreign(['tenant', 'company_id']).references(['tenant', 'company_id']).inTable('companies');
    });

    await knex.schema.createTable('plan_services', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('plan_id').notNullable();
        table.uuid('service_id').notNullable();
        table.integer('quantity');
        table.bigInteger('custom_rate');
        table.primary(['tenant', 'plan_id', 'service_id']);
        table.foreign(['tenant', 'plan_id']).references(['tenant', 'plan_id']).inTable('billing_plans');
        table.foreign(['tenant', 'service_id']).references(['tenant', 'service_id']).inTable('service_catalog');
    });

    await knex.schema.createTable('client_billing', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('billing_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.uuid('company_id').notNullable();
        table.uuid('plan_id').notNullable();
        table.uuid('service_category');
        table.boolean('is_active').defaultTo(true);
        table.timestamp('start_date').notNullable();
        table.timestamp('end_date');
        table.primary(['tenant', 'billing_id']);
        table.foreign(['tenant', 'company_id']).references(['tenant', 'company_id']).inTable('companies');
        table.foreign(['tenant', 'plan_id']).references(['tenant', 'plan_id']).inTable('billing_plans');
        table.foreign(['tenant', 'service_category']).references(['tenant', 'category_id']).inTable('service_categories');
    });

    await knex.schema.createTable('projects', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('project_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.uuid('company_id').notNullable();
        table.text('project_name').notNullable();
        table.text('description');
        table.timestamp('start_date');
        table.timestamp('end_date');
        table.uuid('status').notNullable();
        table.text('wbs_code').notNullable();
        table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
        table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
        table.primary(['tenant', 'project_id']);
        table.foreign('tenant').references('tenants.tenant');
        table.foreign(['tenant', 'company_id']).references(['tenant', 'company_id']).inTable('companies');
        table.unique(['tenant', 'wbs_code']);
    });

    await knex.schema.createTable('time_period_types', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('type_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.text('type_name').notNullable();
        table.text('description');
        table.primary(['tenant', 'type_id']);
        table.foreign('tenant').references('tenants.tenant');
    });

    await knex.schema.createTable('time_periods', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('period_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.uuid('type_id').notNullable();
        table.timestamp('start_date', { useTz: true }).notNullable();
        table.timestamp('end_date', { useTz: true }).notNullable();
        table.boolean('is_closed').defaultTo(false);
        table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
        table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
        table.primary(['tenant', 'period_id']);
        table.foreign('tenant').references('tenants.tenant');
        table.foreign(['tenant', 'type_id']).references(['tenant', 'type_id']).inTable('time_period_types');
    });

    await knex.schema.createTable('tenant_time_period_settings', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('type_id').notNullable();
        table.integer('start_day');
        table.integer('start_month');
        table.integer('frequency');
        table.text('frequency_unit').checkIn(['day', 'week', 'month', 'year']);
        table.boolean('is_active').defaultTo(true);
        table.timestamp('effective_from', { useTz: true }).notNullable();
        table.timestamp('effective_to', { useTz: true });
        table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
        table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
        table.primary(['tenant', 'type_id', 'effective_from']);
        table.foreign('tenant').references('tenants.tenant');
        table.foreign(['tenant', 'type_id']).references(['tenant', 'type_id']).inTable('time_period_types');
    });

    await knex.schema.raw(`CREATE TYPE ApprovalStatus AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED')`);

    await knex.schema.createTable('time_sheets', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.uuid('user_id').notNullable();
        table.uuid('period_id').notNullable();
        table.specificType('approval_status', 'ApprovalStatus').defaultTo('DRAFT');
        table.timestamp('submitted_at', { useTz: true });
        table.timestamp('approved_at', { useTz: true });
        table.uuid('approved_by');
        table.primary(['tenant', 'id']);
        table.foreign('tenant').references('tenants.tenant');
        table.foreign(['tenant', 'user_id']).references(['tenant', 'user_id']).inTable('users');
        table.foreign(['tenant', 'period_id']).references(['tenant', 'period_id']).inTable('time_periods');
        table.foreign(['tenant', 'approved_by']).references(['tenant', 'user_id']).inTable('users');
    });

    await knex.schema.createTable('time_entries', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('entry_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.uuid('user_id').notNullable();
        table.timestamp('start_time', { useTz: true }).notNullable();
        table.timestamp('end_time', { useTz: true }).notNullable();
        table.text('notes');
        table.uuid('work_item_id');
        table.integer('billable_duration');
        table.text('work_item_type');
        table.specificType('approval_status', 'ApprovalStatus').defaultTo('DRAFT');
        table.uuid('time_sheet_id');
        table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
        table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
        table.primary(['tenant', 'entry_id']);
        table.foreign(['tenant', 'user_id']).references(['tenant', 'user_id']).inTable('users');
        table.foreign(['tenant', 'time_sheet_id']).references(['tenant', 'id']).inTable('time_sheets');
    });

    await knex.schema.createTable('usage_tracking', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('usage_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.uuid('company_id').notNullable();
        table.uuid('service_id').notNullable();
        table.timestamp('usage_date', { useTz: true }).notNullable();
        table.bigInteger('quantity').notNullable();
        table.primary(['tenant', 'usage_id']);
        table.foreign(['tenant', 'company_id']).references(['tenant', 'company_id']).inTable('companies');
        table.foreign(['tenant', 'service_id']).references(['tenant', 'service_id']).inTable('service_catalog');
    });

    await knex.schema.createTable('invoices', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('invoice_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.uuid('company_id').notNullable();
        table.text('invoice_number').notNullable();
        table.timestamp('invoice_date', { useTz: true }).notNullable();
        table.timestamp('due_date', { useTz: true }).notNullable();
        table.bigInteger('total_amount').notNullable();
        table.text('status').notNullable();
        table.uuid('template_id');
        table.jsonb('custom_fields');
        table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
        table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
        table.primary(['tenant', 'invoice_id']);
        table.foreign(['tenant', 'company_id']).references(['tenant', 'company_id']).inTable('companies');
    });

    await knex.schema.createTable('invoice_items', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('item_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.uuid('invoice_id').notNullable();
        table.uuid('service_id').notNullable();
        table.text('description').notNullable();
        table.bigInteger('quantity').notNullable();
        table.bigInteger('unit_price').notNullable();
        table.bigInteger('total_price').notNullable();
        table.primary(['tenant', 'item_id']);
        table.foreign(['tenant', 'invoice_id']).references(['tenant', 'invoice_id']).inTable('invoices');
        table.foreign(['tenant', 'service_id']).references(['tenant', 'service_id']).inTable('service_catalog');
    });

    await knex.schema.createTable('project_phases', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('phase_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.uuid('project_id').notNullable();
        table.text('phase_name').notNullable();
        table.text('description');
        table.timestamp('start_date', { useTz: true });
        table.timestamp('end_date', { useTz: true });
        table.text('status').notNullable();
        table.integer('order_number').notNullable();
        table.text('wbs_code').notNullable();
        table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
        table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
        table.primary(['tenant', 'phase_id']);
        table.foreign('tenant').references('tenants.tenant');
        table.foreign(['tenant', 'project_id']).references(['tenant', 'project_id']).inTable('projects');
        table.unique(['tenant', 'project_id', 'wbs_code']);
    });

    await knex.schema.createTable('project_tasks', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('task_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.uuid('phase_id').notNullable();
        table.text('task_name').notNullable();
        table.text('description');
        table.uuid('assigned_to');
        table.bigInteger('estimated_hours');
        table.timestamp('due_date', { useTz: true });
        table.bigInteger('actual_hours');
        table.uuid('status_id');
        table.text('wbs_code').notNullable();
        table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
        table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
        table.primary(['tenant', 'task_id']);
        table.foreign('tenant').references('tenants.tenant');
        table.foreign(['tenant', 'phase_id']).references(['tenant', 'phase_id']).inTable('project_phases');
        table.foreign(['tenant', 'assigned_to']).references(['tenant', 'user_id']).inTable('users');
        table.unique(['tenant', 'phase_id', 'wbs_code']);
        table.foreign(['tenant', 'status_id']).references(['tenant', 'status_id']).inTable('statuses');
    });

    await knex.schema.createTable('project_ticket_links', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('link_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.uuid('project_id').notNullable();
        table.uuid('phase_id');
        table.uuid('task_id');
        table.uuid('ticket_id').notNullable();
        table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
        table.primary(['tenant', 'link_id']);
        table.foreign('tenant').references('tenants.tenant');
        table.foreign(['tenant', 'project_id']).references(['tenant', 'project_id']).inTable('projects');
        table.foreign(['tenant', 'phase_id']).references(['tenant', 'phase_id']).inTable('project_phases');
        table.foreign(['tenant', 'task_id']).references(['tenant', 'task_id']).inTable('project_tasks');
        table.foreign(['tenant', 'ticket_id']).references(['tenant', 'ticket_id']).inTable('tickets');
    });
    await knex.schema.createTable('schedule_entries', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('entry_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.text('title').notNullable();
        table.uuid('work_item_id').notNullable();
        table.uuid('user_id').notNullable();
        table.timestamp('scheduled_start', { useTz: true }).notNullable();
        table.timestamp('scheduled_end', { useTz: true }).notNullable();
        table.text('status').notNullable();
        table.text('notes');
        table.jsonb('recurrence_pattern');
        table.text('work_item_type').notNullable().checkIn(['project_task', 'ticket']);
        table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
        table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
        table.primary(['tenant', 'entry_id']);
        table.foreign('tenant').references('tenants.tenant');
        table.foreign(['tenant', 'user_id']).references(['tenant', 'user_id']).inTable('users');
    });

    await knex.schema.createTable('resources', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('resource_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.uuid('user_id').notNullable();
        table.jsonb('availability');
        table.specificType('skills', 'TEXT[]');
        table.integer('max_daily_capacity');
        table.integer('max_weekly_capacity');
        table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
        table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
        table.primary(['tenant', 'resource_id']);
        table.foreign('tenant').references('tenants.tenant');
        table.foreign(['tenant', 'user_id']).references(['tenant', 'user_id']).inTable('users');
    });

    await knex.schema.createTable('schedule_conflicts', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('conflict_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.uuid('entry_id_1').notNullable();
        table.uuid('entry_id_2').notNullable();
        table.text('conflict_type').notNullable();
        table.boolean('resolved').defaultTo(false);
        table.text('resolution_notes');
        table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
        table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
        table.primary(['tenant', 'conflict_id']);
        table.foreign('tenant').references('tenants.tenant');
        table.foreign(['tenant', 'entry_id_1']).references(['tenant', 'entry_id']).inTable('schedule_entries');
        table.foreign(['tenant', 'entry_id_2']).references(['tenant', 'entry_id']).inTable('schedule_entries');
    });

    await knex.schema.createTable('teams', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('team_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.text('team_name').notNullable();
        table.uuid('manager_id').notNullable();
        table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
        table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
        table.primary(['tenant', 'team_id']);
        table.foreign('tenant').references('tenants.tenant');
        table.foreign(['tenant', 'manager_id']).references(['tenant', 'user_id']).inTable('users');
    });

    await knex.schema.createTable('team_members', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('team_id').notNullable();
        table.uuid('user_id').notNullable();
        table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
        table.primary(['tenant', 'team_id', 'user_id']);
        table.foreign('tenant').references('tenants.tenant');
        table.foreign(['tenant', 'team_id']).references(['tenant', 'team_id']).inTable('teams');
        table.foreign(['tenant', 'user_id']).references(['tenant', 'user_id']).inTable('users');
    });

    await knex.schema.createTable('approval_levels', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.text('name').notNullable();
        table.integer('order_num').notNullable();
        table.primary(['tenant', 'id']);
        table.foreign('tenant').references('tenants.tenant');
    });

    await knex.schema.createTable('approval_thresholds', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.text('type').checkIn(['OVERTIME', 'HIGH_VALUE']);
        table.bigInteger('threshold').notNullable();
        table.uuid('approval_level_id').notNullable();
        table.primary(['tenant', 'id']);
        table.foreign('tenant').references('tenants.tenant');
        table.foreign(['tenant', 'approval_level_id']).references(['tenant', 'id']).inTable('approval_levels');
    });

    await knex.raw(`
    CREATE OR REPLACE FUNCTION generate_next_number(p_tenant_id UUID, p_entity_type TEXT) 
        RETURNS TEXT AS $$
        DECLARE
            new_number BIGINT;
            number_prefix TEXT;
            initial_val BIGINT;
            formatted_number TEXT;
        BEGIN
            PERFORM pg_advisory_xact_lock(hashtext(p_tenant_id::text || p_entity_type));
            
            INSERT INTO next_number (tenant, entity_type)
            VALUES (p_tenant_id, p_entity_type)
            ON CONFLICT (tenant, entity_type) DO UPDATE
            SET last_number = 
                CASE 
                    WHEN next_number.last_number = 0 THEN next_number.initial_value
                    ELSE next_number.last_number + 1
                END
            RETURNING last_number, initial_value, prefix INTO new_number, initial_val, number_prefix;
            
            IF new_number = initial_val AND new_number != 1 THEN
            ELSE
                UPDATE next_number
                SET last_number = new_number
                WHERE tenant = p_tenant_id AND entity_type = p_entity_type;
            END IF;

            IF number_prefix IS NOT NULL THEN
                formatted_number := number_prefix || new_number::TEXT;
            ELSE
                formatted_number := new_number::TEXT;
            END IF;
            
            RETURN formatted_number;
        END;
        $$ LANGUAGE plpgsql;
`);

    await knex.raw(`
        CREATE OR REPLACE FUNCTION set_ticket_number()
        RETURNS TRIGGER AS $$
        BEGIN
            IF NEW.ticket_number IS NULL OR NEW.ticket_number = '' THEN
                NEW.ticket_number := generate_next_number(NEW.tenant, 'TICKET');
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        `);

    await knex.raw(`
        CREATE TRIGGER trigger_set_ticket_number
        BEFORE INSERT ON tickets
        FOR EACH ROW
        EXECUTE FUNCTION set_ticket_number();
    `);

    await knex.raw(`
    CREATE OR REPLACE FUNCTION get_current_tenant_id() RETURNS UUID AS $$
        DECLARE
            tenant_id UUID;
        BEGIN
            BEGIN
                tenant_id := current_setting('app.current_tenant')::uuid;
            EXCEPTION WHEN OTHERS THEN
                RAISE EXCEPTION 'Invalid tenant ID';
            END;
            RETURN tenant_id;
        END;
        $$ LANGUAGE plpgsql SECURITY DEFINER;
    `);

    await knex.schema.createTable('roles', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('role_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.text('role_name').notNullable();
        table.text('description');
        table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
        table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
        table.primary(['tenant', 'role_id']);
        table.foreign('tenant').references('tenants.tenant');
    });

    await knex.schema.createTable('user_roles', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('user_id').notNullable();
        table.uuid('role_id').notNullable();
        table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
        table.primary(['tenant', 'user_id', 'role_id']);
        table.foreign('tenant').references('tenants.tenant');
        table.foreign(['tenant', 'user_id']).references(['tenant', 'user_id']).inTable('users');
        table.foreign(['tenant', 'role_id']).references(['tenant', 'role_id']).inTable('roles');
    });

    await knex.schema.createTable('permissions', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('permission_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.text('resource').notNullable();
        table.text('action').notNullable();
        table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
        table.primary(['tenant', 'permission_id']);
        table.foreign('tenant').references('tenants.tenant');
    });

    await knex.schema.createTable('role_permissions', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('role_id').notNullable();
        table.uuid('permission_id').notNullable();
        table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
        table.primary(['tenant', 'role_id', 'permission_id']);
        table.foreign('tenant').references('tenants.tenant');
        table.foreign(['tenant', 'role_id']).references(['tenant', 'role_id']).inTable('roles');
        table.foreign(['tenant', 'permission_id']).references(['tenant', 'permission_id']).inTable('permissions');
    });

    await knex.schema.createTable('policies', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('policy_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.text('policy_name').notNullable();
        table.text('resource').notNullable();
        table.text('action').notNullable();
        table.jsonb('conditions').notNullable();
        table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
        table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
        table.primary(['tenant', 'policy_id']);
        table.foreign('tenant').references('tenants.tenant');
    });

    await knex.schema.createTable('ticket_resources', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('assignment_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.uuid('ticket_id').notNullable();
        table.uuid('assigned_to').notNullable();
        table.uuid('additional_user_id');
        table.text('role');
        table.timestamp('assigned_at', { useTz: true }).defaultTo(knex.fn.now());
        table.primary(['tenant', 'assignment_id']);
        table.foreign('tenant').references('tenants.tenant');
        table.foreign(['tenant', 'ticket_id', 'assigned_to']).references(['tenant', 'ticket_id', 'assigned_to']).inTable('tickets');
        table.foreign(['tenant', 'assigned_to']).references(['tenant', 'user_id']).inTable('users');
        table.foreign(['tenant', 'additional_user_id']).references(['tenant', 'user_id']).inTable('users');
        table.check('assigned_to != additional_user_id');
    });

    await knex.schema.createTable('invoice_templates', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('template_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.text('name').notNullable();
        table.integer('version').notNullable();
        table.text('dsl').notNullable();
        table.boolean('is_default').defaultTo(false);
        table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
        table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
        table.primary(['tenant', 'template_id']);
    });

    await knex.schema.createTable('template_sections', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('section_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.uuid('template_id').notNullable();
        table.text('section_type').notNullable().checkIn(['header', 'list', 'footer']);
        table.text('name').notNullable();
        table.integer('grid_rows').notNullable();
        table.integer('grid_columns').notNullable();
        table.integer('order_number').notNullable();
        table.primary(['tenant', 'section_id']);
        table.foreign(['tenant', 'template_id']).references(['tenant', 'template_id']).inTable('invoice_templates');
    });

    await knex.schema.createTable('layout_blocks', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('block_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.uuid('section_id').notNullable();
        table.text('type').notNullable();
        table.text('content');
        table.integer('grid_column').notNullable();
        table.integer('grid_row').notNullable();
        table.integer('grid_column_span').notNullable();
        table.integer('grid_row_span').notNullable();
        table.jsonb('styles');
        table.primary(['tenant', 'block_id']);
        table.foreign(['tenant', 'section_id']).references(['tenant', 'section_id']).inTable('template_sections');
    });

    await knex.schema.createTable('custom_fields', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('field_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.text('name').notNullable();
        table.text('type').notNullable();
        table.jsonb('default_value');
        table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
        table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
        table.primary(['tenant', 'field_id']);
    });

    await knex.schema.createTable('invoice_annotations', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('annotation_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.uuid('invoice_id').notNullable();
        table.uuid('user_id').notNullable();
        table.text('content').notNullable();
        table.boolean('is_internal').notNullable();
        table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
        table.primary(['tenant', 'annotation_id']);
        table.foreign(['tenant', 'invoice_id']).references(['tenant', 'invoice_id']).inTable('invoices');
        table.foreign(['tenant', 'user_id']).references(['tenant', 'user_id']).inTable('users');
    });

    await knex.schema.createTable('conditional_display_rules', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('rule_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.uuid('template_id').notNullable();
        table.jsonb('condition').notNullable();
        table.text('action').notNullable();
        table.text('target').notNullable();
        table.jsonb('format');
        table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
        table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
        table.primary(['tenant', 'rule_id']);
        table.foreign(['tenant', 'template_id']).references(['tenant', 'template_id']).inTable('invoice_templates');
    });

    await knex.schema.raw('CREATE INDEX idx_ticket_resources_ticket_user ON ticket_resources (tenant, ticket_id, additional_user_id)');


    const dbUserServer = process.env.DB_USER_SERVER;
    const envDbNameServer = process.env.DB_NAME_SERVER;

    if (dbUserServer) {
        const currentDatabaseResult = await knex.raw('SELECT current_database()');
        const currentDatabaseRow = Array.isArray(currentDatabaseResult.rows)
            ? currentDatabaseResult.rows[0]
            : currentDatabaseResult[0];
        const currentDatabaseName = currentDatabaseRow?.current_database;
        if (!currentDatabaseName) {
            throw new Error('Failed to resolve current database name when applying permissions');
        }
        let targetDbName = envDbNameServer && envDbNameServer !== 'default_db_name'
            ? envDbNameServer
            : currentDatabaseName;

        try {
            const databaseCheck = await knex.raw('SELECT 1 FROM pg_database WHERE datname = ?', [targetDbName]);
            const hasDatabase = Array.isArray(databaseCheck.rows)
                ? databaseCheck.rows.length > 0
                : Array.isArray(databaseCheck) && databaseCheck.length > 0;
            if (!hasDatabase) {
                targetDbName = currentDatabaseName;
            }
        } catch (error) {
            targetDbName = currentDatabaseName;
        }

        const escapedUser = dbUserServer.replace(/"/g, '""');
        const escapedDbName = targetDbName.replace(/"/g, '""');

        await knex.schema.raw(`
            GRANT USAGE ON SCHEMA public TO "${escapedUser}";
            GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO "${escapedUser}";
            GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO "${escapedUser}";
            GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO "${escapedUser}";
            GRANT ALL PRIVILEGES ON DATABASE "${escapedDbName}" TO "${escapedUser}";

            ALTER DEFAULT PRIVILEGES IN SCHEMA public 
            GRANT ALL PRIVILEGES ON TABLES TO "${escapedUser}";

            ALTER DEFAULT PRIVILEGES IN SCHEMA public 
            GRANT ALL PRIVILEGES ON SEQUENCES TO "${escapedUser}";

            ALTER DEFAULT PRIVILEGES IN SCHEMA public 
            GRANT ALL PRIVILEGES ON FUNCTIONS TO "${escapedUser}";       
        `);
    }
}

exports.down = async function(knex) {
    throw new Error('Cannot rollback the initial migration.');
};
