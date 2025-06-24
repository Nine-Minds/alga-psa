/**
 * Email Providers API Route
 * Handles CRUD operations for email provider configurations
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { EmailProviderService } from '../../../../services/email/EmailProviderService';
import { withAuth } from '../../../../middleware/auth';
import { withErrorHandler } from '../../../../middleware/errorHandler';

// Validation schemas
const createProviderSchema = z.object({
  tenant: z.string().uuid(),
  providerType: z.enum(['microsoft', 'google']),
  providerName: z.string().min(1).max(255),
  mailbox: z.string().email(),
  isActive: z.boolean().default(true),
  vendorConfig: z.object({
    clientId: z.string().min(1),
    clientSecret: z.string().min(1),
    // Microsoft specific
    tenantId: z.string().optional(),
    redirectUri: z.string().url(),
    // Google specific  
    projectId: z.string().optional(),
    pubsubTopicName: z.string().optional(),
    pubsubSubscriptionName: z.string().optional(),
    // Common settings
    autoProcessEmails: z.boolean().default(true),
    maxEmailsPerSync: z.number().min(1).max(1000).default(50),
    folderFilters: z.array(z.string()).optional(),
    labelFilters: z.array(z.string()).optional()
  })
});

const querySchema = z.object({
  tenant: z.string().uuid(),
  providerType: z.enum(['microsoft', 'google']).optional(),
  isActive: z.boolean().optional()
});

async function handler(req: NextApiRequest, res: NextApiResponse) {
  switch (req.method) {
    case 'GET':
      return handleGetProviders(req, res);
    case 'POST':
      return handleCreateProvider(req, res);
    default:
      return res.status(405).json({ 
        error: 'Method not allowed',
        message: `Method ${req.method} not allowed` 
      });
  }
}

/**
 * GET /api/email/providers
 * Retrieve email providers for a tenant
 */
async function handleGetProviders(
  req: NextApiRequest, 
  res: NextApiResponse
) {
  try {
    const emailProviderService = new EmailProviderService();
    // Validate query parameters
    const query = querySchema.parse(req.query);
    
    const providers = await emailProviderService.getProviders({
      tenant: query.tenant,
      providerType: query.providerType,
      isActive: query.isActive
    });

    return res.status(200).json({
      success: true,
      providers,
      count: providers.length
    });

  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({
        error: 'Invalid query parameters',
        details: error.errors
      });
    }
    throw error;
  }
}

/**
 * POST /api/email/providers
 * Create a new email provider
 */
async function handleCreateProvider(
  req: NextApiRequest, 
  res: NextApiResponse
) {
  try {
    const emailProviderService = new EmailProviderService();
    // Validate request body
    const data = createProviderSchema.parse(req.body);
    
    // Check if provider with same mailbox already exists
    const existingProviders = await emailProviderService.getProviders({ 
      tenant: data.tenant,
      mailbox: data.mailbox 
    });
    
    if (existingProviders.length > 0) {
      return res.status(409).json({
        error: 'Provider already exists',
        message: `An email provider for ${data.mailbox} already exists`
      });
    }

    // Create the provider
    const provider = await emailProviderService.createProvider(data);

    // If the provider is active, attempt to initialize webhooks
    if (data.isActive) {
      try {
        await emailProviderService.initializeProviderWebhook(provider.id);
      } catch (webhookError: any) {
        console.warn(`Failed to initialize webhook for provider ${provider.id}:`, webhookError.message);
        // Don't fail the creation, but log the warning
      }
    }

    return res.status(201).json({
      success: true,
      provider,
      message: 'Email provider created successfully'
    });

  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({
        error: 'Invalid request data',
        details: error.errors
      });
    }
    throw error;
  }
}

export default withAuth(withErrorHandler(handler));