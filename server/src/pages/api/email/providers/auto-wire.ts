/**
 * Email Provider Auto-Wiring API Route
 * Handles automatic configuration and setup of email providers
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { EmailProviderAutoWiring } from '../../../../services/email/EmailProviderAutoWiring';
import { withAuth } from '../../../../middleware/auth';
import { withErrorHandler } from '../../../../middleware/errorHandler';

const microsoftAutoWireSchema = z.object({
  tenant: z.string().uuid(),
  providerName: z.string().min(1).max(255),
  mailbox: z.string().email(),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  tenantId: z.string().optional(),
  redirectUri: z.string().url(),
  authorizationCode: z.string().min(1)
});

const gmailAutoWireSchema = z.object({
  tenant: z.string().uuid(),
  providerName: z.string().min(1).max(255),
  mailbox: z.string().email(),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  projectId: z.string().min(1),
  redirectUri: z.string().url(),
  authorizationCode: z.string().min(1),
  pubsubTopicName: z.string().min(1),
  pubsubSubscriptionName: z.string().min(1)
});

const autoWireRequestSchema = z.object({
  providerType: z.enum(['microsoft', 'google']),
  config: z.union([microsoftAutoWireSchema, gmailAutoWireSchema])
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
    const { providerType, config } = autoWireRequestSchema.parse(req.body);
    
    console.log(`🔧 Starting auto-wiring for ${providerType} provider: ${config.mailbox}`);

    let result;

    if (providerType === 'microsoft') {
      const autoWiring = new EmailProviderAutoWiring();
      const microsoftConfig = microsoftAutoWireSchema.parse(config);
      result = await autoWiring.autoWireMicrosoft(microsoftConfig);
    } else if (providerType === 'google') {
      const autoWiring = new EmailProviderAutoWiring();
      const gmailConfig = gmailAutoWireSchema.parse(config);
      result = await autoWiring.autoWireGmail(gmailConfig);
    } else {
      return res.status(400).json({
        error: 'Invalid provider type',
        message: 'Provider type must be either "microsoft" or "google"'
      });
    }

    if (result.success) {
      console.log(`✅ Auto-wiring completed successfully for ${config.mailbox}`);
      
      return res.status(200).json({
        success: true,
        message: `${providerType} email provider configured successfully`,
        provider: result.provider,
        status: result.status,
        steps: result.steps
      });
    } else {
      console.error(`❌ Auto-wiring failed for ${config.mailbox}: ${result.error}`);
      
      return res.status(400).json({
        success: false,
        error: 'Auto-wiring failed',
        message: result.error,
        status: result.status,
        steps: result.steps
      });
    }

  } catch (error: any) {
    console.error('❌ Error in auto-wiring API:', error);
    
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