/**
 * Gmail Webhook Service
 * Handles Gmail-specific webhook operations and Pub/Sub integration
 */

import { EmailProviderConfig } from '@alga-psa/shared/interfaces/inbound-email.interfaces';
import { GmailAdapter } from './providers/GmailAdapter';

export interface GmailPubSubSetupOptions {
  projectId: string;
  topicName: string;
  subscriptionName: string;
  webhookUrl: string;
  serviceAccountKey?: any;
}

export interface GmailWatchRegistrationResult {
  success: boolean;
  historyId?: string;
  expiration?: string;
  error?: string;
}

export class GmailWebhookService {
  private static instance: GmailWebhookService;

  public static getInstance(): GmailWebhookService {
    if (!GmailWebhookService.instance) {
      GmailWebhookService.instance = new GmailWebhookService();
    }
    return GmailWebhookService.instance;
  }

  /**
   * Register Gmail watch subscription only (no Pub/Sub setup)
   * Pub/Sub topic and subscription should already be created by configureGmailProvider
   */
  async registerWatch(
    providerConfig: EmailProviderConfig,
    pubsubOptions: GmailPubSubSetupOptions
  ): Promise<GmailWatchRegistrationResult> {
    try {
      console.log(`📧 Registering Gmail watch for: ${providerConfig.mailbox}`);

      // Register Gmail watch with the existing Pub/Sub topic
      const gmailAdapter = new GmailAdapter(providerConfig);
      await gmailAdapter.registerWebhookSubscription();
      
      console.log(`✅ Gmail watch registration completed for: ${providerConfig.mailbox}`);

      // Get the real historyId and expiration from the Gmail adapter after registration
      const adapterConfig = gmailAdapter.getConfig();
      const historyId = adapterConfig.provider_config?.history_id || undefined;
      const expiration = adapterConfig.provider_config?.watch_expiration || undefined;

      return {
        success: true,
        historyId: historyId,
        expiration: expiration
      };

    } catch (error: any) {
      console.error('❌ Failed to register Gmail watch:', error);
      return {
        success: false,
        error: `Gmail watch registration failed: ${error.message}`
      };
    }
  }

  /**
   * Remove Gmail webhook integration
   */
  async removeGmailWebhook(
    providerConfig: EmailProviderConfig,
    pubsubOptions: GmailPubSubSetupOptions
  ): Promise<{ success: boolean; error?: string }> {
    try {
      console.log(`📧 Removing Gmail webhook for: ${providerConfig.mailbox}`);

      // Step 1: Stop Gmail watch
      const gmailAdapter = new GmailAdapter(providerConfig);
      await this.stopGmailWatch(gmailAdapter);

      // Step 2: Clean up Pub/Sub subscription (optional)
      // await this.deletePubSubSubscription(pubsubOptions);

      console.log(`✅ Gmail webhook removed for: ${providerConfig.mailbox}`);
      
      return { success: true };

    } catch (error: any) {
      console.error('❌ Failed to remove Gmail webhook:', error);
      return {
        success: false,
        error: `Gmail webhook removal failed: ${error.message}`
      };
    }
  }

  // Note: Pub/Sub topic and subscription creation is now handled by the setupPubSub function

  /**
   * Stop Gmail watch for a provider
   */
  private async stopGmailWatch(adapter: GmailAdapter): Promise<void> {
    try {
      console.log('[MOCK] Stopping Gmail watch');
      
      // TODO: Implement actual Gmail watch stop
      // This would call the Gmail API to stop watching:
      // POST https://gmail.googleapis.com/gmail/v1/users/me/stop
      
      console.log('✅ Gmail watch stopped');
      
    } catch (error: any) {
      console.warn(`⚠️ Failed to stop Gmail watch: ${error.message}`);
      // Don't throw - this is cleanup, best effort
    }
  }

  /**
   * Process Gmail history to find new messages
   */
  async processGmailHistory(
    adapter: GmailAdapter,
    historyId: string,
    emailAddress: string
  ): Promise<{ messageIds: string[]; error?: string }> {
    try {
      console.log(`📧 Processing Gmail history since: ${historyId} for: ${emailAddress}`);

      // TODO: Implement actual Gmail history processing
      // This would:
      // 1. Call Gmail API to get history since historyId
      // 2. Filter for messagesAdded events
      // 3. Return the list of new message IDs
      
      // Mock implementation
      console.log(`[MOCK] Processing Gmail history`);
      
      return {
        messageIds: ['gmail-msg-new-1', 'gmail-msg-new-2']
      };

    } catch (error: any) {
      console.error('❌ Error processing Gmail history:', error);
      return {
        messageIds: [],
        error: `Failed to process Gmail history: ${error.message}`
      };
    }
  }

  /**
   * Validate Gmail push notification
   */
  validateGmailNotification(notification: any): {
    isValid: boolean;
    emailAddress?: string;
    historyId?: string;
    error?: string;
  } {
    try {
      if (!notification.emailAddress || !notification.historyId) {
        return {
          isValid: false,
          error: 'Missing required fields: emailAddress or historyId'
        };
      }

      // Additional validation can be added here
      return {
        isValid: true,
        emailAddress: notification.emailAddress,
        historyId: notification.historyId
      };

    } catch (error: any) {
      return {
        isValid: false,
        error: `Validation failed: ${error.message}`
      };
    }
  }
}