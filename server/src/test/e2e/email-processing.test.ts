import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import '../../../test-utils/nextApiMock';
import { E2ETestContext } from './utils/e2e-test-context';

describe('Email Processing E2E Tests', () => {
  const testHelpers = E2ETestContext.createE2EHelpers();
  let context: E2ETestContext;

  beforeAll(async () => {
    // Initialize E2E test context with all services
    context = await testHelpers.beforeAll({
      runSeeds: true,
      testMode: 'e2e',
      autoStartServices: true,
      clearEmailsBeforeTest: true
    });
  });

  afterAll(async () => {
    await testHelpers.afterAll(context);
  });

  beforeEach(async () => {
    await testHelpers.beforeEach(context);
  });

  afterEach(async () => {
    await testHelpers.afterEach(context);
  });

  describe('Basic Email Ingestion', () => {
    it('should process a simple email and create a ticket', async () => {
      // Arrange
      const { tenant, company, contact } = await context.emailTestFactory.createBasicEmailScenario();
      
      const testEmail = {
        from: contact.email,
        to: 'support@company.com',
        subject: 'Test Support Request',
        body: 'This is a test support request from E2E testing.'
      };

      // Act
      const { sentEmail, capturedEmail } = await context.sendAndCaptureEmail(testEmail);
      
      // Wait for workflow processing
      await context.waitForWorkflowProcessing();

      // Assert
      // Verify email was captured
      expect(capturedEmail.Content.Headers.Subject[0]).toBe(testEmail.subject);

      // Verify ticket was created
      const tickets = await context.db.raw(`
        SELECT t.*, c.email as contact_email 
        FROM tickets t 
        JOIN contacts c ON t.contact_name_id = c.contact_name_id
        WHERE c.email = ?
      `, [contact.email]);
      
      expect(tickets).toHaveLength(1);
      expect(tickets[0].title).toContain(testEmail.subject);
      expect(tickets[0].contact_email).toBe(contact.email);
    });

    it('should handle emails with attachments', async () => {
      // Arrange
      const { tenant, company, contact } = await context.emailTestFactory.createBasicEmailScenario();
      
      const testEmail = {
        from: contact.email,
        to: 'support@company.com',
        subject: 'Test Email with Attachment',
        body: 'This email contains a test attachment.',
        attachments: [{
          filename: 'test-document.pdf',
          content: Buffer.from('This is a test PDF content'),
          contentType: 'application/pdf'
        }]
      };

      // Act
      const { sentEmail, capturedEmail } = await context.sendAndCaptureEmail(testEmail);
      await context.waitForWorkflowProcessing();

      // Assert
      expect(capturedEmail).toBeDefined();
      
      // Verify ticket was created with attachment
      const tickets = await context.db.raw(`
        SELECT t.*, a.file_name, a.file_size 
        FROM tickets t 
        JOIN contacts c ON t.contact_name_id = c.contact_name_id
        LEFT JOIN attachments a ON t.ticket_id = a.ticket_id
        WHERE c.email = ?
      `, [contact.email]);
      
      expect(tickets).toHaveLength(1);
      expect(tickets[0].file_name).toBe('test-document.pdf');
      expect(tickets[0].file_size).toBeGreaterThan(0);
    });
  });

  describe('Email Threading', () => {
    it('should properly thread email replies', async () => {
      // Arrange
      const { tenant, company, contact } = await context.emailTestFactory.createBasicEmailScenario();
      
      const initialEmail = {
        from: contact.email,
        to: 'support@company.com',
        subject: 'Initial Support Request',
        body: 'This is the initial support request.'
      };

      // Act - Send initial email
      const { sentEmail: sentInitialEmail, capturedEmail: capturedInitialEmail } = await context.sendAndCaptureEmail(initialEmail);
      await context.waitForWorkflowProcessing();

      // Get the initial ticket
      const initialTickets = await context.db.raw(`
        SELECT t.ticket_id, t.title
        FROM tickets t 
        JOIN contacts c ON t.contact_name_id = c.contact_name_id
        WHERE c.email = ?
      `, [contact.email]);
      
      expect(initialTickets).toHaveLength(1);
      const ticketId = initialTickets[0].ticket_id;

      // Send reply email
      const replyEmail = {
        from: contact.email,
        to: 'support@company.com',
        subject: 'Re: Initial Support Request',
        body: 'This is a reply to the initial request.',
        inReplyTo: sentInitialEmail.messageId,
        references: sentInitialEmail.messageId
      };

      const { sentEmail: sentReplyEmail, capturedEmail: capturedReplyEmail } = await context.sendAndCaptureEmail(replyEmail);
      await context.waitForWorkflowProcessing();

      // Assert
      // Should still have only one ticket (threaded)
      const finalTickets = await context.db.raw(`
        SELECT t.ticket_id, t.title
        FROM tickets t 
        JOIN contacts c ON t.contact_name_id = c.contact_name_id
        WHERE c.email = ?
      `, [contact.email]);
      
      expect(finalTickets).toHaveLength(1);
      expect(finalTickets[0].ticket_id).toBe(ticketId);

      // Should have multiple email messages for the same ticket
      const emailMessages = await context.db.raw(`
        SELECT em.* 
        FROM email_messages em
        WHERE em.ticket_id = ?
        ORDER BY em.created_at
      `, [ticketId]);
      
      expect(emailMessages).toHaveLength(2);
      expect(emailMessages[0].subject).toBe(initialEmail.subject);
      expect(emailMessages[1].subject).toBe(replyEmail.subject);
    });
  });

  describe('Client Matching', () => {
    it('should match emails to existing clients', async () => {
      // Arrange
      const { tenant, company, contact } = await context.emailTestFactory.createBasicEmailScenario();
      
      const testEmail = {
        from: contact.email,
        to: 'support@company.com',
        subject: 'Request from Known Client',
        body: 'This email should be matched to an existing client.'
      };

      // Act
      const { sentEmail, capturedEmail } = await context.sendAndCaptureEmail(testEmail);
      await context.waitForWorkflowProcessing();

      // Assert
      const tickets = await context.db.raw(`
        SELECT t.*, c.email as contact_email, comp.company_name
        FROM tickets t 
        JOIN contacts c ON t.contact_name_id = c.contact_name_id
        JOIN companies comp ON c.company_id = comp.company_id
        WHERE c.email = ?
      `, [contact.email]);
      
      expect(tickets).toHaveLength(1);
      expect(tickets[0].contact_email).toBe(contact.email);
      expect(tickets[0].company_name).toBe(company.company_name);
    });

    it('should handle unknown email addresses with manual fallback', async () => {
      // Arrange
      const { tenant } = await context.emailTestFactory.createBasicEmailScenario();
      
      const unknownEmail = {
        from: 'unknown@example.com',
        to: 'support@company.com',
        subject: 'Request from Unknown Client',
        body: 'This email is from an unknown client.'
      };

      // Act
      const { sentEmail, capturedEmail } = await context.sendAndCaptureEmail(unknownEmail);
      await context.waitForWorkflowProcessing();

      // Assert
      // Should create a workflow event for manual client selection
      const workflowEvents = await context.db.raw(`
        SELECT we.* 
        FROM workflow_events we
        WHERE we.event_type = 'email_client_selection_required'
        AND we.event_data->>'email' = ?
      `, [unknownEmail.from]);
      
      expect(workflowEvents).toHaveLength(1);
      expect(workflowEvents[0].status).toBe('pending');
    });
  });
});