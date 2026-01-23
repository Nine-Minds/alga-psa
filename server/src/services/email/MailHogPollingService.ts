import { EmailProcessor } from './EmailProcessor';
import { EmailQueueService } from './queue/EmailQueueService';
import { EmailQueueJob } from '@alga-psa/shared/interfaces/inbound-email.interfaces';
import { v4 as uuidv4 } from 'uuid';

/**
 * MailHog Polling Service for E2E Testing
 * 
 * This service polls MailHog for new emails and feeds them into the email processing pipeline.
 * It's specifically designed for testing environments where MailHog captures emails
 * that need to be processed by the workflow system.
 */
export class MailHogPollingService {
  private isPolling: boolean = false;
  private pollingInterval: NodeJS.Timeout | null = null;
  private processedMessageIds: Set<string> = new Set();
  private emailProcessor: EmailProcessor;
  private emailQueueService: EmailQueueService;
  private pollIntervalMs: number;
  private mailhogApiUrl: string;
  public defaultTenantId?: string;

  constructor(options: {
    pollIntervalMs?: number;
    mailhogApiUrl?: string;
    defaultTenantId?: string;
  } = {}) {
    this.pollIntervalMs = options.pollIntervalMs || 2000; // Poll every 2 seconds by default
    this.mailhogApiUrl = options.mailhogApiUrl || 'http://localhost:8025/api/v1';
    this.emailProcessor = new EmailProcessor();
    this.emailQueueService = new EmailQueueService();
    this.defaultTenantId = options.defaultTenantId;
  }

  /**
   * Start polling MailHog for new emails
   */
  public startPolling(): void {
    if (this.isPolling) {
      console.log('📧 MailHog polling is already running');
      return;
    }

    console.log(`📧 Starting MailHog polling every ${this.pollIntervalMs}ms at ${this.mailhogApiUrl}`);
    this.isPolling = true;

    // Do an immediate poll to check connectivity
    this.pollForNewEmails().catch((error: any) => {
      console.error('❌ Initial MailHog poll failed:', error.message);
    });

    this.pollingInterval = setInterval(async () => {
      try {
        await this.pollForNewEmails();
      } catch (error: any) {
        console.error('❌ Error polling MailHog:', error.message);
      }
    }, this.pollIntervalMs);
  }

