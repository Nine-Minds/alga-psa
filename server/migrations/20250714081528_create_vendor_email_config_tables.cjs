/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> } */
exports.up = async function(knex) {
   //Create microsoft_email_provider_config table
  await knex.schema.createTable('microsoft_email_provider_config', function(table) {
    // Foreign key to email_providers
    table.uuid('email_provider_id').notNullable();
    table.uuid('tenant').notNullable();
    
     //OAuth configuration
    table.string('client_id', 255).notNullable();
    table.text('client_secret').notNullable(); // Encrypted in practice
    table.string('tenant_id', 255).notNullable(); // Microsoft tenant ID
    table.text('redirect_uri').notNullable();
    
     //Processing configuration
    table.boolean('auto_process_emails').defaultTo(true);
    table.integer('max_emails_per_sync').defaultTo(50);
    
     //Folder filters (as a comma-separated string or JSON array)
    table.jsonb('folder_filters').defaultTo('[]'); // Array of folder names to monitor
    
     //OAuth tokens (encrypted in practice)
    table.text('access_token').nullable();
    table.text('refresh_token').nullable();
    table.timestamp('token_expires_at').nullable();
    
    //Timestamps
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    
     //Primary key
    table.primary(['email_provider_id', 'tenant']);
    
     // Foreign keys removed - CitusDB does not support FK constraints between distributed tables
    // Referential integrity enforced in application logic instead
    // table.foreign(['email_provider_id', 'tenant'])
    //   .references(['id', 'tenant'])
    //   .inTable('email_providers')
    //   .onDelete('CASCADE');
  });

   //Create google_email_provider_config table
  await knex.schema.createTable('google_email_provider_config', function(table) {
     //Foreign key to email_providers
    table.uuid('email_provider_id').notNullable();
    table.uuid('tenant').notNullable();
    
     //OAuth configuration
    table.string('client_id', 255).notNullable();
    table.text('client_secret').notNullable(); // Encrypted in practice
    table.string('project_id', 255).notNullable();
    table.text('redirect_uri').notNullable();
    
     //Pub/Sub configuration for push notifications
    table.string('pubsub_topic_name', 255).nullable();
    table.string('pubsub_subscription_name', 255).nullable();
    
     //Processing configuration
    table.boolean('auto_process_emails').defaultTo(true);
    table.integer('max_emails_per_sync').defaultTo(50);
    
   // Label filters (as JSON array)
    table.jsonb('label_filters').defaultTo('[]'); // Array of label names to monitor
    
     //OAuth tokens (encrypted in practice)
    table.text('access_token').nullable();
    table.text('refresh_token').nullable();
    table.timestamp('token_expires_at').nullable();
    
    //Gmail watch configuration
    table.string('history_id', 255).nullable(); // For incremental sync
    table.timestamp('watch_expiration').nullable();
    
     //Timestamps
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    
    //Primary key
    table.primary(['email_provider_id', 'tenant']);
    
     // Foreign keys removed - CitusDB does not support FK constraints between distributed tables
    // Referential integrity enforced in application logic instead
    // table.foreign(['email_provider_id', 'tenant'])
    //   .references(['id', 'tenant'])
    //   .inTable('email_providers')
    //   .onDelete('CASCADE');
  });

   //Create indexes
  await knex.schema.raw(`
    CREATE INDEX idx_microsoft_email_config_tenant 
    ON microsoft_email_provider_config (tenant)
  `);

  await knex.schema.raw(`
    CREATE INDEX idx_google_email_config_tenant
    ON google_email_provider_config (tenant)
  `);

  // Create compound indexes for typical lookup paths
  await knex.schema.raw(`
    CREATE INDEX idx_microsoft_email_config_tenant_provider
    ON microsoft_email_provider_config (tenant, email_provider_id)
  `);

  await knex.schema.raw(`
    CREATE INDEX idx_google_email_config_tenant_provider
    ON google_email_provider_config (tenant, email_provider_id)
  `);

  // Create distributed tables for CitusDB
  await knex.raw("SELECT create_distributed_table('microsoft_email_provider_config', 'tenant')");
  await knex.raw("SELECT create_distributed_table('google_email_provider_config', 'tenant')");

  console.log('✅ Created vendor-specific email configuration tables');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('google_email_provider_config');
  await knex.schema.dropTableIfExists('microsoft_email_provider_config');
  console.log('✅ Dropped vendor-specific email configuration tables');
};

// Disable transaction for Citus DB compatibility
// create_distributed_table cannot run inside a transaction block
exports.config = { transaction: false };