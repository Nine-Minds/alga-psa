import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { Knex } from 'knex';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';

describe('Outbound Message-ID Storage', () => {
  let knex: Knex;
  let testTenant: string;
  let testClientId: string;
  const cleanup: (() => Promise<void>)[] = [];

  beforeAll(async () => {
    // Create test database with migrations and seeds
    knex = await createTestDbConnection();

    // Get the tenant that was created by seeds
    const tenant = await knex('tenants').first('tenant');
    if (!tenant) {
      throw new Error('No tenant found in database after seeds');
    }
    testTenant = tenant.tenant;

    // Get or create a test client
    const client = await knex('clients').where({ tenant: testTenant }).first('client_id');
    if (!client) {
      throw new Error('No client found in database after seeds');
    }
    testClientId = client.client_id;
  });

  afterAll(async () => {
    if (knex) {
      await knex.destroy();
    }
  });

  afterEach(async () => {
    for (const cleanupFn of cleanup.reverse()) {
      await cleanupFn();
    }
    cleanup.length = 0;
  });

  describe('Message-ID References Storage', () => {
    it('should store outbound Message-ID in ticket email_metadata references array', async () => {
      // Create a test ticket
      const ticketId = uuidv4();
      await knex('tickets').insert({
        tenant: testTenant,
        ticket_id: ticketId,
        ticket_number: `#${Date.now()}`,
        client_id: testClientId,
        title: 'Test Ticket for Message-ID',
        email_metadata: { references: [] },
        entered_at: new Date(),
        updated_at: new Date()
      });
      cleanup.push(async () => {
        await knex('tickets').where({ tenant: testTenant, ticket_id: ticketId }).del();
      });

      // Simulate storing an outbound Message-ID
      // This is what sendEventEmail() does at line 412-442
      const outboundMessageId = `<outbound-${Date.now()}@alga-psa.example.com>`;

      await knex('tickets')
        .where({ tenant: testTenant, ticket_id: ticketId })
        .update({
          email_metadata: knex.raw(
            `jsonb_set(
              COALESCE(email_metadata, '{}'::jsonb),
              '{references}',
              (COALESCE(email_metadata->'references', '[]'::jsonb) || to_jsonb(?::text))
            )`,
            [outboundMessageId]
          ),
          updated_at: new Date()
        });

      // Verify the Message-ID was stored
      const updatedTicket = await knex('tickets')
        .where({ tenant: testTenant, ticket_id: ticketId })
        .first();

      expect(updatedTicket).toBeDefined();
      expect(updatedTicket.email_metadata).toBeDefined();
      expect(updatedTicket.email_metadata.references).toBeDefined();
      expect(Array.isArray(updatedTicket.email_metadata.references)).toBe(true);
      expect(updatedTicket.email_metadata.references).toContain(outboundMessageId);
      expect(updatedTicket.email_metadata.references).toHaveLength(1);
    });

    it('should append multiple Message-IDs to references array', async () => {
      const ticketId = uuidv4();
      await knex('tickets').insert({
        tenant: testTenant,
        ticket_id: ticketId,
        ticket_number: `#${Date.now()}`,
        client_id: testClientId,
        title: 'Multi Message-ID Test',
        email_metadata: { references: [] },
        entered_at: new Date(),
        updated_at: new Date()
      });
      cleanup.push(async () => {
        await knex('tickets').where({ tenant: testTenant, ticket_id: ticketId }).del();
      });

      // Store first outbound Message-ID
      const messageId1 = `<msg1-${Date.now()}@alga-psa.example.com>`;
      await knex('tickets')
        .where({ tenant: testTenant, ticket_id: ticketId })
        .update({
          email_metadata: knex.raw(
            `jsonb_set(
              COALESCE(email_metadata, '{}'::jsonb),
              '{references}',
              (COALESCE(email_metadata->'references', '[]'::jsonb) || to_jsonb(?::text))
            )`,
            [messageId1]
          )
        });

      // Store second outbound Message-ID
      const messageId2 = `<msg2-${Date.now() + 1}@alga-psa.example.com>`;
      await knex('tickets')
        .where({ tenant: testTenant, ticket_id: ticketId })
        .update({
          email_metadata: knex.raw(
            `jsonb_set(
              COALESCE(email_metadata, '{}'::jsonb),
              '{references}',
              (COALESCE(email_metadata->'references', '[]'::jsonb) || to_jsonb(?::text))
            )`,
            [messageId2]
          )
        });

      // Store third outbound Message-ID
      const messageId3 = `<msg3-${Date.now() + 2}@alga-psa.example.com>`;
      await knex('tickets')
        .where({ tenant: testTenant, ticket_id: ticketId })
        .update({
          email_metadata: knex.raw(
            `jsonb_set(
              COALESCE(email_metadata, '{}'::jsonb),
              '{references}',
              (COALESCE(email_metadata->'references', '[]'::jsonb) || to_jsonb(?::text))
            )`,
            [messageId3]
          )
        });

      const updatedTicket = await knex('tickets')
        .where({ tenant: testTenant, ticket_id: ticketId })
        .first();

      expect(updatedTicket.email_metadata.references).toHaveLength(3);
      expect(updatedTicket.email_metadata.references).toContain(messageId1);
      expect(updatedTicket.email_metadata.references).toContain(messageId2);
      expect(updatedTicket.email_metadata.references).toContain(messageId3);
      // Verify order is preserved (JSONB array maintains order)
      expect(updatedTicket.email_metadata.references[0]).toBe(messageId1);
      expect(updatedTicket.email_metadata.references[1]).toBe(messageId2);
      expect(updatedTicket.email_metadata.references[2]).toBe(messageId3);
    });

    it('should initialize empty references array if email_metadata is null', async () => {
      const ticketId = uuidv4();
      await knex('tickets').insert({
        tenant: testTenant,
        ticket_id: ticketId,
        ticket_number: `#${Date.now()}`,
        client_id: testClientId,
        title: 'Null Metadata Test',
        email_metadata: null, // Start with null
        entered_at: new Date(),
        updated_at: new Date()
      });
      cleanup.push(async () => {
        await knex('tickets').where({ tenant: testTenant, ticket_id: ticketId }).del();
      });

      const messageId = `<init-${Date.now()}@alga-psa.example.com>`;
      await knex('tickets')
        .where({ tenant: testTenant, ticket_id: ticketId })
        .update({
          email_metadata: knex.raw(
            `jsonb_set(
              COALESCE(email_metadata, '{}'::jsonb),
              '{references}',
              (COALESCE(email_metadata->'references', '[]'::jsonb) || to_jsonb(?::text))
            )`,
            [messageId]
          )
        });

      const updatedTicket = await knex('tickets')
        .where({ tenant: testTenant, ticket_id: ticketId })
        .first();

      expect(updatedTicket.email_metadata).toBeDefined();
      expect(updatedTicket.email_metadata).not.toBeNull();
      expect(updatedTicket.email_metadata.references).toHaveLength(1);
      expect(updatedTicket.email_metadata.references[0]).toBe(messageId);
    });

    it('should preserve existing email_metadata fields when adding references', async () => {
      const ticketId = uuidv4();
      const originalMessageId = `<original-${Date.now()}@customer.com>`;
      const threadId = `thread-${uuidv4()}`;

      await knex('tickets').insert({
        tenant: testTenant,
        ticket_id: ticketId,
        ticket_number: `#${Date.now()}`,
        client_id: testClientId,
        title: 'Preserve Metadata Test',
        email_metadata: {
          messageId: originalMessageId,
          threadId: threadId,
          from: 'customer@example.com',
          subject: 'Original Subject',
          references: []
        },
        entered_at: new Date(),
        updated_at: new Date()
      });
      cleanup.push(async () => {
        await knex('tickets').where({ tenant: testTenant, ticket_id: ticketId }).del();
      });

      const outboundMessageId = `<outbound-${Date.now()}@alga-psa.example.com>`;
      await knex('tickets')
        .where({ tenant: testTenant, ticket_id: ticketId })
        .update({
          email_metadata: knex.raw(
            `jsonb_set(
              COALESCE(email_metadata, '{}'::jsonb),
              '{references}',
              (COALESCE(email_metadata->'references', '[]'::jsonb) || to_jsonb(?::text))
            )`,
            [outboundMessageId]
          )
        });

      const updatedTicket = await knex('tickets')
        .where({ tenant: testTenant, ticket_id: ticketId })
        .first();

      // All original fields should still exist
      expect(updatedTicket.email_metadata.messageId).toBe(originalMessageId);
      expect(updatedTicket.email_metadata.threadId).toBe(threadId);
      expect(updatedTicket.email_metadata.from).toBe('customer@example.com');
      expect(updatedTicket.email_metadata.subject).toBe('Original Subject');

      // New references array should include the outbound Message-ID
      expect(updatedTicket.email_metadata.references).toContain(outboundMessageId);
    });

    it('should handle Message-ID format variations correctly', async () => {
      const ticketId = uuidv4();
      await knex('tickets').insert({
        tenant: testTenant,
        ticket_id: ticketId,
        ticket_number: `#${Date.now()}`,
        client_id: testClientId,
        title: 'Message-ID Format Test',
        email_metadata: { references: [] },
        entered_at: new Date(),
        updated_at: new Date()
      });
      cleanup.push(async () => {
        await knex('tickets').where({ tenant: testTenant, ticket_id: ticketId }).del();
      });

      // Test various Message-ID formats
      const messageIds = [
        `<${uuidv4()}@alga-psa.example.com>`, // Standard format with angle brackets
        `<CAF+=${uuidv4()}@mail.gmail.com>`, // Gmail style
        `<${Date.now()}.${uuidv4()}@mx.microsoft.com>`, // Microsoft style
        `<${uuidv4()}@resend.com>`, // Resend format
      ];

      for (const msgId of messageIds) {
        await knex('tickets')
          .where({ tenant: testTenant, ticket_id: ticketId })
          .update({
            email_metadata: knex.raw(
              `jsonb_set(
                COALESCE(email_metadata, '{}'::jsonb),
                '{references}',
                (COALESCE(email_metadata->'references', '[]'::jsonb) || to_jsonb(?::text))
              )`,
              [msgId]
            )
          });
      }

      const updatedTicket = await knex('tickets')
        .where({ tenant: testTenant, ticket_id: ticketId })
        .first();

      expect(updatedTicket.email_metadata.references).toHaveLength(messageIds.length);
      for (const msgId of messageIds) {
        expect(updatedTicket.email_metadata.references).toContain(msgId);
      }
    });
  });

  describe('Message-ID Storage Integration', () => {
    it('should support full email conversation thread via references', async () => {
      // Simulate a multi-email conversation:
      // 1. Customer sends initial email -> Creates ticket with inbound messageId
      // 2. Agent replies -> Stores outbound Message-ID in references
      // 3. Customer replies -> Can be threaded via In-Reply-To matching references
      // 4. Agent replies again -> Adds another Message-ID to references

      const ticketId = uuidv4();
      const inboundMessageId = `<customer-initial-${Date.now()}@customer.com>`;

      // Step 1: Ticket created from inbound email
      await knex('tickets').insert({
        tenant: testTenant,
        ticket_id: ticketId,
        ticket_number: `#${Date.now()}`,
        client_id: testClientId,
        title: 'Customer Question',
        email_metadata: {
          messageId: inboundMessageId,
          from: 'customer@example.com',
          references: []
        },
        entered_at: new Date(),
        updated_at: new Date()
      });
      cleanup.push(async () => {
        await knex('tickets').where({ tenant: testTenant, ticket_id: ticketId }).del();
      });

      // Step 2: Agent sends first reply
      const agentReply1MessageId = `<agent-reply-1-${Date.now()}@alga-psa.example.com>`;
      await knex('tickets')
        .where({ tenant: testTenant, ticket_id: ticketId })
        .update({
          email_metadata: knex.raw(
            `jsonb_set(
              COALESCE(email_metadata, '{}'::jsonb),
              '{references}',
              (COALESCE(email_metadata->'references', '[]'::jsonb) || to_jsonb(?::text))
            )`,
            [agentReply1MessageId]
          )
        });

      // Step 3: Customer sends follow-up (would match via In-Reply-To)
      // This would be detected by findTicketByEmailThread matching agentReply1MessageId

      // Step 4: Agent sends second reply
      const agentReply2MessageId = `<agent-reply-2-${Date.now() + 1}@alga-psa.example.com>`;
      await knex('tickets')
        .where({ tenant: testTenant, ticket_id: ticketId })
        .update({
          email_metadata: knex.raw(
            `jsonb_set(
              COALESCE(email_metadata, '{}'::jsonb),
              '{references}',
              (COALESCE(email_metadata->'references', '[]'::jsonb) || to_jsonb(?::text))
            )`,
            [agentReply2MessageId]
          )
        });

      const finalTicket = await knex('tickets')
        .where({ tenant: testTenant, ticket_id: ticketId })
        .first();

      // Verify complete conversation thread is captured
      expect(finalTicket.email_metadata.messageId).toBe(inboundMessageId);
      expect(finalTicket.email_metadata.references).toHaveLength(2);
      expect(finalTicket.email_metadata.references).toContain(agentReply1MessageId);
      expect(finalTicket.email_metadata.references).toContain(agentReply2MessageId);

      console.log(`✅ Full conversation thread captured:
        - Initial inbound: ${inboundMessageId}
        - Agent reply 1: ${agentReply1MessageId}
        - Agent reply 2: ${agentReply2MessageId}
        - All Message-IDs stored for threading
      `);
    });
  });
});