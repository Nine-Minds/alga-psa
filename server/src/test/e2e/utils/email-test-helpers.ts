import { PersistentE2ETestContext } from './persistent-test-context';

/**
 * Email Test Configuration
 */
export interface EmailTestConfig {
  from?: string;
  to?: string;
  subject: string;
  body: string;
  attachments?: Array<{
    filename: string;
    content: Buffer;
    contentType: string;
  }>;
  inReplyTo?: string;
  references?: string;
}

/**
 * Email Test Scenario
 */
export interface EmailTestScenario {
  tenant: any;
  client: any;
  contact: any;
  /**
   * Send an email and wait for processing
   */
  sendEmail: (config: EmailTestConfig) => Promise<{
    sentEmail: any;
    capturedEmail: any;
  }>;
  /**
   * Wait for workflow processing to complete
   */
  waitForProcessing: (timeout?: number) => Promise<void>;
  /**
   * Get tickets created for this scenario's contact
   */
  getTickets: () => Promise<any[]>;
  /**
   * Get comments for a specific ticket
   */
  getComments: (ticketId: string) => Promise<any[]>;
  /**
   * Get documents/attachments for tickets
   */
  getDocuments: () => Promise<any[]>;
}

/**
 * Email Test Helpers
 * 
 * Abstracts the complex tenant handling and provides simple, reusable
 * methods for email testing scenarios.
 */
export class EmailTestHelpers {
  private context: PersistentE2ETestContext;

  constructor(context: PersistentE2ETestContext) {
    this.context = context;
  }

  /**
   * Create a complete email test scenario with proper tenant handling
   */
  async createEmailScenario(): Promise<EmailTestScenario> {
    console.log('🏗️ Creating email test scenario...');

    // Create the basic scenario (tenant, client, contact)
    const { tenant, client, contact } = await this.context.emailTestFactory.createBasicEmailScenario();
    console.log(`[TENANT-DEBUG] Test scenario created: tenant=${tenant.tenant}, client=${client.client_name}, contact=${contact.email}`);

    // Ensure proper tenant synchronization
    await this.ensureTenantSynchronization(tenant);

    // Create scenario object with helper methods
    const scenario: EmailTestScenario = {
      tenant,
      client, 
      contact,

      sendEmail: async (config: EmailTestConfig) => {
        return await this.sendEmailWithTenantHandling(config, contact, tenant);
      },

      waitForProcessing: async (timeout: number = 15000) => {
        await this.context.waitForWorkflowProcessing(timeout);
      },

      getTickets: async () => {
        return await this.getTicketsForContact(contact.email);
      },

      getComments: async (ticketId: string) => {
        return await this.getCommentsForTicket(ticketId);
      },

      getDocuments: async () => {
        return await this.getDocumentsForContact(contact.email);
      }
    };

    console.log('✅ Email test scenario ready');
    return scenario;
  }

  /**
   * Create scenario for unknown email (no existing contact)
   */
  async createUnknownEmailScenario(): Promise<{
    tenant: any;
    unknownEmail: string;
    sendEmail: (config: EmailTestConfig) => Promise<{ sentEmail: any; capturedEmail: any }>;
    waitForProcessing: (timeout?: number) => Promise<void>;
    getTickets: () => Promise<any[]>;
  }> {
    console.log('🏗️ Creating unknown email test scenario...');

    // Create tenant and client, but no contact
    const { tenant } = await this.context.emailTestFactory.createBasicEmailScenario();
    await this.ensureTenantSynchronization(tenant);

    const unknownEmail = 'unknown@example.com';

    return {
      tenant,
      unknownEmail,
      
      sendEmail: async (config: EmailTestConfig) => {
        const emailConfig = { ...config, from: unknownEmail };
        return await this.sendEmailWithTenantHandling(emailConfig, { email: unknownEmail }, tenant);
      },

      waitForProcessing: async (timeout: number = 15000) => {
        await this.context.waitForWorkflowProcessing(timeout);
      },

      getTickets: async () => {
        return await this.getTicketsForContact(unknownEmail);
      }
    };
  }

