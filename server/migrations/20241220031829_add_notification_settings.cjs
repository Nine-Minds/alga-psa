/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema
    // Drop existing tables if they exist
    .dropTableIfExists('notification_logs')
    .dropTableIfExists('user_notification_preferences')
    .dropTableIfExists('tenant_email_templates')
    .dropTableIfExists('system_email_templates')
    .dropTableIfExists('notification_subtypes')
    .dropTableIfExists('notification_categories')
    .dropTableIfExists('notification_settings')
    
    // Global notification settings
    .createTable('notification_settings', table => {
      table.increments('id').primary();
      table.uuid('tenant').notNullable();
      table.boolean('is_enabled').notNullable().defaultTo(true);
      table.integer('rate_limit_per_minute').notNullable().defaultTo(60);
      table.timestamps(true, true);
      
      table.foreign('tenant').references('tenant').inTable('tenants').onDelete('CASCADE');
    })

    // System-wide notification categories (no RLS)
    .createTable('notification_categories', table => {
      table.increments('id').primary();
      table.string('name').notNullable();
      table.string('description');
      table.boolean('is_enabled').notNullable().defaultTo(true);
      table.boolean('is_default_enabled').notNullable().defaultTo(true);
      table.timestamps(true, true);

      table.unique(['name']);
    })

    // System-wide notification subtypes (no RLS)
    .createTable('notification_subtypes', table => {
      table.increments('id').primary();
      table.integer('category_id').notNullable();
      table.string('name').notNullable();
      table.string('description');
      table.boolean('is_enabled').notNullable().defaultTo(true);
      table.boolean('is_default_enabled').notNullable().defaultTo(true);
      table.timestamps(true, true);

      table.foreign('category_id').references('id').inTable('notification_categories').onDelete('CASCADE');
      table.unique(['category_id', 'name']);
    })

    // System-wide default email templates (no RLS)
    .createTable('system_email_templates', table => {
      table.increments('id').primary();
      table.string('name').notNullable();
      table.text('subject').notNullable();
      table.text('html_content').notNullable();
      table.text('text_content').notNullable();
      table.integer('notification_subtype_id').notNullable();
      table.timestamps(true, true);

      table.foreign('notification_subtype_id')
        .references('id')
        .inTable('notification_subtypes')
        .onDelete('CASCADE');

      table.unique(['name']);
    })

    // Tenant-specific email templates (with RLS)
    .createTable('tenant_email_templates', table => {
      table.increments('id').primary();
      table.uuid('tenant').notNullable();
      table.string('name').notNullable();
      table.text('subject').notNullable();
      table.text('html_content').notNullable();
      table.text('text_content').notNullable();
      table.integer('system_template_id')
        .references('id')
        .inTable('system_email_templates')
        .onDelete('SET NULL');
      table.timestamps(true, true);

      table.foreign('tenant').references('tenant').inTable('tenants').onDelete('CASCADE');
      table.unique(['tenant', 'name']);
    })
    .raw(`
      ALTER TABLE tenant_email_templates ENABLE ROW LEVEL SECURITY;
      
      CREATE POLICY tenant_isolation_policy ON tenant_email_templates
        USING (tenant = current_setting('app.current_tenant')::uuid)
        WITH CHECK (tenant = current_setting('app.current_tenant')::uuid);
    `)

    // Tenant-specific user notification preferences (with RLS)
    .createTable('user_notification_preferences', table => {
      table.increments('id').primary();
      table.uuid('tenant').notNullable();
      table.uuid('user_id').notNullable();
      table.integer('subtype_id').notNullable();
      table.boolean('is_enabled').notNullable().defaultTo(true);
      table.string('email_address'); // Optional alternate email
      table.enum('frequency', ['realtime', 'daily', 'weekly']).notNullable().defaultTo('realtime');
      table.timestamps(true, true);

      table.foreign(['tenant', 'user_id']).references(['tenant', 'user_id']).inTable('users').onDelete('CASCADE');
      table.foreign('subtype_id').references('id').inTable('notification_subtypes').onDelete('CASCADE');
      table.unique(['tenant', 'user_id', 'subtype_id']);
    })

    // Notification logs (with RLS)
    .createTable('notification_logs', table => {
      table.increments('id').primary();
      table.uuid('tenant').notNullable();
      table.uuid('user_id').notNullable();
      table.integer('subtype_id').notNullable();
      table.string('email_address').notNullable();
      table.text('subject').notNullable();
      table.enum('status', ['sent', 'failed', 'bounced']).notNullable();
      table.text('error_message');
      table.timestamps(true, true);

      table.foreign(['tenant', 'user_id']).references(['tenant', 'user_id']).inTable('users').onDelete('CASCADE');
      table.foreign('subtype_id').references('id').inTable('notification_subtypes').onDelete('CASCADE');
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('notification_logs')
    .dropTableIfExists('user_notification_preferences')
    .dropTableIfExists('notification_subtypes')
    .dropTableIfExists('notification_categories')
    .raw(`
      DROP POLICY IF EXISTS tenant_isolation_policy ON tenant_email_templates;
      ALTER TABLE tenant_email_templates DISABLE ROW LEVEL SECURITY;
    `)
    .dropTableIfExists('tenant_email_templates')
    .dropTableIfExists('system_email_templates')
    .dropTableIfExists('notification_settings');
};
