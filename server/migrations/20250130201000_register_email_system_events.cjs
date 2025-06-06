/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Create the system_event_catalog table if it doesn't exist
  const tableExists = await knex.schema.hasTable('system_event_catalog');
  if (!tableExists) {
    await knex.schema.createTable('system_event_catalog', (table) => {
      table.uuid('event_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.string('event_type', 255).notNullable().unique();
      table.string('name', 255).notNullable();
      table.text('description');
      table.string('category', 100);
      table.jsonb('payload_schema'); // Store JSON schema for payload validation
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });

    // Add indexes
    await knex.schema.alterTable('system_event_catalog', (table) => {
      table.index('event_type');
      table.index('category');
    });

    // Add trigger for updated_at
    await knex.raw(`
      CREATE OR REPLACE FUNCTION trigger_set_timestamp()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER set_timestamp
      BEFORE UPDATE ON system_event_catalog
      FOR EACH ROW
      EXECUTE FUNCTION trigger_set_timestamp();
    `);

    console.log('✅ Created system_event_catalog table');
  }

  // Register email events in the system event catalog
  await knex('system_event_catalog').insert([
    {
      event_id: knex.raw('gen_random_uuid()'),
      event_type: 'INBOUND_EMAIL_RECEIVED',
      name: 'Inbound Email Received',
      description: 'Triggered when an email is received from a configured email provider',
      category: 'Email Processing',
      payload_schema: JSON.stringify({
        type: 'object',
        properties: {
          emailId: {
            type: 'string',
            description: 'Unique identifier for the email message'
          },
          providerId: {
            type: 'string',
            format: 'uuid',
            description: 'UUID of the email provider configuration'
          },
          tenant: {
            type: 'string',
            format: 'uuid',
            description: 'Tenant UUID for multi-tenancy'
          },
          emailData: {
            type: 'object',
            description: 'Complete email message data including headers, body, and attachments',
            properties: {
              id: { type: 'string' },
              provider: { type: 'string', enum: ['microsoft', 'google'] },
              receivedAt: { type: 'string', format: 'date-time' },
              from: { 
                type: 'object',
                properties: {
                  email: { type: 'string', format: 'email' },
                  name: { type: 'string' }
                },
                required: ['email']
              },
              subject: { type: 'string' },
              body: {
                type: 'object',
                properties: {
                  text: { type: 'string' },
                  html: { type: 'string' }
                },
                required: ['text']
              },
              threadId: { type: 'string' },
              inReplyTo: { type: 'string' },
              references: {
                type: 'array',
                items: { type: 'string' }
              }
            },
            required: ['id', 'provider', 'receivedAt', 'from', 'subject', 'body']
          },
          matchedClient: {
            type: 'object',
            description: 'Client information if email sender was matched to existing client',
            properties: {
              companyId: { type: 'string', format: 'uuid' },
              companyName: { type: 'string' },
              contactId: { type: 'string', format: 'uuid' },
              contactName: { type: 'string' }
            }
          }
        },
        required: ['emailId', 'providerId', 'tenant', 'emailData']
      })
    },
    {
      event_id: knex.raw('gen_random_uuid()'),
      event_type: 'EMAIL_PROVIDER_CONNECTED',
      name: 'Email Provider Connected',
      description: 'Triggered when an email provider is successfully connected and configured',
      category: 'Email Processing',
      payload_schema: JSON.stringify({
        type: 'object',
        properties: {
          providerId: {
            type: 'string',
            format: 'uuid',
            description: 'UUID of the email provider configuration'
          },
          tenant: {
            type: 'string',
            format: 'uuid',
            description: 'Tenant UUID for multi-tenancy'
          },
          providerType: {
            type: 'string',
            enum: ['microsoft', 'google'],
            description: 'Type of email provider'
          },
          providerName: {
            type: 'string',
            description: 'Human-readable name of the provider configuration'
          },
          mailbox: {
            type: 'string',
            format: 'email',
            description: 'Email address being monitored'
          },
          connectedAt: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when connection was established'
          }
        },
        required: ['providerId', 'tenant', 'providerType', 'providerName', 'mailbox', 'connectedAt']
      })
    },
    {
      event_id: knex.raw('gen_random_uuid()'),
      event_type: 'EMAIL_PROVIDER_DISCONNECTED',
      name: 'Email Provider Disconnected',
      description: 'Triggered when an email provider is disconnected or deactivated',
      category: 'Email Processing',
      payload_schema: JSON.stringify({
        type: 'object',
        properties: {
          providerId: {
            type: 'string',
            format: 'uuid',
            description: 'UUID of the email provider configuration'
          },
          tenant: {
            type: 'string',
            format: 'uuid',
            description: 'Tenant UUID for multi-tenancy'
          },
          providerType: {
            type: 'string',
            enum: ['microsoft', 'google'],
            description: 'Type of email provider'
          },
          providerName: {
            type: 'string',
            description: 'Human-readable name of the provider configuration'
          },
          disconnectedAt: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when disconnection occurred'
          },
          reason: {
            type: 'string',
            description: 'Reason for disconnection (manual, error, token_expired, etc.)'
          }
        },
        required: ['providerId', 'tenant', 'providerType', 'providerName', 'disconnectedAt']
      })
    }
  ]);

  console.log('✅ Registered email system events in event catalog');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Remove email events from system event catalog
  await knex('system_event_catalog').whereIn('event_type', [
    'INBOUND_EMAIL_RECEIVED',
    'EMAIL_PROVIDER_CONNECTED', 
    'EMAIL_PROVIDER_DISCONNECTED'
  ]).del();

  console.log('✅ Removed email system events from event catalog');
};