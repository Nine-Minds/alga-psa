/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Create email_provider_configs table with real columns for common properties
  await knex.schema.createTable('email_provider_configs', (table) => {
    table.uuid('id').notNullable();
    table.uuid('tenant').notNullable();
    table.text('name').notNullable();
    table.text('provider_type').notNullable(); // 'microsoft' or 'google'
    table.text('mailbox').notNullable();
    table.text('folder_to_monitor').defaultTo('Inbox');
    table.boolean('active').defaultTo(true);
    
    // Common webhook fields as real columns
    table.text('webhook_notification_url');
    table.text('webhook_subscription_id');
    table.text('webhook_verification_token');
    table.timestamp('webhook_expires_at');
    table.timestamp('last_subscription_renewal');
    
    // OAuth/connection status fields
    table.text('connection_status').defaultTo('disconnected');
    table.timestamp('last_connection_test');
    table.text('connection_error_message');
    
    // Provider-specific configuration as JSONB (OAuth scopes, etc.)
    table.jsonb('provider_config');
    
    // Standard timestamps
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    
    // Primary key includes tenant for CitusDB compatibility
    table.primary(['id', 'tenant']);
    
    // Foreign key to tenants table
    table.foreign('tenant').references('tenant').inTable('tenants').onDelete('CASCADE');
    
    // Check constraints for enum values
    table.check('provider_type IN (\'microsoft\', \'google\')', [], 'email_provider_configs_provider_type_check');
    table.check('connection_status IN (\'connected\', \'disconnected\', \'error\')', [], 'email_provider_configs_connection_status_check');
  });

  // Create email_processed_messages table with real fields
  await knex.schema.createTable('email_processed_messages', (table) => {
    table.text('message_id').notNullable();
    table.uuid('provider_id').notNullable();
    table.uuid('tenant').notNullable();
    table.timestamp('processed_at').notNullable().defaultTo(knex.fn.now());
    table.text('processing_status').notNullable().defaultTo('success');
    table.uuid('ticket_id');
    table.uuid('workflow_execution_id');
    table.text('error_message');
    
    // Message metadata as real fields
    table.text('from_email');
    table.text('subject');
    table.timestamp('received_at');
    table.integer('attachment_count').defaultTo(0);
    
    // Additional metadata as JSONB if needed
    table.jsonb('metadata');
    
    // Primary key includes tenant for CitusDB compatibility
    table.primary(['message_id', 'provider_id', 'tenant']);
    
    // Foreign key to email_provider_configs
    table.foreign(['provider_id', 'tenant']).references(['id', 'tenant']).inTable('email_provider_configs').onDelete('CASCADE');
    
    // Foreign key to tenants table
    table.foreign('tenant').references('tenant').inTable('tenants').onDelete('CASCADE');
    
    // Check constraint for processing status
    table.check('processing_status IN (\'success\', \'failed\', \'partial\')', [], 'email_processed_messages_processing_status_check');
  });

  // Create indexes for common queries
  await knex.schema.raw(`
    CREATE INDEX idx_email_provider_configs_tenant_active 
    ON email_provider_configs (tenant, active) WHERE active = true
  `);

  await knex.schema.raw(`
    CREATE INDEX idx_email_processed_messages_tenant_processed_at 
    ON email_processed_messages (tenant, processed_at DESC)
  `);

  await knex.schema.raw(`
    CREATE INDEX idx_email_processed_messages_tenant_status 
    ON email_processed_messages (tenant, processing_status)
  `);

  console.log('✅ Created email provider tables');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('email_processed_messages');
  await knex.schema.dropTableIfExists('email_provider_configs');
  console.log('✅ Dropped email provider tables');
};