import { NextApiRequest, NextApiResponse } from 'next';
import { createTenantKnex } from '@/lib/db';
import { withTransaction } from '@shared/db';
import { ExtensionRegistry } from '../../../../../ee/server/src/lib/extensions/registry';
import { withAuth } from '@/middleware/auth';
import { withErrorHandler } from '@/middleware/errorHandler';
import logger from '@shared/core/logger';
import { Knex } from 'knex';

/**
 * API endpoint for individual extension operations
 * GET /api/extensions/[extensionId] - Get extension details
 * PUT /api/extensions/[extensionId] - Update extension (enable/disable)
 * DELETE /api/extensions/[extensionId] - Uninstall extension
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { knex, tenant } = await createTenantKnex();
  
  if (!tenant) {
    return res.status(400).json({ error: 'Tenant not found' });
  }

  const extensionId = req.query.extensionId as string;

  if (!extensionId) {
    return res.status(400).json({ error: 'Extension ID is required' });
  }

  switch (req.method) {
    case 'GET':
      return handleGetExtension(knex, tenant, extensionId, res);
    case 'PUT':
      return handleUpdateExtension(knex, tenant, extensionId, req, res);
    case 'DELETE':
      return handleDeleteExtension(knex, tenant, extensionId, res);
    default:
      return res.status(405).json({ error: 'Method not allowed' });
  }
}

/**
 * Handle GET request to fetch extension details
 */
async function handleGetExtension(
  knex: Knex,
  tenant: string,
  extensionId: string,
  res: NextApiResponse
) {
  try {
    const extension = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const registry = new ExtensionRegistry(trx);
      return await registry.getExtension(extensionId, { tenant_id: tenant });
    });

    if (!extension) {
      return res.status(404).json({ error: 'Extension not found' });
    }

    logger.info('Fetched extension details', { 
      tenant,
      extensionId,
      name: extension.name
    });

    return res.status(200).json({ extension });
  } catch (error) {
    logger.error('Failed to fetch extension', { extensionId, error });
    return res.status(500).json({ error: 'Failed to fetch extension' });
  }
}

/**
 * Handle PUT request to update extension (enable/disable)
 */
async function handleUpdateExtension(
  knex: Knex,
  tenant: string,
  extensionId: string,
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ 
        error: 'Invalid request body. Expected { enabled: boolean }' 
      });
    }

    const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const registry = new ExtensionRegistry(trx);
      
      const extension = await registry.getExtension(extensionId, { tenant_id: tenant });
      if (!extension) {
        throw new Error('Extension not found');
      }

      if (enabled) {
        await registry.enableExtension(extensionId, { tenant_id: tenant });
      } else {
        await registry.disableExtension(extensionId, { tenant_id: tenant });
      }

      return { 
        success: true, 
        extension: await registry.getExtension(extensionId, { tenant_id: tenant })
      };
    });

    logger.info('Updated extension status', { 
      tenant,
      extensionId,
      enabled
    });

    return res.status(200).json(result);
  } catch (error) {
    logger.error('Failed to update extension', { extensionId, error });
    const errorMessage = error instanceof Error ? error.message : 'Failed to update extension';
    return res.status(500).json({ error: errorMessage });
  }
}

/**
 * Handle DELETE request to uninstall extension
 */
async function handleDeleteExtension(
  knex: Knex,
  tenant: string,
  extensionId: string,
  res: NextApiResponse
) {
  try {
    const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const registry = new ExtensionRegistry(trx);
      
      const extension = await registry.getExtension(extensionId, { tenant_id: tenant });
      if (!extension) {
        throw new Error('Extension not found');
      }

      await registry.uninstallExtension(extensionId, { tenant_id: tenant });
      return { success: true, name: extension.name };
    });

    logger.info('Uninstalled extension', { 
      tenant,
      extensionId,
      name: result.name
    });

    return res.status(200).json(result);
  } catch (error) {
    logger.error('Failed to uninstall extension', { extensionId, error });
    const errorMessage = error instanceof Error ? error.message : 'Failed to uninstall extension';
    return res.status(500).json({ error: errorMessage });
  }
}

export default withAuth(withErrorHandler(handler));