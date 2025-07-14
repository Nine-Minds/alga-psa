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
      
      // In test environment, use a default test configuration
      const toEmail = emailData.to[0]?.email || 'test@example.com';
      console.log(`📧 Processing email to: ${toEmail}`);
      
      // For MailHog test environment, we'll use a default test configuration
      // This allows us to process emails without requiring provider setup
      const testTenant = await this.getDefaultTenant();
      const provider = {
        id: 'test-provider-' + uuidv4(),
        provider_type: 'test',
        tenant: testTenant,
        mailbox: toEmail
      };
      
      console.log(`📧 Using test configuration for tenant: ${testTenant}`);
      
      // Create an email processing job
      const emailJob: EmailQueueJob = {
        id: uuidv4(),
        messageId: emailData.id,
        providerId: provider.id,
        provider: provider.provider_type === 'test' ? 'microsoft' : provider.provider_type, // Map test to microsoft
        tenant: provider.tenant,
        attempt: 1,
        maxRetries: 3,
        createdAt: new Date().toISOString(),
        webhookData: {
          source: 'mailhog',
          originalMessageId: mailhogMessage.ID
        },
        // Include the already-converted email data so EmailProcessor doesn't need to fetch it
        emailData: {
          ...emailData,
          provider: provider.provider_type === 'test' ? 'microsoft' as const : provider.provider_type,
          providerId: provider.id,
          tenant: provider.tenant
        }
      };

      // Process the email directly (bypassing queue for simplicity in tests)
      await this.emailProcessor.processEmail(emailJob);
      
      console.log(`✅ Successfully processed MailHog email: ${emailData.subject}`);
    } catch (error: any) {
      console.error(`❌ Failed to process MailHog message ${mailhogMessage.ID}:`, error.message);
    }
  }

  /**
   * Convert MailHog message format to our standard email data format
   */
  private convertMailHogToEmailData(mailhogMessage: any): any {
    // MailHog message structure - headers can be in Content.Headers or Raw.Headers
    const headers = mailhogMessage.Content?.Headers || mailhogMessage.Raw?.Headers || {};
    
    // Extract email addresses
    const fromHeader = headers.From?.[0] || '';
    const toHeader = headers.To?.[0] || '';
    
    // Parse from address
    const fromMatch = fromHeader.match(/(.*?)\s*<(.+?)>|(.+)/);
    const fromEmail = fromMatch ? (fromMatch[2] || fromMatch[3] || fromMatch[1]).trim() : '';
    const fromName = fromMatch && fromMatch[2] ? fromMatch[1].trim().replace(/"/g, '') : '';
    
    // Parse to addresses
    const toEmails = toHeader.split(',').map((email: string) => {
      const toMatch = email.trim().match(/(.*?)\s*<(.+?)>|(.+)/);
      const emailAddr = toMatch ? (toMatch[2] || toMatch[3] || toMatch[1]).trim() : '';
      const name = toMatch && toMatch[2] ? toMatch[1].trim().replace(/"/g, '') : '';
      return { email: emailAddr, name };
    });

    return {
      id: mailhogMessage.ID,
      subject: headers.Subject?.[0] || '(No Subject)',
      from: {
        email: fromEmail || 'unknown@example.com', // Ensure valid email
        name: fromName || undefined // Use undefined instead of null for optional fields
      },
      to: toEmails.map((to: any) => ({
        email: to.email || 'unknown@example.com', // Ensure valid email
        name: to.name || undefined // Use undefined instead of null
      })),
      body: {
        text: mailhogMessage.Content?.Body || '',
        html: undefined // Use undefined instead of null for optional fields
      },
      receivedAt: new Date().toISOString(),
      attachments: [], // MailHog attachments would need more complex parsing
      threadId: headers['Message-ID']?.[0] || undefined, // Use undefined instead of null
      inReplyTo: headers['In-Reply-To']?.[0] || undefined, // Use undefined instead of null
      references: headers.References ? headers.References[0].split(/\s+/) : []
    };
  }

  /**
   * Get a default tenant for email processing
   * In E2E tests, this gets the first available tenant
   */
  private async getDefaultTenant(): Promise<string> {
    try {
      // Import database connection dynamically to avoid circular dependencies
      const { getConnection } = await import('@shared/db/connection');
      const db = await getConnection();
      
      // Get the first available tenant from the database
      const tenant = await db('tenants').select('tenant').first();
      
      if (!tenant) {
        throw new Error('No tenants found in database - test setup may be incomplete');
      }
      
      return tenant.tenant;
    } catch (error: any) {
      console.error('❌ Failed to get tenant for email processing:', error.message);
      // Fallback to a default tenant ID for E2E testing
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