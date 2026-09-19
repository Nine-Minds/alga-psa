/**
 * Create email system tables for outbound email abstraction
 */

exports.up = async function(knex) {
  // Create tenant email settings table
  await knex.schema.createTable('tenant_email_settings', function(table) {
    table.increments('id').primary();
    table.string('tenant_id').notNullable();
    table.string('default_from_domain');
    table.json('custom_domains').defaultTo('[]');
    table.enum('email_provider', ['smtp', 'resend', 'hybrid']).defaultTo('smtp');
    table.json('provider_configs').defaultTo('[]');
    table.boolean('fallback_enabled').defaultTo(true);
    table.boolean('tracking_enabled').defaultTo(false);
    table.integer('max_daily_emails');
    table.timestamps(true, true);
    
    // Indexes
    table.index('tenant_id');
    table.unique('tenant_id');
  });

  // Create email domains table for custom domain management
  await knex.schema.createTable('email_domains', function(table) {
    table.increments('id').primary();
    table.string('tenant_id').notNullable();
    table.string('domain_name').notNullable();
    table.enum('status', ['pending', 'verified', 'failed']).defaultTo('pending');
    table.string('provider_id'); // Which provider manages this domain
    table.string('provider_domain_id'); // Domain ID in the provider's system
    table.json('dns_records'); // Required DNS records
    table.text('verification_token');
    table.timestamp('verified_at');
    table.text('failure_reason');
    table.json('metadata'); // Additional provider-specific data
    table.timestamps(true, true);
    
    // Indexes
    table.index('tenant_id');
    table.index(['tenant_id', 'domain_name']);
    table.index('status');
    table.unique(['tenant_id', 'domain_name']);
  });

  // Create email sending logs table for tracking and analytics
  await knex.schema.createTable('email_sending_logs', function(table) {
    table.increments('id').primary();
    table.string('tenant_id').notNullable();
    table.string('message_id'); // Provider's message ID
    table.string('provider_id').notNullable();
    table.string('provider_type').notNullable();
    table.string('from_address').notNullable();
    table.json('to_addresses').notNullable();
    table.json('cc_addresses');
    table.json('bcc_addresses');
    table.string('subject');
    table.enum('status', ['sent', 'failed', 'bounced', 'delivered', 'opened', 'clicked']).notNullable();
    table.text('error_message');
    table.json('metadata'); // Provider-specific response data
    table.timestamp('sent_at').notNullable();
    table.timestamp('delivered_at');
    table.timestamp('opened_at');
    table.timestamp('clicked_at');
    table.timestamps(true, true);
    
    // Indexes
    table.index('tenant_id');
    table.index(['tenant_id', 'sent_at']);
    table.index('provider_id');
    table.index('status');
    table.index('message_id');
  });

  // Create email provider health table for monitoring
  await knex.schema.createTable('email_provider_health', function(table) {
    table.increments('id').primary();
    table.string('tenant_id').notNullable();
    table.string('provider_id').notNullable();
    table.string('provider_type').notNullable();
    table.boolean('is_healthy').defaultTo(true);
    table.text('health_details');
    table.integer('success_count').defaultTo(0);
    table.integer('failure_count').defaultTo(0);
    table.integer('consecutive_failures').defaultTo(0);
    table.timestamp('last_success_at');
    table.timestamp('last_failure_at');
    table.timestamp('last_health_check_at').defaultTo(knex.fn.now());
    table.timestamps(true, true);
    
    // Indexes
    table.index('tenant_id');
    table.index(['tenant_id', 'provider_id']);
    table.index('is_healthy');
    table.unique(['tenant_id', 'provider_id']);
  });

  // Create email templates table for customizable email templates
  await knex.schema.createTable('email_templates', function(table) {
    table.increments('id').primary();
    table.string('tenant_id').notNullable();
    table.string('template_name').notNullable();
    table.string('template_type').notNullable(); // e.g., 'invoice', 'notification', 'marketing'
    table.string('subject_template').notNullable();
    table.text('html_template');
    table.text('text_template');
    table.json('default_variables'); // Default template variables
    table.boolean('is_active').defaultTo(true);
    table.string('created_by');
    table.timestamps(true, true);
    
    // Indexes
    table.index('tenant_id');
    table.index(['tenant_id', 'template_name']);
    table.index(['tenant_id', 'template_type']);
    table.unique(['tenant_id', 'template_name']);
  });

  // Create email rate limits table for tracking usage
  await knex.schema.createTable('email_rate_limits', function(table) {
    table.increments('id').primary();
    table.string('tenant_id').notNullable();
    table.string('provider_id').notNullable();
    table.date('limit_date').notNullable();
    table.integer('emails_sent').defaultTo(0);
    table.integer('daily_limit');
    table.integer('hourly_limit');
    table.json('hourly_usage'); // Track usage by hour
    table.timestamps(true, true);
    
    // Indexes
    table.index('tenant_id');
    table.index(['tenant_id', 'limit_date']);
    table.index(['tenant_id', 'provider_id', 'limit_date']);
    table.unique(['tenant_id', 'provider_id', 'limit_date']);
  });

  console.log('Created email system tables');
};

exports.down = async function(knex) {
  // Drop tables in reverse order to handle foreign key dependencies
  await knex.schema.dropTableIfExists('email_rate_limits');
  await knex.schema.dropTableIfExists('email_templates');
  await knex.schema.dropTableIfExists('email_provider_health');
  await knex.schema.dropTableIfExists('email_sending_logs');
  await knex.schema.dropTableIfExists('email_domains');
  await knex.schema.dropTableIfExists('tenant_email_settings');
  
  console.log('Dropped email system tables');
};