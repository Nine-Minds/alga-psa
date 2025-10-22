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
      // Get email message details
      let emailMessage;
      let providerConfig;
      
      if (job.emailData) {
        // Use provided email data (e.g., from MailHog) instead of fetching from external API
        console.log(`📧 Using provided email data for ${job.providerId}`);
        emailMessage = job.emailData;
        // Skip provider config lookup for test emails with provided data
      } else {
        // Get provider configuration for fetching from external API
        providerConfig = await this.getProviderConfig(job.providerId, job.tenant);
        const adapter = await this.createProviderAdapter(providerConfig);
        emailMessage = await adapter.getMessageDetails(job.messageId);
      }

      // 3. Emit workflow event for email processing
      await this.emitEmailReceivedEvent({
        emailId: job.messageId,
        tenant: job.tenant,
        providerId: job.providerId,
        emailData: emailMessage,
      });

      // 4. Mark message as processed in database (read-only mode - no email modification)
      // Note: markMessageProcessed is now a no-op in read-only mode
      // Email processing status is tracked in the database via recordProcessedMessage below
      console.log(`📧 Email ${job.messageId} processed in read-only mode (no mailbox modification)`);

      // Skip calling markMessageProcessed since we're now in read-only mode
      // if (!job.emailData && providerConfig) {
      //   const adapter = await this.createProviderAdapter(providerConfig);
      //   await adapter.markMessageProcessed(job.messageId);
      // }

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
    try {
      // Import database connection dynamically to avoid module resolution issues
      const { getConnection } = await import('@shared/db/connection');
      const db = await getConnection();
      
      // No special handling for test providers - all providers should be in the database
      
      // Query the actual database for real providers
      const [provider] = await db('email_provider_configs')
        .where({ id: providerId, tenant: tenant })
        .select('*');
      
      if (!provider) {
        throw new Error(`Provider ${providerId} not found for tenant ${tenant}`);
      }
      
      // Map database fields to interface
      const config: EmailProviderConfig = {
        id: provider.id,
        tenant: provider.tenant,
        name: provider.name,
        provider_type: provider.provider_type,
        mailbox: provider.mailbox,
        folder_to_monitor: provider.folder_to_monitor || 'Inbox',
        active: provider.active,
        webhook_notification_url: provider.webhook_notification_url,
        connection_status: provider.connection_status,
        created_at: provider.created_at,
        updated_at: provider.updated_at,
      };
      
      return config;
    } catch (error: any) {
      console.error(`Failed to get provider config for ${providerId}:`, error.message);
      throw error;
    }
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
    
    try {
      // Import EventBus dynamically to avoid module resolution issues
      const { getEventBus } = await import('../../lib/eventBus');
      const eventBus = getEventBus();
      
      // Publish the event to the workflow system
      await eventBus.publish({
        eventType: 'INBOUND_EMAIL_RECEIVED',
        payload: {
          tenantId: eventData.tenant,
          tenant: eventData.tenant,
          providerId: eventData.providerId,
          emailData: eventData.emailData
        }
      });
      
      console.log(`✅ INBOUND_EMAIL_RECEIVED event published for email ${eventData.emailId}`);
    } catch (error: any) {
      console.error(`❌ Failed to emit INBOUND_EMAIL_RECEIVED event for email ${eventData.emailId}:`, error.message);
      throw error;
    }
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

    try {
      // Import database connection dynamically to avoid module resolution issues
      const { getConnection } = await import('@shared/db/connection');
      const db = await getConnection();
      
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
        metadata: JSON.stringify({
          jobId: job.id,
          attempt: job.attempt,
          webhookData: job.webhookData,
        }),
      };

      // Check if table exists, if not skip recording (for E2E tests)
      const tableExists = await db.schema.hasTable('email_processed_messages');
      
      if (tableExists) {
        await db('email_processed_messages').insert(record);
        console.log(`✅ Recorded processed message: ${job.messageId}`);
      } else {
        console.log(`⚠️ email_processed_messages table not found, skipping recording for: ${job.messageId}`);
      }
    } catch (error: any) {
      console.error(`❌ Failed to record processed message ${job.messageId}:`, error.message);
      // Don't throw error here to avoid breaking the main processing flow
    }
  }
}
