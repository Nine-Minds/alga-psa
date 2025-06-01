import { NextApiRequest, NextApiResponse } from 'next';
import { EmailQueueService } from '../../../../services/email/queue/EmailQueueService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'POST') {
    return handleMicrosoftWebhook(req, res);
  } else if (req.method === 'GET') {
    return handleWebhookValidation(req, res);
  } else {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

/**
 * Handle Microsoft Graph webhook notifications
 */
async function handleMicrosoftWebhook(req: NextApiRequest, res: NextApiResponse) {
  try {
    console.log('📧 Received Microsoft webhook notification');

    const notifications = req.body;
    
    if (!notifications || !notifications.value || !Array.isArray(notifications.value)) {
      console.warn('⚠️ Invalid webhook payload format');
      return res.status(400).json({ error: 'Invalid payload format' });
    }

    const emailQueue = new EmailQueueService();
    await emailQueue.connect();

    const jobPromises = [];

    for (const notification of notifications.value) {
      try {
        // Validate webhook notification
        if (!isValidMicrosoftNotification(notification)) {
          console.warn('⚠️ Invalid notification format:', notification);
          continue;
        }

        // Extract tenant from the webhook URL or client state
        // For MVP, we'll need to implement a way to map webhook notifications to tenants
        const tenant = await extractTenantFromNotification(notification);
        
        if (!tenant) {
          console.warn('⚠️ Could not determine tenant for notification');
          continue;
        }

        // Extract provider ID (this would come from the webhook URL routing or configuration)
        const providerId = await extractProviderIdFromNotification(notification);
        
        if (!providerId) {
          console.warn('⚠️ Could not determine provider ID for notification');
          continue;
        }

        // Create email processing job
        const jobPromise = emailQueue.addEmailJob({
          tenant,
          provider: 'microsoft',
          messageId: notification.resourceData.id,
          providerId,
          webhookData: notification,
        });

        jobPromises.push(jobPromise);
        
        console.log(`📧 Queued email processing job for message: ${notification.resourceData.id}`);
      } catch (error) {
        console.error('❌ Error processing notification:', error);
        // Continue processing other notifications
      }
    }

    // Wait for all jobs to be queued
    await Promise.all(jobPromises);

    await emailQueue.disconnect();

    // Return success response to Microsoft
    return res.status(200).json({ 
      status: 'success',
      processedNotifications: jobPromises.length 
    });

  } catch (error: any) {
    console.error('❌ Error handling Microsoft webhook:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
}

/**
 * Handle webhook validation (subscription verification)
 * Microsoft sends a GET request with validationToken parameter
 */
async function handleWebhookValidation(req: NextApiRequest, res: NextApiResponse) {
  const validationToken = req.query.validationToken;
  
  if (!validationToken || typeof validationToken !== 'string') {
    console.warn('⚠️ Missing validation token in webhook validation request');
    return res.status(400).json({ error: 'Missing validation token' });
  }

  console.log('✅ Microsoft webhook validation successful');
  
  // Return the validation token as plain text (required by Microsoft)
  res.setHeader('Content-Type', 'text/plain');
  return res.status(200).send(validationToken);
}

/**
 * Validate Microsoft Graph notification format
 */
function isValidMicrosoftNotification(notification: any): boolean {
  return (
    notification &&
    notification.changeType &&
    notification.resourceData &&
    notification.resourceData.id &&
    notification.subscriptionId
  );
}

/**
 * Extract tenant ID from webhook notification
 * This is a placeholder implementation - in practice, you might:
 * 1. Use the clientState field to store tenant info
 * 2. Look up the subscription ID in your database
 * 3. Use URL routing with tenant-specific webhook URLs
 */
async function extractTenantFromNotification(notification: any): Promise<string | null> {
  try {
    // Method 1: Extract from clientState if we store tenant info there
    if (notification.clientState) {
      // If clientState contains tenant info (e.g., "tenant-123-verification-token")
      const match = notification.clientState.match(/tenant-([^-]+)/);
      if (match) {
        return match[1];
      }
    }

    // Method 2: Look up subscription in database to find associated tenant
    // TODO: Implement database lookup
    // const subscription = await lookupSubscription(notification.subscriptionId);
    // return subscription?.tenant;

    // Method 3: For MVP, we could use a default tenant or extract from URL
    // This is not production-ready and should be replaced with proper tenant mapping
    console.warn('⚠️ Using fallback tenant extraction - not production ready');
    return process.env.DEFAULT_TENANT_ID || null;

  } catch (error) {
    console.error('❌ Error extracting tenant from notification:', error);
    return null;
  }
}

/**
 * Extract provider ID from webhook notification
 * Similar to tenant extraction, this needs proper implementation
 */
async function extractProviderIdFromNotification(notification: any): Promise<string | null> {
  try {
    // For MVP, we could use the subscription ID as provider ID
    // or look it up in the database
    // TODO: Implement proper provider ID mapping
    
    console.warn('⚠️ Using fallback provider ID extraction - not production ready');
    return notification.subscriptionId || 'default-provider-id';

  } catch (error) {
    console.error('❌ Error extracting provider ID from notification:', error);
    return null;
  }
}