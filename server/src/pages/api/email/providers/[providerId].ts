/**
 * Email Provider API Route (Single Provider)
 * Handles operations for individual email provider configurations
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { EmailProviderService } from '../../../../services/email/EmailProviderService';
import { withAuth } from '../../../../middleware/auth';
import { withErrorHandler } from '../../../../middleware/errorHandler';

// Validation schemas
const updateProviderSchema = z.object({
  providerName: z.string().min(1).max(255).optional(),
  mailbox: z.string().email().optional(),
  isActive: z.boolean().optional(),
  vendorConfig: z.object({
    clientId: z.string().min(1).optional(),
    clientSecret: z.string().min(1).optional(),
    tenantId: z.string().optional(),
    projectId: z.string().optional(),
    redirectUri: z.string().url().optional(),
    pubsubTopicName: z.string().optional(),
    pubsubSubscriptionName: z.string().optional(),
    autoProcessEmails: z.boolean().optional(),
    maxEmailsPerSync: z.number().min(1).max(1000).optional(),
    folderFilters: z.array(z.string()).optional(),
    labelFilters: z.array(z.string()).optional()
  }).optional()
});

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const emailProviderService = new EmailProviderService();
  const { providerId } = req.query;

  if (!providerId || typeof providerId !== 'string') {
    return res.status(400).json({
      error: 'Invalid provider ID',
      message: 'Provider ID is required and must be a valid UUID'
    });
  }

  switch (req.method) {
    case 'GET':
      return handleGetProvider(req, res, emailProviderService, providerId);
    case 'PUT':
      return handleUpdateProvider(req, res, emailProviderService, providerId);
    case 'DELETE':
      return handleDeleteProvider(req, res, emailProviderService, providerId);
    default:
      return res.status(405).json({ 
        error: 'Method not allowed',
        message: `Method ${req.method} not allowed` 
      });
  }
}

/**
 * GET /api/email/providers/[providerId]
 * Retrieve a specific email provider
 */
async function handleGetProvider(
  req: NextApiRequest, 
  res: NextApiResponse, 
  service: EmailProviderService,
  providerId: string
) {
  try {
    const provider = await service.getProvider(providerId);
    
    if (!provider) {
      return res.status(404).json({
        error: 'Provider not found',
        message: `Email provider with ID ${providerId} not found`
      });
    }

    return res.status(200).json({
      success: true,
      provider
    });

  } catch (error: any) {
    throw error;
  }
}

/**
 * PUT /api/email/providers/[providerId]
 * Update an existing email provider
 */
async function handleUpdateProvider(
  req: NextApiRequest, 
  res: NextApiResponse, 
  service: EmailProviderService,
  providerId: string
) {
  try {
    // Validate request body
    const data = updateProviderSchema.parse(req.body);
    
    // Check if provider exists
    const existingProvider = await service.getProvider(providerId);
    if (!existingProvider) {
      return res.status(404).json({
        error: 'Provider not found',
        message: `Email provider with ID ${providerId} not found`
      });
    }

    // Update the provider
    const updatedProvider = await service.updateProvider(providerId, data);

    // Handle webhook reinitialization if necessary
    if (data.isActive !== undefined || data.vendorConfig) {
      try {
        if (updatedProvider.active) {
          await service.initializeProviderWebhook(providerId);
        } else {
          await service.deactivateProviderWebhook(providerId);
        }
      } catch (webhookError: any) {
        console.warn(`Failed to update webhook for provider ${providerId}:`, webhookError.message);
        // Don't fail the update, but log the warning
      }
    }

    return res.status(200).json({
      success: true,
      provider: updatedProvider,
      message: 'Email provider updated successfully'
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

/**
 * DELETE /api/email/providers/[providerId]
 * Delete an email provider
 */
async function handleDeleteProvider(
  req: NextApiRequest, 
  res: NextApiResponse, 
  service: EmailProviderService,
  providerId: string
) {
  try {
    // Check if provider exists
    const provider = await service.getProvider(providerId);
    if (!provider) {
      return res.status(404).json({
        error: 'Provider not found',
        message: `Email provider with ID ${providerId} not found`
      });
    }

    // Deactivate webhook before deletion
    if (provider.active) {
      try {
        await service.deactivateProviderWebhook(providerId);
      } catch (webhookError: any) {
        console.warn(`Failed to deactivate webhook for provider ${providerId}:`, webhookError.message);
        // Continue with deletion anyway
      }
    }

    // Delete the provider
    await service.deleteProvider(providerId);

    return res.status(200).json({
      success: true,
      message: 'Email provider deleted successfully'
    });

  } catch (error: any) {
    throw error;
  }
}

export default withAuth(withErrorHandler(handler));