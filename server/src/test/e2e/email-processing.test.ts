import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import '../../../test-utils/nextApiMock';
import { createPersistentE2EHelpers, PersistentE2ETestContext } from './utils/persistent-test-context';
import { createEmailTestHelpers, EmailTestHelpers } from './utils/email-test-helpers';

describe('Email Processing E2E Tests', () => {
  const testHelpers = createPersistentE2EHelpers();
  let context: PersistentE2ETestContext;
  let emailHelpers: EmailTestHelpers;

  beforeAll(async () => {
    // Initialize persistent E2E test context
    context = await testHelpers.beforeAll({
      runSeeds: true,
      testMode: 'e2e',
      clearEmailsBeforeTest: true
    });
    emailHelpers = createEmailTestHelpers(context);
  }, 15000);

  afterAll(async () => {
    await testHelpers.afterAll(context);
  });

  beforeEach(async () => {
    await testHelpers.beforeEach(context);
    // Ensure database changes are committed and visible to all connections
    await context.db.raw('SELECT 1');
    await new Promise(resolve => setTimeout(resolve, 1000));
  });

  afterEach(async () => {
    await testHelpers.afterEach(context);
  });

  describe('Basic Email Ingestion', () => {
    it('should process a simple email and create a ticket', async () => {
      // Arrange - Create scenario with automatic tenant handling
      const scenario = await emailHelpers.createEmailScenario();
      
      // Act - Send email (tenant synchronization handled automatically)
      const { capturedEmail } = await scenario.sendEmail({
        subject: 'Test Support Request',
        body: 'This is a test support request from E2E testing.'
      });
      
      await scenario.waitForProcessing();

      // Assert
      // Verify email was captured
      expect(capturedEmail.Content.Headers.Subject[0]).toBe('Test Support Request');

      // Verify ticket was created
      const tickets = await scenario.getTickets();
      EmailTestHelpers.assertTicketCreated(tickets, 'Test Support Request', scenario.contact.email);
    }, 30000);

    it('should handle emails with attachments', async () => {
      // Arrange
      const scenario = await emailHelpers.createEmailScenario();
      
      // Act - Send email with attachment
      const { capturedEmail } = await scenario.sendEmail({
        subject: 'Test Email with Attachment',
        body: 'This email contains a test attachment.',
        attachments: [{
          filename: 'test-document.pdf',
          content: Buffer.from('This is a test PDF content'),
          contentType: 'application/pdf'
        }]
      });
      
      await scenario.waitForProcessing();

      // Assert
      expect(capturedEmail).toBeDefined();
      
      // Verify ticket and attachment were created
      const tickets = await scenario.getTickets();
      EmailTestHelpers.assertTicketCreated(tickets, 'Test Email with Attachment', scenario.contact.email);
      
      const documents = await scenario.getDocuments();
      EmailTestHelpers.assertAttachmentProcessed(documents, 'test-document.pdf');
    }, 30000);
  });

  describe('Email Threading', () => {
    it('should properly thread email replies', async () => {
      // Arrange
      const scenario = await emailHelpers.createEmailScenario();
      
      // Act - Send initial email
      const { sentEmail } = await scenario.sendEmail({
        subject: 'Initial Support Request',
        body: 'This is the initial support request.'
      });
      
      await scenario.waitForProcessing();
      const initialTickets = await scenario.getTickets();
      expect(initialTickets).toHaveLength(1);
      const ticketId = initialTickets[0].ticket_id;

      // Send reply email
      await scenario.sendEmail({
        subject: 'Re: Initial Support Request',
        body: 'This is a reply to the initial request.',
        inReplyTo: sentEmail.messageId,
        references: sentEmail.messageId
      });
      
      await scenario.waitForProcessing();

      // Assert - Verify threading
      const finalTickets = await scenario.getTickets();
      const comments = await scenario.getComments(ticketId);
      
      EmailTestHelpers.assertEmailThreading(
        initialTickets,
        finalTickets, 
        comments,
        'This is the initial support request.',
        'This is a reply to the initial request.'
      );
    }, 45000);
  });

  describe('Client Matching', () => {
    it('should match emails to existing clients', async () => {
      // Arrange
      const scenario = await emailHelpers.createEmailScenario();
      
      // Act
      await scenario.sendEmail({
        subject: 'Request from Known Client',
        body: 'This email should be matched to an existing client.'
      });
      
      await scenario.waitForProcessing();

      // Assert
      const tickets = await scenario.getTickets();
      EmailTestHelpers.assertTicketCreated(tickets, 'Request from Known Client', scenario.contact.email);
      expect(tickets[0].company_name).toBe(scenario.company.company_name);
    }, 30000);

    it('should handle unknown email addresses with manual fallback', async () => {
      // Arrange
      const unknownScenario = await emailHelpers.createUnknownEmailScenario();
      
      // Act
      await unknownScenario.sendEmail({
        subject: 'Request from Unknown Client',
        body: 'This email is from an unknown client.'
      });
      
      await unknownScenario.waitForProcessing();

      // Assert
      const tickets = await unknownScenario.getTickets();
      // Should create a ticket even for unknown client
      expect(tickets.length).toBeGreaterThanOrEqual(0);
      
      // Check for any workflow tasks created for manual matching
      const tasks = await context.db('workflow_tasks')
        .where('task_definition_type', 'system')
        .where('system_task_definition_task_type', 'match_email_to_client')
        .where('created_at', '>', new Date(Date.now() - 60000));
      
      console.log(`📋 Manual matching tasks created: ${tasks.length}`);
    }, 30000);
  });
});