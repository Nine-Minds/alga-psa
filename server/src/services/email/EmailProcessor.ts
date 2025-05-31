import { EmailQueueJob } from '../../interfaces/email.interfaces';
import { MicrosoftGraphAdapter } from './providers/MicrosoftGraphAdapter';
import { EmailProviderConfig } from '../../interfaces/email.interfaces';

/**
 * Main email processor that coordinates email processing workflow
 * This class handles the actual processing of email jobs from the queue
 */
export class EmailProcessor {
  
  /**
   * Process an email job from the queue
   * This method coordinates the entire email processing workflow
   */
  async processEmail(job: EmailQueueJob): Promise<void> {
    console.log(`📧 Processing email: ${job.messageId} from provider ${job.providerId}`);

    try {
      // 1. Get provider configuration and create adapter
      const providerConfig = await this.getProviderConfig(job.providerId, job.tenant);
      const adapter = await this.createProviderAdapter(providerConfig);

      // 2. Get email message details
      const emailMessage = await adapter.getMessageDetails(job.messageId);

      // 3. Emit workflow event for email processing
      await this.emitEmailReceivedEvent({
        emailId: job.messageId,
        tenant: job.tenant,
        providerId: job.providerId,
        emailData: emailMessage,
      });

      // 4. Mark message as processed in the provider
      await adapter.markMessageProcessed(job.messageId);

      // 5. Record successful processing in database
      await this.recordProcessedMessage(job, emailMessage, 'success');

      console.log(`✅ Successfully processed email: ${job.messageId}`);
    } catch (error: any) {
      console.error(`❌ Failed to process email ${job.messageId}:`, error.message);
      
      // Record failed processing
      try {
        await this.recordProcessedMessage(job, null, 'failed', error.message);
      } catch (recordError) {
        console.error('Failed to record processing failure:', recordError);
      }
      
      throw error; // Re-throw to trigger retry logic
    }
  }

  /**
   * Get provider configuration from database
   */
  private async getProviderConfig(providerId: string, tenant: string): Promise<EmailProviderConfig> {
    // This would normally query the database
    // For now, return a mock configuration
    // TODO: Implement actual database query
    
    const mockConfig: EmailProviderConfig = {
      id: providerId,
      tenant: tenant,
      name: 'Test Provider',
      provider_type: 'microsoft',
      mailbox: 'test@example.com',
      folder_to_monitor: 'Inbox',
      active: true,
      webhook_notification_url: `${process.env.APP_BASE_URL}/api/email/webhooks/microsoft`,
      connection_status: 'connected',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    return mockConfig;
  }

  /**
   * Create appropriate provider adapter based on configuration
   */
  private async createProviderAdapter(config: EmailProviderConfig): Promise<MicrosoftGraphAdapter> {
    switch (config.provider_type) {
      case 'microsoft':
        return new MicrosoftGraphAdapter(config);
      case 'google':
        // TODO: Implement GmailAdapter
        throw new Error('Gmail adapter not implemented yet');
      default:
        throw new Error(`Unsupported provider type: ${config.provider_type}`);
    }
  }

  /**
   * Emit INBOUND_EMAIL_RECEIVED event to workflow system
   */
  private async emitEmailReceivedEvent(eventData: {
    emailId: string;
    tenant: string;
    providerId: string;
    emailData: any;
  }): Promise<void> {
    console.log(`📨 Emitting INBOUND_EMAIL_RECEIVED event for email ${eventData.emailId}`);
    
    // TODO: Implement actual event emission to workflow system
    // This would typically publish to the event bus or workflow system
    // For now, just log the event
    
    const event = {
      event_type: 'INBOUND_EMAIL_RECEIVED',
      payload: eventData,
      timestamp: new Date().toISOString(),
    };

    console.log('📨 Event emitted:', JSON.stringify(event, null, 2));
  }

  /**
   * Record processed message in database
   */
  private async recordProcessedMessage(
    job: EmailQueueJob,
    emailMessage: any | null,
    status: 'success' | 'failed' | 'partial',
    errorMessage?: string
  ): Promise<void> {
    console.log(`📝 Recording processed message: ${job.messageId} with status: ${status}`);

    // TODO: Implement actual database recording
    // This would insert into the email_processed_messages table
    
    const record = {
      message_id: job.messageId,
      provider_id: job.providerId,
      tenant: job.tenant,
      processed_at: new Date().toISOString(),
      processing_status: status,
      from_email: emailMessage?.from?.email,
      subject: emailMessage?.subject,
      received_at: emailMessage?.receivedAt,
      attachment_count: emailMessage?.attachments?.length || 0,
      error_message: errorMessage,
      metadata: {
        jobId: job.id,
        attempt: job.attempt,
        webhookData: job.webhookData,
      },
    };

    console.log('📝 Would record:', JSON.stringify(record, null, 2));
  }
}