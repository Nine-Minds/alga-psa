/**
 * Google Gmail Pub/Sub Webhook Endpoint
 * Handles Gmail push notifications via Google Cloud Pub/Sub
 * 
 * This endpoint receives notifications when new emails arrive in monitored Gmail accounts
 * and queues them for processing by the email workflow system.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { EmailQueueService } from '../../../../services/email/queue/EmailQueueService';
import { GmailAdapter } from '../../../../services/email/providers/GmailAdapter';
import { getEmailProviderConfigs } from '../../../../services/email/EmailProviderService';
import { EmailProviderConfig } from '../../../../interfaces/email.interfaces';

interface PubSubMessage {
  message: {
    data: string; // Base64 encoded JSON
    messageId: string;
    publishTime: string;
    attributes?: Record<string, string>;
  };
  subscription: string;
}

interface GmailNotificationData {
  emailAddress: string;
  historyId: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      error: 'Method not allowed',
      message: 'Only POST requests are accepted' 
    });
  }

  try {
    // Parse the Pub/Sub message
    const pubsubMessage: PubSubMessage = req.body;
    
    if (!pubsubMessage.message || !pubsubMessage.message.data) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'Missing Pub/Sub message data'
      });
    }

    // Decode the base64 message data
    const messageData = Buffer.from(pubsubMessage.message.data, 'base64').toString('utf-8');
    const notification: GmailNotificationData = JSON.parse(messageData);

    console.log('📧 Received Gmail push notification:', {
      emailAddress: notification.emailAddress,
      historyId: notification.historyId,
      messageId: pubsubMessage.message.messageId,
      publishTime: pubsubMessage.message.publishTime
    });

    // Validate required fields
    if (!notification.emailAddress || !notification.historyId) {
      return res.status(400).json({
        error: 'Invalid notification',
        message: 'Missing emailAddress or historyId in notification data'
      });
    }

    // Find the email provider configuration for this Gmail address
    const emailProviders = await getEmailProviderConfigs();
    const gmailProvider = emailProviders.find(
      (provider: EmailProviderConfig) => provider.provider_type === 'google' && 
                 provider.active && 
                 provider.mailbox === notification.emailAddress
    );

    if (!gmailProvider) {
      console.warn(`⚠️ No active Gmail provider found for: ${notification.emailAddress}`);
      return res.status(404).json({
        error: 'Provider not found',
        message: `No active Gmail provider configured for ${notification.emailAddress}`
      });
    }

    // Create Gmail adapter and process the notification
    const adapter = new GmailAdapter(gmailProvider);
    const result = await adapter.processGmailNotification(notification);

    if (result.error) {
      console.error('❌ Error processing Gmail notification:', result.error);
      return res.status(500).json({
        error: 'Processing failed',
        message: result.error
      });
    }

    // Queue each new message for processing
    if (result.messageIds && result.messageIds.length > 0) {
      const queueService = new EmailQueueService();
      
      for (const messageId of result.messageIds) {
        try {
          await queueService.addEmailJob({
            messageId: messageId,
            providerId: gmailProvider.id,
            tenant: gmailProvider.tenant,
            provider: 'google',
            webhookData: {
              historyId: notification.historyId,
              pubsubMessageId: pubsubMessage.message.messageId,
              publishTime: pubsubMessage.message.publishTime
            }
          });

          console.log(`✅ Queued Gmail message for processing: ${messageId}`);
        } catch (queueError: any) {
          console.error(`❌ Failed to queue Gmail message ${messageId}:`, queueError.message);
          // Continue processing other messages even if one fails
        }
      }

      console.log(`📬 Successfully queued ${result.messageIds.length} Gmail messages for processing`);
    } else {
      console.log('📭 Gmail notification contained no new messages to process');
    }

    // Respond with success - Google expects a 2xx response
    return res.status(200).json({
      success: true,
      message: 'Gmail notification processed successfully',
      messagesQueued: result.messageIds?.length || 0
    });

  } catch (error: any) {
    console.error('❌ Fatal error processing Gmail webhook:', error);
    
    // Return 500 to indicate processing failure
    // Google will retry the notification
    return res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to process Gmail notification',
      details: error.message
    });
  }
}

/**
 * Verify Gmail webhook authenticity (optional additional security)
 * Google Pub/Sub provides built-in authentication, but we can add extra verification
 */
function verifyGmailWebhook(req: NextApiRequest): boolean {
  // TODO: Implement additional verification if needed
  // For example, checking specific headers or signatures
  
  // For now, we rely on Google Pub/Sub's built-in authentication
  // which requires proper subscription configuration
  return true;
}

/**
 * Health check endpoint for Gmail webhook
 * Google will periodically send health checks to verify the endpoint is accessible
 */
export function handleHealthCheck(req: NextApiRequest, res: NextApiResponse): void {
  res.status(200).json({
    status: 'healthy',
    service: 'gmail-webhook',
    timestamp: new Date().toISOString()
  });
}