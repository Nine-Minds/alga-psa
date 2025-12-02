import { EmailQueueService } from './queue/EmailQueueService';
import { EmailProviderConfig } from '@alga-psa/shared/interfaces/inbound-email.interfaces';

/**
 * Central service for managing email webhook processing
 * Coordinates between webhook endpoints and email processing queue
 */
export class EmailWebhookService {
  private emailQueue: EmailQueueService;

  constructor() {
    this.emailQueue = new EmailQueueService();
  }

  /**
   * Initialize the webhook service
   */
  async initialize(): Promise<void> {
    await this.emailQueue.connect();
    console.log('✅ Email webhook service initialized');
  }

  /**
   * Shutdown the webhook service
   */
  async shutdown(): Promise<void> {
    await this.emailQueue.disconnect();
    console.log('🔌 Email webhook service shutdown');
  }

  /**
   * Process Microsoft Graph webhook notification
   */
  async processMicrosoftWebhook(
    notifications: any[],
    defaultTenant?: string,
    defaultProviderId?: string
  ): Promise<{ success: number; failed: number; }> {
    let successCount = 0;
    let failedCount = 0;

    for (const notification of notifications) {
      try {
        if (!this.isValidMicrosoftNotification(notification)) {
          console.warn('⚠️ Invalid Microsoft notification format:', notification);
          failedCount++;
          continue;
        }

        // Extract tenant and provider info
        const tenant = await this.extractTenantFromMicrosoftNotification(notification) || defaultTenant;
        const providerId = await this.extractProviderIdFromMicrosoftNotification(notification) || defaultProviderId;

        if (!tenant || !providerId) {
          console.warn('⚠️ Missing tenant or provider ID for notification');
          failedCount++;
          continue;
        }

        // Queue email for processing
        const jobId = await this.emailQueue.addEmailJob({
          tenant,
          provider: 'microsoft',
          messageId: notification.resourceData.id,
          providerId,
          webhookData: notification,
        });

        console.log(`📧 Queued Microsoft email job: ${jobId}`);
        successCount++;

      } catch (error) {
        console.error('❌ Error processing Microsoft notification:', error);
        failedCount++;
      }
    }

    return { success: successCount, failed: failedCount };
  }

  /**
   * Process Gmail webhook notification
   */
  async processGmailWebhook(
    pubsubMessage: any,
    defaultTenant?: string,
    defaultProviderId?: string
  ): Promise<{ success: number; failed: number; }> {
    try {
      // Decode Pub/Sub message
      const messageData = pubsubMessage.data ? 
        JSON.parse(Buffer.from(pubsubMessage.data, 'base64').toString()) : 
        {};

      if (!this.isValidGmailNotification(messageData)) {
        console.warn('⚠️ Invalid Gmail notification format:', messageData);
        return { success: 0, failed: 1 };
      }

      // Extract tenant and provider info
      const tenant = await this.extractTenantFromGmailNotification(messageData) || defaultTenant;
      const providerId = await this.extractProviderIdFromGmailNotification(messageData) || defaultProviderId;

      if (!tenant || !providerId) {
        console.warn('⚠️ Missing tenant or provider ID for Gmail notification');
        return { success: 0, failed: 1 };
      }

      // Queue email for processing
      const jobId = await this.emailQueue.addEmailJob({
        tenant,
        provider: 'google',
        messageId: messageData.historyId || messageData.emailAddress, // Gmail uses historyId
        providerId,
        webhookData: messageData,
      });

      console.log(`📧 Queued Gmail email job: ${jobId}`);
      return { success: 1, failed: 0 };

    } catch (error) {
      console.error('❌ Error processing Gmail notification:', error);
      return { success: 0, failed: 1 };
    }
  }

  /**
   * Get webhook statistics
   */
  async getWebhookStats(): Promise<{
    queueStats: { processing: number; failed: number; };
  }> {
    const queueStats = await this.emailQueue.getQueueStats();
    return { queueStats };
  }

  /**
   * Retry failed webhook processing
   */
  async retryFailedWebhook(jobIndex: number): Promise<void> {
    await this.emailQueue.retryFailedJob(jobIndex);
  }

  /**
   * Get failed webhook jobs
   */
  async getFailedWebhooks(limit: number = 10): Promise<any[]> {
    return await this.emailQueue.getFailedJobs(limit);
  }

  // Private validation methods

  private isValidMicrosoftNotification(notification: any): boolean {
    return (
      notification &&
      notification.changeType &&
      notification.resourceData &&
      notification.resourceData.id &&
      notification.subscriptionId
    );
  }

  private isValidGmailNotification(messageData: any): boolean {
    return (
      messageData &&
      (messageData.historyId || messageData.emailAddress)
    );
  }

  // Private extraction methods (these need proper implementation)

  private async extractTenantFromMicrosoftNotification(notification: any): Promise<string | null> {
    // TODO: Implement proper tenant extraction
    // This could be done via:
    // 1. clientState field containing tenant info
    // 2. Database lookup of subscription ID
    // 3. URL routing with tenant-specific endpoints
    
    if (notification.clientState) {
      const match = notification.clientState.match(/tenant-([^-]+)/);
      if (match) {
        return match[1];
      }
    }

    return null;
  }

  private async extractProviderIdFromMicrosoftNotification(notification: any): Promise<string | null> {
    // TODO: Implement proper provider ID extraction
    // For now, use subscription ID as provider ID
    return notification.subscriptionId || null;
  }

  private async extractTenantFromGmailNotification(messageData: any): Promise<string | null> {
    // TODO: Implement proper tenant extraction for Gmail
    // This would typically involve looking up the email address or topic
    return null;
  }

  private async extractProviderIdFromGmailNotification(messageData: any): Promise<string | null> {
    // TODO: Implement proper provider ID extraction for Gmail
    return messageData.emailAddress || null;
  }

  /**
   * Validate webhook configuration for a provider
   */
  async validateWebhookConfig(config: EmailProviderConfig): Promise<{
    valid: boolean;
    errors: string[];
  }> {
    const errors: string[] = [];

    // Check required webhook fields
    if (!config.webhook_notification_url) {
      errors.push('Missing webhook notification URL');
    }

    if (!config.webhook_verification_token) {
      errors.push('Missing webhook verification token');
    }

    // Provider-specific validation
    switch (config.provider_type) {
      case 'microsoft':
        if (!config.webhook_notification_url?.includes('/microsoft')) {
          errors.push('Microsoft webhook URL should contain /microsoft path');
        }
        break;

      case 'google':
        if (!config.webhook_notification_url?.includes('/google')) {
          errors.push('Google webhook URL should contain /google path');
        }
        if (!config.provider_config?.pubsub_topic_name) {
          errors.push('Gmail provider requires Pub/Sub topic configuration');
        }
        break;
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}