  /**
   * Stop polling MailHog
   */
  public stopPolling(): void {
    if (!this.isPolling) {
      return;
    }

    console.log('🛑 Stopping MailHog polling');
    this.isPolling = false;

    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  /**
   * Poll MailHog for new emails and process them
   */
  private async pollForNewEmails(): Promise<void> {
    try {
      // Get all messages from MailHog
      const response = await fetch(`${this.mailhogApiUrl}/messages`);
      
      if (!response.ok) {
        throw new Error(`MailHog API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      // MailHog API returns array directly, not wrapped in messages property
      const messages = Array.isArray(data) ? data : (data.messages || []);

      console.log(`📧 Found ${messages.length} total messages in MailHog`);

      // Process new messages (ones we haven't seen before)
      const newMessages = messages.filter((msg: any) => !this.processedMessageIds.has(msg.ID));
      
      if (newMessages.length > 0) {
        console.log(`📧 Processing ${newMessages.length} new emails`);
        
        for (const message of newMessages) {
          await this.processMailHogMessage(message);
          this.processedMessageIds.add(message.ID);
        }
      }
    } catch (error: any) {
      console.error('❌ Failed to poll MailHog:', error.message);
    }
  }

  /**
   * Process a single MailHog message
   */
  private async processMailHogMessage(mailhogMessage: any): Promise<void> {
    try {
      console.log(`📧 Processing MailHog message: ${mailhogMessage.ID}`);
      
      // Convert MailHog message format to our email format
      const emailData = this.convertMailHogToEmailData(mailhogMessage);
      
      // Get a default tenant - in E2E tests, use the first available tenant
      const tenantId = await this.getDefaultTenant();
      console.log(`[TENANT-DEBUG] MailHogPollingService processing email: tenant=${tenantId}, messageId=${mailhogMessage.ID}, subject=${emailData.subject}`);
      
      // Create an email processing job
      const emailJob: EmailQueueJob = {
        id: uuidv4(),
        messageId: emailData.id,
        providerId: 'mailhog-test-provider', // Special provider ID for MailHog
        provider: 'mailhog-test-provider',
        tenant: tenantId,
        attempt: 1,
        maxRetries: 3,
        createdAt: new Date().toISOString(),
        webhookData: {
          source: 'mailhog',
          originalMessageId: mailhogMessage.ID
        }
      };

      console.log(`[TENANT-DEBUG] MailHogPollingService about to emit INBOUND_EMAIL_RECEIVED event: tenant=${tenantId}, providerId=${emailJob.providerId}, emailSubject=${emailData.subject}`);
      await this.emitEmailReceivedEvent(emailJob);

      console.log(`✅ Successfully processed MailHog email: ${emailData.subject}`);
    } catch (error: any) {
      console.error(`❌ Failed to process MailHog message ${mailhogMessage.ID}:`, error.message);
    }
  }

  /**
   * Convert MailHog message format to our standard email data format
   */
  private convertMailHogToEmailData(mailhogMessage: any): any {
    // MailHog stores headers in Content.Headers, not Raw.Headers
    const headers = mailhogMessage.Content?.Headers || {};
    
    // Extract email addresses
    const fromHeader = headers.From?.[0] || '';
    const toHeader = headers.To?.[0] || '';
    
    // Parse from address
    const fromMatch = fromHeader.match(/(.*?)\s*<(.+?)>|(.+)/);
    const fromEmail = fromMatch ? (fromMatch[2] || fromMatch[3] || fromMatch[1]).trim() : '';
    const fromName = fromMatch && fromMatch[2] ? fromMatch[1].trim().replace(/"/g, '') : '';
    
    // Ensure we have a valid from email
    const validFromEmail = fromEmail && fromEmail.includes('@') ? fromEmail : 'test@example.com';
    
    // Parse to addresses
    const toEmails = toHeader.split(',').map((email: string) => {
      const toMatch = email.trim().match(/(.*?)\s*<(.+?)>|(.+)/);
      const emailAddr = toMatch ? (toMatch[2] || toMatch[3] || toMatch[1]).trim() : '';
      const name = toMatch && toMatch[2] ? toMatch[1].trim().replace(/"/g, '') : '';
      return { email: emailAddr || 'test@example.com', name: name || '' };
    }).filter((e: { email: string; name: string }) => e.email && e.email.includes('@')); // Filter out invalid emails

    // Extract threading information
    const messageId = headers['Message-ID']?.[0] || '';
    const inReplyTo = headers['In-Reply-To']?.[0] || '';
    const references = headers.References ? headers.References[0].split(/\s+/) : [];
    
    // For threading, we'll pass all potential identifiers to the workflow
    // and let the database lookup find the correct existing ticket
    // Don't try to determine threadId here - let the workflow handle it
    let threadId = messageId; // Default to current message ID

    return {
      id: messageId, // Use Message-ID header for threading compatibility
      mailhogId: mailhogMessage.ID, // Keep MailHog's internal ID for debugging
      subject: headers.Subject?.[0] || '(No Subject)',
      from: {
        email: validFromEmail,
        name: fromName || ''
      },
      to: toEmails.map((to: any) => ({
        email: to.email || 'unknown@example.com',
        name: to.name || ''
      })),
      body: {
        text: mailhogMessage.Content?.Body || '',
        html: '' // MailHog doesn't separate HTML/text in our simple case
      },
      receivedAt: new Date().toISOString(),
      attachments: this.parseAttachments(mailhogMessage),
      threadId: threadId,
      inReplyTo: inReplyTo,
      references: references
    };
  }

  /**
   * Parse attachments from MailHog message MIME data
   */
  private parseAttachments(mailhogMessage: any): any[] {
    try {
      // Debug: Log the entire message structure to understand MailHog format
      console.log(`🔍 [DEBUG] MailHog message structure for ${mailhogMessage.ID}:`, {
        hasContent: !!mailhogMessage.Content,
        hasMime: !!mailhogMessage.Content?.MIME,
        hasContentMime: !!mailhogMessage.Content?.MIME,
        hasRootMime: !!mailhogMessage.MIME,
        contentKeys: mailhogMessage.Content ? Object.keys(mailhogMessage.Content) : [],
        rootKeys: Object.keys(mailhogMessage)
      });
      
      // MailHog might store MIME data in different locations
      let mime = mailhogMessage.Content?.MIME || mailhogMessage.MIME;
      const attachments: any[] = [];
      
      if (!mime) {
        console.log(`🔍 [DEBUG] No MIME data found in message ${mailhogMessage.ID}`);
        return attachments;
      }
      
      console.log(`🔍 [DEBUG] MIME structure:`, {
        hasParts: !!mime.Parts,
        mimeKeys: Object.keys(mime),
        partsLength: mime.Parts ? mime.Parts.length : 0
      });
      
      if (!mime.Parts) {
        return attachments;
      }
      
      // Recursively parse MIME parts to find attachments
      this.parseMimeParts(mime.Parts, attachments);
      
      console.log(`🔍 [DEBUG] Found ${attachments.length} attachments in message ${mailhogMessage.ID}`);
      console.log(`🔍 [DEBUG] Final attachments array:`, attachments);
      return attachments;
    } catch (error: any) {
      console.warn(`⚠️ Failed to parse attachments from MailHog message ${mailhogMessage.ID}:`, error.message);
      return [];
    }
  }
  
  /**
   * Recursively parse MIME parts to extract attachments
   */
  private parseMimeParts(parts: any[], attachments: any[]): void {
    if (!Array.isArray(parts)) {
      return;
    }
    
    for (const part of parts) {
      try {
        const headers = part.Headers || {};
        const contentDisposition = headers['Content-Disposition']?.[0] || '';
        const contentType = headers['Content-Type']?.[0] || '';
        
        // Check if this part is an attachment
        if (contentDisposition.includes('attachment') || contentDisposition.includes('inline')) {
          // Extract filename from Content-Disposition header
          const filenameMatch = contentDisposition.match(/filename[*]?=([^;\r\n]*)/i);
          let filename = filenameMatch ? filenameMatch[1].replace(/['"]/g, '') : `attachment_${Date.now()}`;
          
          // If no filename in Content-Disposition, try Content-Type
          if (filename.includes('attachment_') && contentType.includes('name=')) {
            const nameMatch = contentType.match(/name[*]?=([^;\r\n]*)/i);
            if (nameMatch) {
              filename = nameMatch[1].replace(/['"]/g, '');
            }
          }
          
          // Extract content type
          const mimeType = contentType.split(';')[0].trim() || 'application/octet-stream';
          
          // Get the body content (base64 encoded in MailHog)
          const body = part.Body || '';
          
          // Convert base64 to buffer if needed
          let content: Buffer;
          try {
            // MailHog typically stores attachment content as base64
            content = Buffer.from(body, 'base64');
          } catch {
            // If not base64, treat as plain text
            content = Buffer.from(body, 'utf-8');
          }
          
          const attachment = {
            id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            name: filename,
            contentType: mimeType,
            size: content.length,
            content: content.toString('base64'), // Store as base64 string for workflow processing
            contentId: headers['Content-Id']?.[0] || null
          };
          
          attachments.push(attachment);
          console.log(`📎 Found attachment: ${filename} (${mimeType}, ${content.length} bytes)`);
          console.log(`🔍 [DEBUG] Attachment object:`, attachment);
          console.log(`🔍 [DEBUG] Attachments array length after push: ${attachments.length}`);
        }
        
        // Recursively check nested parts
        if (part.Parts && Array.isArray(part.Parts)) {
          this.parseMimeParts(part.Parts, attachments);
        }
      } catch (error: any) {
        console.warn(`⚠️ Failed to parse MIME part:`, error.message);
        continue;
      }
    }
  }

  /**
   * Emit email received event to EventBus for MailHog test emails
   */
  private async emitEmailReceivedEvent(eventData: any): Promise<void> {
    try {
      console.log(`📤 Emitting INBOUND_EMAIL_RECEIVED event for: ${eventData.emailData.subject}`);
      
      const { getEventBus } = await import('../../lib/eventBus');
      const eventBus = getEventBus();
      
      await eventBus.publish({
        eventType: 'INBOUND_EMAIL_RECEIVED',
        payload: {
          tenantId: eventData.tenantId,  // Changed from eventData.tenant to eventData.tenantId
          tenant: eventData.tenantId,
          providerId: eventData.providerId,
          emailData: eventData.emailData
        }
      });
      
      console.log(`[TENANT-DEBUG] MailHogPollingService emitted INBOUND_EMAIL_RECEIVED event: tenant=${eventData.tenantId}, subject=${eventData.emailData.subject}`);
      
      console.log(`✅ Successfully emitted INBOUND_EMAIL_RECEIVED event`);
    } catch (error: any) {
      console.error(`❌ Failed to emit email received event:`, error.message);
      throw error;
    }
  }

  /**
   * Get a default tenant for email processing
   * In E2E tests, this gets the first available tenant
   */
  private async getDefaultTenant(): Promise<string> {
    // If a default tenant ID was provided in the constructor, use it
    if (this.defaultTenantId) {
      console.log(`✅ Using provided tenant ID: ${this.defaultTenantId}`);
      return this.defaultTenantId;
    }
    
    try {
      // Get the actual tenant from the database using proper transaction wrapper
      const { withAdminTransaction } = await import('@alga-psa/db');
      
      const tenantId = await withAdminTransaction(async (trx) => {
        const tenant = await trx('tenants').select('tenant').first();
        if (tenant) {
          console.log(`[TENANT-DEBUG] MailHogPollingService found tenant in database: tenant=${tenant.tenant}`);
          return tenant.tenant;
        }
        
        // No tenant found - this is an error condition
        throw new Error('No tenant found in database - cannot process emails without a valid tenant');
      });
      
      return tenantId;
    } catch (error: any) {
      console.warn('⚠️ Failed to get tenant from database, using default test tenant ID:', error.message);
      return '00000000-0000-0000-0000-000000000001';
    }
  }

  /**
   * Get the current polling status
   */
  public getStatus(): { isPolling: boolean; processedCount: number; pollIntervalMs: number } {
    return {
      isPolling: this.isPolling,
      processedCount: this.processedMessageIds.size,
      pollIntervalMs: this.pollIntervalMs
    };
  }

  /**
   * Clear processed message history (useful for testing)
   */
  public clearProcessedHistory(): void {
    this.processedMessageIds.clear();
    console.log('🧹 Cleared MailHog processed message history');
  }
  
}

// Singleton instance for use in E2E tests
let mailhogPollingServiceInstance: MailHogPollingService | null = null;

/**
 * Get or create the singleton MailHog polling service instance
 */
export function getMailHogPollingService(): MailHogPollingService {
  if (!mailhogPollingServiceInstance) {
    mailhogPollingServiceInstance = new MailHogPollingService();
  }
  return mailhogPollingServiceInstance;
}

/**
 * Start MailHog polling (convenience function)
 */
export function startMailHogPolling(): void {
  getMailHogPollingService().startPolling();
}

/**
 * Stop MailHog polling (convenience function)  
 */
export function stopMailHogPolling(): void {
  if (mailhogPollingServiceInstance) {
    mailhogPollingServiceInstance.stopPolling();
  }
}
