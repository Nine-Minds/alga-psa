/**
 * Create calendar_provider_health table for tracking webhook subscription health
 */

exports.up = async function(knex) {
  const tableName = 'calendar_provider_health';
  const exists = await knex.schema.hasTable(tableName);

  if (!exists) {
    await knex.schema.createTable(tableName, function(table) {
      table.uuid('calendar_provider_id').notNullable();
      table.uuid('tenant').notNullable();
      
      // Subscription health tracking
      table.string('subscription_status'); // enum: healthy, renewing, error
      table.timestamp('subscription_expires_at');
      table.timestamp('last_renewal_attempt_at');
      table.string('last_renewal_result'); // success, failure
      table.text('failure_reason');
      table.timestamp('last_webhook_received_at');
      
      // Failure tracking for threshold detection
      table.integer('consecutive_failure_count').defaultTo(0);
      
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
      
      table.primary(['calendar_provider_id', 'tenant']);
      // Use composite foreign key since calendar_providers has composite primary key (id, tenant)
      table.foreign(['calendar_provider_id', 'tenant']).references(['id', 'tenant']).inTable('calendar_providers').onDelete('CASCADE');
    });
    
    // Add indexes for monitoring
    await knex.schema.raw(`
      CREATE INDEX idx_calendar_provider_health_tenant_status 
      ON calendar_provider_health (tenant, subscription_status)
    `);
    
    await knex.schema.raw(`
      CREATE INDEX idx_calendar_provider_health_provider_tenant 
      ON calendar_provider_health (calendar_provider_id, tenant)
    `);
    
    await knex.schema.raw(`
      CREATE INDEX idx_calendar_provider_health_expires_at 
      ON calendar_provider_health (subscription_expires_at)
    `);
  }
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('calendar_provider_health');
};

