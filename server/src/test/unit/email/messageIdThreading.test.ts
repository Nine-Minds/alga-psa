import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { Knex } from 'knex';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { findTicketByEmailThread, type FindTicketByEmailThreadInput } from '@alga-psa/shared/workflow/actions/emailWorkflowActions';

describe('Message-ID Based Email Threading', () => {
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

  beforeEach(async () => {
    // Connection is already established in beforeAll
  });

  afterEach(async () => {
    for (const cleanupFn of cleanup.reverse()) {
      await cleanupFn();
    }
    cleanup.length = 0;
  });

  describe('findTicketByEmailThread - In-Reply-To Matching', () => {
    it('should find ticket by In-Reply-To header matching stored Message-ID', async () => {
      const ticketId = uuidv4();
      const originalMessageId = `<original-${Date.now()}@customer.com>`;

      // Create ticket with original inbound email's Message-ID
      await knex('tickets').insert({
        tenant: testTenant,
        ticket_id: ticketId,
        ticket_number: `#${Date.now()}`,
        client_id: testClientId,
        title: 'Original Customer Email',
        email_metadata: {
          messageId: originalMessageId,
          from: 'customer@example.com',
          subject: 'Help needed'
        },
        entered_at: new Date(),
        updated_at: new Date()
      });
      cleanup.push(async () => {
        await knex('tickets').where({ tenant: testTenant, ticket_id: ticketId }).del();
      });

      // Simulate inbound reply with In-Reply-To header
      const threadInput: FindTicketByEmailThreadInput = {
        inReplyTo: originalMessageId
      };

      const result = await findTicketByEmailThread(threadInput, testTenant);

      expect(result).not.toBeNull();
      expect(result!.ticketId).toBe(ticketId);
      expect(result!.originalEmailId).toBe(originalMessageId);
    });

    it('should find ticket by In-Reply-To matching outbound Message-ID in references', async () => {
      const ticketId = uuidv4();
      const outboundMessageId = `<outbound-${Date.now()}@alga-psa.example.com>`;

      // Create ticket and add outbound Message-ID to references
      await knex('tickets').insert({
        tenant: testTenant,
        ticket_id: ticketId,
        ticket_number: `#${Date.now()}`,
        client_id: testClientId,
        title: 'Ticket with Outbound Reply',
        email_metadata: {
          messageId: `<initial-${Date.now()}@customer.com>`,
          references: [outboundMessageId] // Agent sent a reply
        },
        entered_at: new Date(),
        updated_at: new Date()
      });
      cleanup.push(async () => {
        await knex('tickets').where({ tenant: testTenant, ticket_id: ticketId }).del();
      });

      // Customer replies to agent's email (In-Reply-To points to outbound Message-ID)
      const threadInput: FindTicketByEmailThreadInput = {
        inReplyTo: outboundMessageId
      };

      const result = await findTicketByEmailThread(threadInput, testTenant);

      expect(result).not.toBeNull();
      expect(result!.ticketId).toBe(ticketId);
    });
  });

  describe('findTicketByEmailThread - References Header Matching', () => {
    it('should find ticket by References header containing original Message-ID', async () => {
      const ticketId = uuidv4();
      const originalMessageId = `<original-${Date.now()}@customer.com>`;

      await knex('tickets').insert({
        tenant: testTenant,
        ticket_id: ticketId,
        ticket_number: `#${Date.now()}`,
        client_id: testClientId,
        title: 'Threading Test',
        email_metadata: {
          messageId: originalMessageId
        },
        entered_at: new Date(),
        updated_at: new Date()
      });
      cleanup.push(async () => {
        await knex('tickets').where({ tenant: testTenant, ticket_id: ticketId }).del();
      });

      // Inbound email has References header (typical for replies to replies)
      const threadInput: FindTicketByEmailThreadInput = {
        references: [
          originalMessageId,
          `<some-other-msg@example.com>`
        ]
      };

      const result = await findTicketByEmailThread(threadInput, testTenant);

      expect(result).not.toBeNull();
      expect(result!.ticketId).toBe(ticketId);
    });

    it('should find ticket by References matching any stored outbound Message-ID', async () => {
      const ticketId = uuidv4();
      const outboundMsg1 = `<outbound-1-${Date.now()}@alga-psa.example.com>`;
      const outboundMsg2 = `<outbound-2-${Date.now() + 1}@alga-psa.example.com>`;

      await knex('tickets').insert({
        tenant: testTenant,
        ticket_id: ticketId,
        ticket_number: `#${Date.now()}`,
        client_id: testClientId,
        title: 'Multi-Reply Ticket',
        email_metadata: {
          messageId: `<initial-${Date.now()}@customer.com>`,
          references: [outboundMsg1, outboundMsg2]
        },
        entered_at: new Date(),
        updated_at: new Date()
      });
      cleanup.push(async () => {
        await knex('tickets').where({ tenant: testTenant, ticket_id: ticketId }).del();
      });

      // Customer reply references the second outbound message
      const threadInput: FindTicketByEmailThreadInput = {
        references: [
          outboundMsg2, // Should match this
          `<unrelated-msg@example.com>`
        ]
      };

      const result = await findTicketByEmailThread(threadInput, testTenant);

      expect(result).not.toBeNull();
      expect(result!.ticketId).toBe(ticketId);
    });
  });

  describe('findTicketByEmailThread - Thread ID Matching', () => {
    it('should find ticket by Gmail/Provider thread ID', async () => {
      const ticketId = uuidv4();
      const threadId = `thread-${uuidv4()}`;

      await knex('tickets').insert({
        tenant: testTenant,
        ticket_id: ticketId,
        ticket_number: `#${Date.now()}`,
        client_id: testClientId,
        title: 'Gmail Thread Test',
        email_metadata: {
          threadId: threadId,
          messageId: `<msg-${Date.now()}@mail.gmail.com>`
        },
        entered_at: new Date(),
        updated_at: new Date()
      });
      cleanup.push(async () => {
        await knex('tickets').where({ tenant: testTenant, ticket_id: ticketId }).del();
      });

      const threadInput: FindTicketByEmailThreadInput = {
        threadId: threadId
      };

      const result = await findTicketByEmailThread(threadInput, testTenant);

      expect(result).not.toBeNull();
      expect(result!.ticketId).toBe(ticketId);
      expect(result!.threadInfo?.threadId).toBe(threadId);
    });

    it('should find ticket by thread ID in nested threadInfo structure', async () => {
      const ticketId = uuidv4();
      const threadId = `nested-thread-${uuidv4()}`;

      await knex('tickets').insert({
        tenant: testTenant,
        ticket_id: ticketId,
        ticket_number: `#${Date.now()}`,
        client_id: testClientId,
        title: 'Nested Thread Test',
        email_metadata: {
          threadInfo: {
            threadId: threadId
          },
          messageId: `<msg-${Date.now()}@example.com>`
        },
        entered_at: new Date(),
        updated_at: new Date()
      });
      cleanup.push(async () => {
        await knex('tickets').where({ tenant: testTenant, ticket_id: ticketId }).del();
      });

      const threadInput: FindTicketByEmailThreadInput = {
        threadId: threadId
      };

      const result = await findTicketByEmailThread(threadInput, testTenant);

      expect(result).not.toBeNull();
      expect(result!.ticketId).toBe(ticketId);
    });
  });

  describe('findTicketByEmailThread - Priority and Fallback', () => {
    it('should prioritize thread ID over other methods', async () => {
      const ticketId = uuidv4();
      const threadId = `priority-thread-${uuidv4()}`;
      const messageId = `<msg-${Date.now()}@example.com>`;

      await knex('tickets').insert({
        tenant: testTenant,
        ticket_id: ticketId,
        ticket_number: `#${Date.now()}`,
        client_id: testClientId,
        title: 'Priority Test',
        email_metadata: {
          threadId: threadId,
          messageId: messageId
        },
        entered_at: new Date(),
        updated_at: new Date()
      });
      cleanup.push(async () => {
        await knex('tickets').where({ tenant: testTenant, ticket_id: ticketId }).del();
      });

      // Provide both thread ID and Message-ID
      const threadInput: FindTicketByEmailThreadInput = {
        threadId: threadId,
        inReplyTo: messageId
      };

      const result = await findTicketByEmailThread(threadInput, testTenant);

      expect(result).not.toBeNull();
      expect(result!.ticketId).toBe(ticketId);
      // Should use thread ID strategy (which was checked first)
      expect(result!.threadInfo?.threadId).toBe(threadId);
    });

    it('should fallback to In-Reply-To when thread ID does not match', async () => {
      const ticketId = uuidv4();
      const messageId = `<fallback-msg-${Date.now()}@example.com>`;

      await knex('tickets').insert({
        tenant: testTenant,
        ticket_id: ticketId,
        ticket_number: `#${Date.now()}`,
        client_id: testClientId,
        title: 'Fallback Test',
        email_metadata: {
          messageId: messageId
        },
        entered_at: new Date(),
        updated_at: new Date()
      });
      cleanup.push(async () => {
        await knex('tickets').where({ tenant: testTenant, ticket_id: ticketId }).del();
      });

      const threadInput: FindTicketByEmailThreadInput = {
        threadId: 'non-existent-thread',
        inReplyTo: messageId
      };

      const result = await findTicketByEmailThread(threadInput, testTenant);

      expect(result).not.toBeNull();
      expect(result!.ticketId).toBe(ticketId);
    });

    it('should fallback to References when In-Reply-To does not match', async () => {
      const ticketId = uuidv4();
      const messageId = `<ref-msg-${Date.now()}@example.com>`;

      await knex('tickets').insert({
        tenant: testTenant,
        ticket_id: ticketId,
        ticket_number: `#${Date.now()}`,
        client_id: testClientId,
        title: 'References Fallback',
        email_metadata: {
          messageId: messageId
        },
        entered_at: new Date(),
        updated_at: new Date()
      });
      cleanup.push(async () => {
        await knex('tickets').where({ tenant: testTenant, ticket_id: ticketId }).del();
      });

      const threadInput: FindTicketByEmailThreadInput = {
        inReplyTo: 'non-existent-msg@example.com',
        references: [
          'other-msg@example.com',
          messageId  // Should match this
        ]
      };

      const result = await findTicketByEmailThread(threadInput, testTenant);

      expect(result).not.toBeNull();
      expect(result!.ticketId).toBe(ticketId);
    });

    it('should return null when no threading information matches', async () => {
      const threadInput: FindTicketByEmailThreadInput = {
        threadId: 'non-existent-thread',
        inReplyTo: 'non-existent-msg@example.com',
        references: ['other-non-existent@example.com']
      };

      const result = await findTicketByEmailThread(threadInput, testTenant);

      expect(result).toBeNull();
    });
  });

  describe('findTicketByEmailThread - Tenant Isolation', () => {
    it('should not find tickets from different tenant', async () => {
      const otherTenant = uuidv4();
      const ticketId = uuidv4();
      const messageId = `<isolated-${Date.now()}@example.com>`;
      const otherClientId = uuidv4();

      // Create other tenant
      await knex('tenants').insert({
        tenant: otherTenant,
        client_name: 'Other Tenant',
        email: 'other-tenant@example.com',
        created_at: new Date(),
        updated_at: new Date()
      });

      // Create client for other tenant
      await knex('clients').insert({
        client_id: otherClientId,
        tenant: otherTenant,
        client_name: 'Other Tenant Client',
        created_at: new Date(),
        updated_at: new Date()
      });

      // Create ticket in different tenant
      await knex('tickets').insert({
        tenant: otherTenant,
        ticket_id: ticketId,
        ticket_number: `#${Date.now()}`,
        client_id: otherClientId,
        title: 'Other Tenant Ticket',
        email_metadata: {
          messageId: messageId
        },
        entered_at: new Date(),
        updated_at: new Date()
      });
      cleanup.push(async () => {
        await knex('tickets').where({ tenant: otherTenant, ticket_id: ticketId }).del();
        await knex('clients').where({ tenant: otherTenant, client_id: otherClientId }).del();
        await knex('tenants').where({ tenant: otherTenant }).del();
      });

      // Try to find from our test tenant
      const threadInput: FindTicketByEmailThreadInput = {
        inReplyTo: messageId
      };

      const result = await findTicketByEmailThread(threadInput, testTenant);

      expect(result).toBeNull();
    });
  });

  describe('Integration: Full Threading Scenarios', () => {
    it('should handle complex multi-reply conversation with both inbound and outbound', async () => {
      // Scenario:
      // 1. Customer sends email A -> Ticket created, stores messageId A
      // 2. Agent replies with email B -> Stores B in references
      // 3. Customer replies to B -> Should thread via In-Reply-To: B
      // 4. Agent replies with email C -> Stores C in references
      // 5. Customer replies to C -> Should thread via In-Reply-To: C

      const ticketId = uuidv4();
      const messageA = `<customer-initial-${Date.now()}@customer.com>`;

      // Step 1: Create ticket from customer email A
      await knex('tickets').insert({
        tenant: testTenant,
        ticket_id: ticketId,
        ticket_number: `#${Date.now()}`,
        client_id: testClientId,
        title: 'Complex Threading Test',
        email_metadata: {
          messageId: messageA,
          from: 'customer@example.com',
          references: []
        },
        entered_at: new Date(),
        updated_at: new Date()
      });
      cleanup.push(async () => {
        await knex('tickets').where({ tenant: testTenant, ticket_id: ticketId }).del();
      });

      // Step 2: Agent sends reply B
      const messageB = `<agent-reply-1-${Date.now()}@alga-psa.example.com>`;
      await knex('tickets')
        .where({ tenant: testTenant, ticket_id: ticketId })
        .update({
          email_metadata: knex.raw(
            `jsonb_set(email_metadata, '{references}', (email_metadata->'references' || to_jsonb(?::text)))`,
            [messageB]
          )
        });

      // Step 3: Customer replies to B - verify threading works
      let result = await findTicketByEmailThread({ inReplyTo: messageB }, testTenant);
      expect(result).not.toBeNull();
      expect(result!.ticketId).toBe(ticketId);

      // Step 4: Agent sends reply C
      const messageC = `<agent-reply-2-${Date.now() + 1}@alga-psa.example.com>`;
      await knex('tickets')
        .where({ tenant: testTenant, ticket_id: ticketId })
        .update({
          email_metadata: knex.raw(
            `jsonb_set(email_metadata, '{references}', (email_metadata->'references' || to_jsonb(?::text)))`,
            [messageC]
          )
        });

      // Step 5: Customer replies to C - verify threading still works
      result = await findTicketByEmailThread({ inReplyTo: messageC }, testTenant);
      expect(result).not.toBeNull();
      expect(result!.ticketId).toBe(ticketId);

      // Also verify References array threading
      result = await findTicketByEmailThread({
        references: [messageA, messageB, messageC]
      }, testTenant);
      expect(result).not.toBeNull();
      expect(result!.ticketId).toBe(ticketId);

      console.log(`✅ Complex threading scenario completed:
        - Initial: ${messageA}
        - Agent reply 1: ${messageB}
        - Agent reply 2: ${messageC}
        - All replies correctly threaded to ticket ${ticketId}
      `);
    });

    it('should prevent duplicate tickets when threading works', async () => {
      const ticketId = uuidv4();
      const originalMessageId = `<prevent-dup-${Date.now()}@customer.com>`;

      await knex('tickets').insert({
        tenant: testTenant,
        ticket_id: ticketId,
        ticket_number: `#${Date.now()}`,
        client_id: testClientId,
        title: 'No Duplicates Test',
        email_metadata: {
          messageId: originalMessageId
        },
        entered_at: new Date(),
        updated_at: new Date()
      });
      cleanup.push(async () => {
        await knex('tickets').where({ tenant: testTenant, ticket_id: ticketId }).del();
      });

      // Simulate workflow: Check for existing thread before creating ticket
      const threadCheck = await findTicketByEmailThread({
        inReplyTo: originalMessageId
      }, testTenant);

      expect(threadCheck).not.toBeNull();
      expect(threadCheck!.ticketId).toBe(ticketId);

      // Because we found an existing ticket, workflow should create a comment
      // instead of a new ticket, preventing duplication

      // Verify no duplicate tickets exist
      const allTickets = await knex('tickets')
        .where('tenant', testTenant)
        .whereRaw("email_metadata->>'messageId' = ?", [originalMessageId]);

      expect(allTickets).toHaveLength(1);
    });
  });
});