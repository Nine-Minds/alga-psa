/**
 * Google Pub/Sub Setup API Route
 * Sets up Google Cloud Pub/Sub topic and subscription for Gmail push notifications
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { GmailWebhookService } from '../../../../services/email/GmailWebhookService';
import { withAuth } from '../../../../middleware/auth';
import { withErrorHandler } from '../../../../middleware/errorHandler';

const setupPubSubSchema = z.object({
  projectId: z.string().min(1, 'Google Cloud Project ID is required'),
  topicName: z.string().min(1, 'Pub/Sub topic name is required'),
  subscriptionName: z.string().min(1, 'Pub/Sub subscription name is required'),
  webhookUrl: z.string().url('Valid webhook URL is required'),
  serviceAccountKey: z.object({}).optional() // Optional service account key for authentication
});

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      error: 'Method not allowed',
      message: 'Only POST requests are allowed' 
    });
  }

  try {
    // Validate request body
    const data = setupPubSubSchema.parse(req.body);
    
    console.log(`🔧 Setting up Google Pub/Sub for project: ${data.projectId}`);

    const gmailWebhookService = GmailWebhookService.getInstance();
    
    // Set up Pub/Sub topic and subscription
    const setupResult = await gmailWebhookService.setupGmailWebhook(
      // We don't have a provider config here, so we create a minimal one for setup
      {
        id: 'temp-setup',
        tenant: 'temp',
        providerType: 'google',
        providerName: 'Setup',
        mailbox: 'setup@temp.com',
        isActive: true,
        status: 'configuring',
        vendorConfig: {
          projectId: data.projectId,
          pubsubTopicName: data.topicName,
          pubsubSubscriptionName: data.subscriptionName
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      } as any,
      {
        projectId: data.projectId,
        topicName: data.topicName,
        subscriptionName: data.subscriptionName,
        webhookUrl: data.webhookUrl,
        serviceAccountKey: data.serviceAccountKey
      }
    );

    if (setupResult.success) {
      console.log(`✅ Pub/Sub setup completed successfully`);
      
      return res.status(200).json({
        success: true,
        message: 'Google Pub/Sub setup completed successfully',
        result: {
          topicName: setupResult.topicName,
          subscriptionName: setupResult.subscriptionName,
          webhookUrl: data.webhookUrl,
          projectId: data.projectId
        }
      });
    } else {
      console.error(`❌ Pub/Sub setup failed: ${setupResult.error}`);
      
      return res.status(500).json({
        success: false,
        error: 'Pub/Sub setup failed',
        message: setupResult.error
      });
    }

  } catch (error: any) {
    console.error('❌ Error setting up Pub/Sub:', error);
    
    if (error.name === 'ZodError') {
      return res.status(400).json({
        error: 'Invalid request data',
        details: error.errors
      });
    }

    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
}

export default withAuth(withErrorHandler(handler));