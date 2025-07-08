import { EmailProcessor } from './EmailProcessor';
import { EmailQueueService } from './queue/EmailQueueService';
import { EmailQueueJob } from '../../interfaces/email.interfaces';
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

  constructor(options: {
    pollIntervalMs?: number;
    mailhogApiUrl?: string;
  } = {}) {
    this.pollIntervalMs = options.pollIntervalMs || 2000; // Poll every 2 seconds by default
    this.mailhogApiUrl = options.mailhogApiUrl || 'http://localhost:8025/api/v1';
    this.emailProcessor = new EmailProcessor();
    this.emailQueueService = new EmailQueueService();
  }

  /**
   * Start polling MailHog for new emails
   */
  public startPolling(): void {
    if (this.isPolling) {
      console.log('📧 MailHog polling is already running');
      return;
    }

    console.log(`📧 Starting MailHog polling every ${this.pollIntervalMs}ms`);
    this.isPolling = true;

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
      
      // Create an email processing job
      const emailJob: EmailQueueJob = {
        id: uuidv4(),
        messageId: emailData.id,
        providerId: 'mailhog-test-provider', // Special provider ID for MailHog
        tenant: tenantId,
        attempt: 1,
        maxRetries: 3,
        createdAt: new Date().toISOString(),
        webhookData: {
          source: 'mailhog',
          originalMessageId: mailhogMessage.ID
        }
      };

      // For MailHog test emails, emit the event directly instead of using EmailProcessor
      // which requires Microsoft Graph credentials
      await this.emitEmailReceivedEvent({
        tenant: tenantId,
        providerId: 'mailhog-test-provider',
        emailData: emailData
      });
      
      console.log(`✅ Successfully processed MailHog email: ${emailData.subject}`);
    } catch (error: any) {
      console.error(`❌ Failed to process MailHog message ${mailhogMessage.ID}:`, error.message);
    }
  }

  /**
   * Convert MailHog message format to our standard email data format
   */
  private convertMailHogToEmailData(mailhogMessage: any): any {
    const rawMessage = mailhogMessage.Raw || {};
    const headers = rawMessage.Headers || {};
    
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
    }).filter(e => e.email && e.email.includes('@')); // Filter out invalid emails

    return {
      id: mailhogMessage.ID,
      subject: headers.Subject?.[0] || '(No Subject)',
      from: {
        email: validFromEmail,
        name: fromName || ''
      },
      to: toEmails,
      body: {
        text: mailhogMessage.Content?.Body || '',
        html: '' // MailHog doesn't separate HTML/text in our simple case
      },
      receivedAt: new Date().toISOString(),
      attachments: [], // MailHog attachments would need more complex parsing
      threadId: headers['Message-ID']?.[0] || '',
      inReplyTo: headers['In-Reply-To']?.[0] || '',
      references: headers.References ? headers.References[0].split(/\s+/) : []
    };
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
          tenantId: eventData.tenant,
          providerId: eventData.providerId,
          emailData: eventData.emailData
        }
      });
      
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
    // For MailHog testing, use the default test tenant ID
    // This avoids database connection issues during tests
    return '00000000-0000-0000-0000-000000000001';
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