  /**
   * Ensure proper tenant synchronization between test and workflow worker
   */
  private async ensureTenantSynchronization(tenant: any): Promise<void> {
    console.log('🔄 Ensuring tenant synchronization...');

    // Verify tenant exists in database
    const tenantCheck = await this.context.db('tenants').where('tenant', tenant.tenant).first();
    if (!tenantCheck) {
      throw new Error(`Tenant ${tenant.tenant} not found in database after creation`);
    }
    console.log(`[TENANT-DEBUG] Verified tenant exists: tenant=${tenantCheck.tenant}, client_name=${tenantCheck.client_name}`);

    // Force transaction commit for visibility across connections
    try {
      await this.context.db.raw('COMMIT');
      await this.context.db.raw('BEGIN');
      console.log(`[TENANT-DEBUG] Forced transaction commit for tenant visibility`);
    } catch (error) {
      console.log(`[TENANT-DEBUG] Transaction commit/begin not needed (autocommit mode)`);
    }

    // Brief wait for data visibility
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('✅ Tenant synchronization complete');
  }

  /**
   * Send email with proper tenant handling
   */
  private async sendEmailWithTenantHandling(
    config: EmailTestConfig, 
    contact: { email: string }, 
    tenant: any
  ): Promise<{ sentEmail: any; capturedEmail: any }> {
    
    const testEmail = {
      from: config.from || contact.email,
      to: config.to || 'support@client.com',
      subject: config.subject,
      body: config.body,
      attachments: config.attachments,
      inReplyTo: config.inReplyTo,
      references: config.references
    };

    console.log(`[TENANT-DEBUG] Sending email: tenant=${tenant.tenant}, from=${testEmail.from}, subject=${testEmail.subject}`);

    return await this.context.sendAndCaptureEmail(testEmail);
  }

  /**
   * Get tickets for a specific contact email
   */
  private async getTicketsForContact(contactEmail: string): Promise<any[]> {
    const ticketResult = await this.context.db.raw(`
      SELECT t.*, c.email as contact_email, comp.client_name
      FROM tickets t 
      JOIN contacts c ON t.contact_name_id = c.contact_name_id
      LEFT JOIN clients comp ON c.client_id = comp.client_id
      WHERE c.email = ?
      ORDER BY t.entered_at DESC
    `, [contactEmail]);
    
    return ticketResult.rows || ticketResult;
  }

  /**
   * Get comments for a specific ticket
   */
  private async getCommentsForTicket(ticketId: string): Promise<any[]> {
    const commentResult = await this.context.db.raw(`
      SELECT c.* 
      FROM comments c
      WHERE c.ticket_id = ?
      ORDER BY c.created_at
    `, [ticketId]);
    
    return commentResult.rows || commentResult;
  }

  /**
   * Get documents/attachments for a contact's tickets
   */
  private async getDocumentsForContact(contactEmail: string): Promise<any[]> {
    const documentResult = await this.context.db.raw(`
      SELECT t.*, d.document_name as file_name, d.file_size, d.mime_type
      FROM tickets t 
      JOIN contacts c ON t.contact_name_id = c.contact_name_id
      LEFT JOIN document_associations da ON da.entity_id = t.ticket_id AND da.entity_type = 'ticket'
      LEFT JOIN documents d ON d.document_id = da.document_id AND d.tenant = da.tenant
      WHERE c.email = ? AND d.document_name IS NOT NULL
      ORDER BY t.entered_at DESC
    `, [contactEmail]);
    
    return documentResult.rows || documentResult;
  }

  /**
   * Assert ticket was created correctly
   */
  static assertTicketCreated(tickets: any[], expectedSubject: string, expectedEmail: string): void {
    expect(tickets).toHaveLength(1);
    expect(tickets[0].title).toContain(expectedSubject);
    expect(tickets[0].contact_email).toBe(expectedEmail);
  }

  /**
   * Assert attachment was processed correctly
   */
  static assertAttachmentProcessed(documents: any[], expectedFilename: string): void {
    expect(documents).toHaveLength(1);
    expect(documents[0].file_name).toBe(expectedFilename);
    expect(Number(documents[0].file_size)).toBeGreaterThan(0);
  }

  /**
   * Assert email threading worked correctly
   */
  static assertEmailThreading(
    initialTickets: any[], 
    finalTickets: any[], 
    comments: any[], 
    initialBody: string, 
    replyBody: string
  ): void {
    // Should still have only one ticket (threaded)
    expect(finalTickets).toHaveLength(1);
    expect(finalTickets[0].ticket_id).toBe(initialTickets[0].ticket_id);

    // Should have multiple comments for the same ticket
    expect(comments).toHaveLength(2);
    expect(comments[0].note).toContain(initialBody);
    expect(comments[1].note).toContain(replyBody);
  }
}

/**
 * Create email test helpers for the given context
 */
export function createEmailTestHelpers(context: PersistentE2ETestContext): EmailTestHelpers {
  return new EmailTestHelpers(context);
}