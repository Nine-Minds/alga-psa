/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  const payloadSchema = {
    type: 'object',
    properties: {
      emailData: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          mailhogId: { type: 'string' },
          threadId: { type: 'string' },
          from: {
            type: 'object',
            properties: {
              email: { type: 'string', format: 'email' },
              name: { type: 'string' }
            },
            required: ['email']
          },
          to: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                email: { type: 'string', format: 'email' },
                name: { type: 'string' }
              },
              required: ['email']
            }
          },
          cc: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                email: { type: 'string', format: 'email' },
                name: { type: 'string' }
              },
              required: ['email']
            }
          },
          bcc: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                email: { type: 'string', format: 'email' },
                name: { type: 'string' }
              },
              required: ['email']
            }
          },
          subject: { type: 'string' },
          body: {
            type: 'object',
            properties: {
              text: { type: 'string' },
              html: { type: 'string' }
            }
          },
          inReplyTo: { type: 'string' },
          references: { type: 'array', items: { type: 'string' } },
          attachments: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                contentType: { type: 'string' },
                size: { type: 'number' },
                contentId: { type: 'string' }
              },
              required: ['id', 'name', 'contentType', 'size']
            }
          },
          receivedAt: { type: 'string' },
          tenant: { type: 'string' },
          providerId: { type: 'string' }
        },
        required: ['id', 'from', 'subject', 'body']
      },
      providerId: { type: 'string' },
      tenantId: { type: 'string' }
    },
    required: ['emailData', 'providerId', 'tenantId']
  };

  // Use literal timestamp for Citus compatibility (CURRENT_TIMESTAMP is not IMMUTABLE)
  const now = new Date().toISOString();

  if (await knex.schema.hasTable('system_event_catalog')) {
    await knex('system_event_catalog')
      .insert({
        event_type: 'INBOUND_EMAIL_RECEIVED',
        name: 'Inbound Email Received',
        description: 'Triggered when an inbound email is received and normalized for workflow processing',
        category: 'Email Processing',
        payload_schema: payloadSchema,
        created_at: now,
        updated_at: now
      })
      .onConflict('event_type')
      .merge({
        name: 'Inbound Email Received',
        description: 'Triggered when an inbound email is received and normalized for workflow processing',
        category: 'Email Processing',
        payload_schema: payloadSchema,
        updated_at: now
      });
  }

  if (await knex.schema.hasTable('event_catalog')) {
    await knex('event_catalog')
      .where({ event_type: 'INBOUND_EMAIL_RECEIVED' })
      .update({
        payload_schema: payloadSchema,
        updated_at: now
      });
  }
};

exports.down = async function () {};
