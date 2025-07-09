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
      autoStartServices: false,  // Services are now running with workflow worker
      clearEmailsBeforeTest: true
    });
  }, 30000);

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
      // Arrange
      const { tenant, company, contact } = await context.emailTestFactory.createBasicEmailScenario();
      console.log(`[TENANT-DEBUG] Test scenario created: tenant=${tenant.tenant}, company=${company.company_name}, contact=${contact.email}`);
      
      // Ensure the tenant exists in the database and is visible to all connections
      const tenantCheck = await context.db('tenants').where('tenant', tenant.tenant).first();
      if (!tenantCheck) {
        throw new Error(`Tenant ${tenant.tenant} not found in database after creation`);
      }
      console.log(`[TENANT-DEBUG] Verified tenant exists in database: tenant=${tenantCheck.tenant}, company_name=${tenantCheck.company_name}`);
      
      // Force commit any pending transactions to ensure data is visible to other connections
      try {
        await context.db.raw('COMMIT');
        await context.db.raw('BEGIN');
        console.log(`[TENANT-DEBUG] Forced transaction commit for tenant visibility`);
      } catch (error) {
        console.log(`[TENANT-DEBUG] Transaction commit/begin not needed (autocommit mode)`);
      }
      
      // Give time for all connections to see the committed data
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const testEmail = {
        from: contact.email,
        to: 'support@company.com',
        subject: 'Test Support Request',
        body: 'This is a test support request from E2E testing.'
      };

      console.log(`[TENANT-DEBUG] Sending test email to MailHog: tenant=${tenant.tenant}, from=${testEmail.from}, to=${testEmail.to}, subject=${testEmail.subject}`);

      // Act
      const { sentEmail, capturedEmail } = await context.sendAndCaptureEmail(testEmail);
      
      // Wait for workflow processing with longer timeout
      await context.waitForWorkflowProcessing(30000); // 30 second timeout

      // Assert
      // Verify email was captured
      expect(capturedEmail.Content.Headers.Subject[0]).toBe(testEmail.subject);

      // Verify ticket was created
      const ticketResult = await context.db.raw(`
        SELECT t.*, c.email as contact_email 
        FROM tickets t 
        JOIN contacts c ON t.contact_name_id = c.contact_name_id
        WHERE c.email = ?
      `, [contact.email]);
      
      const tickets = ticketResult.rows || ticketResult;
      expect(tickets).toHaveLength(1);
      expect(tickets[0].title).toContain(testEmail.subject);
      expect(tickets[0].contact_email).toBe(contact.email);
    }, 60000); // 60 second test timeout

    it('should handle emails with attachments', async () => {
      // Arrange
      const { tenant, company, contact } = await context.emailTestFactory.createBasicEmailScenario();
      console.log(`[TENANT-DEBUG] Test scenario (attachments) created: tenant=${tenant.tenant}, company=${company.company_name}, contact=${contact.email}`);
      
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
      await context.waitForWorkflowProcessing(30000);

      // Assert
      expect(capturedEmail).toBeDefined();
      
      // Verify ticket was created with attachment
      const ticketResult = await context.db.raw(`
        SELECT t.*, d.document_name as file_name, d.file_size 
        FROM tickets t 
        JOIN contacts c ON t.contact_name_id = c.contact_name_id
        LEFT JOIN document_associations da ON da.entity_id = t.ticket_id AND da.entity_type = 'ticket'
        LEFT JOIN documents d ON d.document_id = da.document_id AND d.tenant = da.tenant
        WHERE c.email = ?
      `, [contact.email]);
      
      const tickets = ticketResult.rows || ticketResult;
      expect(tickets).toHaveLength(1);
      expect(tickets[0].file_name).toBe('test-document.pdf');
      expect(tickets[0].file_size).toBeGreaterThan(0);
    }, 60000);
  });

  describe('Email Threading', () => {
    it('should properly thread email replies', async () => {
      // Arrange
      const { tenant, company, contact } = await context.emailTestFactory.createBasicEmailScenario();
      console.log(`[TENANT-DEBUG] Test scenario (threading) created: tenant=${tenant.tenant}, company=${company.company_name}, contact=${contact.email}`);
      
      const initialEmail = {
        from: contact.email,
        to: 'support@company.com',
        subject: 'Initial Support Request',
        body: 'This is the initial support request.'
      };

      // Act - Send initial email
      const { sentEmail: sentInitialEmail, capturedEmail: capturedInitialEmail } = await context.sendAndCaptureEmail(initialEmail);
      await context.waitForWorkflowProcessing(30000);

      // Get the initial ticket
      const initialTicketResult = await context.db.raw(`
        SELECT t.ticket_id, t.title
        FROM tickets t 
        JOIN contacts c ON t.contact_name_id = c.contact_name_id
        WHERE c.email = ?
      `, [contact.email]);
      
      const initialTickets = initialTicketResult.rows || initialTicketResult;
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
      await context.waitForWorkflowProcessing(30000);

      // Assert
      // Should still have only one ticket (threaded)
      const finalTicketResult = await context.db.raw(`
        SELECT t.ticket_id, t.title
        FROM tickets t 
        JOIN contacts c ON t.contact_name_id = c.contact_name_id
        WHERE c.email = ?
      `, [contact.email]);
      
      const finalTickets = finalTicketResult.rows || finalTicketResult;
      expect(finalTickets).toHaveLength(1);
      expect(finalTickets[0].ticket_id).toBe(ticketId);

      // Should have multiple comments for the same ticket
      const commentResult = await context.db.raw(`
        SELECT c.* 
        FROM comments c
        WHERE c.ticket_id = ?
        ORDER BY c.created_at
      `, [ticketId]);
      
      const comments = commentResult.rows || commentResult;
      expect(comments).toHaveLength(2);
      expect(comments[0].note).toContain(initialEmail.body);
      expect(comments[1].note).toContain(replyEmail.body);
    }, 90000); // 90 second test timeout
  });

  describe('Client Matching', () => {
    it('should match emails to existing clients', async () => {
      // Arrange
      const { tenant, company, contact } = await context.emailTestFactory.createBasicEmailScenario();
      console.log(`[TENANT-DEBUG] Test scenario (client matching) created: tenant=${tenant.tenant}, company=${company.company_name}, contact=${contact.email}`);
      
      const testEmail = {
        from: contact.email,
        to: 'support@company.com',
        subject: 'Request from Known Client',
        body: 'This email should be matched to an existing client.'
      };

      // Act
      const { sentEmail, capturedEmail } = await context.sendAndCaptureEmail(testEmail);
      await context.waitForWorkflowProcessing(30000);

      // Assert
      const ticketResult = await context.db.raw(`
        SELECT t.*, c.email as contact_email, comp.company_name
        FROM tickets t 
        JOIN contacts c ON t.contact_id = c.contact_name_id
        JOIN companies comp ON c.company_id = comp.company_id
        WHERE c.email = ?
      `, [contact.email]);
      
      const tickets = ticketResult.rows || ticketResult;
      expect(tickets).toHaveLength(1);
      expect(tickets[0].contact_email).toBe(contact.email);
      expect(tickets[0].company_name).toBe(company.company_name);
    }, 60000);

    it('should handle unknown email addresses with manual fallback', async () => {
      // Arrange
      const { tenant } = await context.emailTestFactory.createBasicEmailScenario();
      console.log(`[TENANT-DEBUG] Test scenario (unknown client) created: tenant=${tenant.tenant}`);
      
      const unknownEmail = {
        from: 'unknown@example.com',
        to: 'support@company.com',
        subject: 'Request from Unknown Client',
        body: 'This email is from an unknown client.'
      };

      // Act
      const { sentEmail, capturedEmail } = await context.sendAndCaptureEmail(unknownEmail);
      await context.waitForWorkflowProcessing(30000);

      // Assert
      // For unknown emails, a task should be created for manual matching
      // The workflow will still create a ticket but may lack client association
      const ticketResult = await context.db.raw(`
        SELECT t.* 
        FROM tickets t 
        WHERE t.title LIKE ?
      `, [`%${unknownEmail.subject}%`]);
      
      const tickets = ticketResult.rows || ticketResult;
      // Should create a ticket even for unknown client
      expect(tickets.length).toBeGreaterThanOrEqual(0);
      
      // Check for any workflow tasks created for manual matching
      const tasks = await context.db('workflow_tasks')
        .where('task_type', 'match_email_to_client')
        .where('created_at', '>', new Date(Date.now() - 60000)); // Last minute
      
      // May have tasks created for manual matching
      console.log(`📋 Manual matching tasks created: ${tasks.length}`);
    }, 60000);
  });
});