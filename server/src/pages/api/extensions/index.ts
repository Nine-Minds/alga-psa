import { NextApiRequest, NextApiResponse } from 'next';
import { createTenantKnex } from '@/lib/db';
import { withTransaction } from '@shared/db';
import { ExtensionRegistry } from '../../../../../ee/server/src/lib/extensions/registry';
import { withAuth } from '@/middleware/auth';
import { withErrorHandler } from '@/middleware/errorHandler';
import logger from '@shared/core/logger';
import { Knex } from 'knex';

/**
 * API endpoint for extension management
 * GET /api/extensions - List all extensions
 * POST /api/extensions - Install a new extension
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { knex, tenant } = await createTenantKnex();
  
  if (!tenant) {
    return res.status(400).json({ error: 'Tenant not found' });
  }

  switch (req.method) {
    case 'GET':
      return handleGetExtensions(knex, tenant, req, res);
    case 'POST':
      return handleInstallExtension(knex, tenant, req, res);
    default:
      return res.status(405).json({ error: 'Method not allowed' });
  }
}

/**
 * Handle GET request to list all extensions
 */
async function handleGetExtensions(
  knex: Knex,
  tenant: string,
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    const { enabled } = req.query;
    
    const extensions = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const registry = new ExtensionRegistry(trx);
      const allExtensions = await registry.listExtensions({ tenant_id: tenant });
      
      // Filter by enabled status if requested
      if (enabled === 'true') {
        return allExtensions.filter(ext => ext.is_enabled);
      } else if (enabled === 'false') {
        return allExtensions.filter(ext => !ext.is_enabled);
      }
      
      return allExtensions;
    });

    logger.info('Fetched extensions', { 
      tenant, 
      count: extensions.length,
      enabled: enabled || 'all'
    });

    return res.status(200).json({ extensions });
  } catch (error) {
    logger.error('Failed to fetch extensions', { error });
    return res.status(500).json({ error: 'Failed to fetch extensions' });
  }
}

/**
 * Handle POST request to install a new extension
 */
async function handleInstallExtension(
  knex: Knex,
  tenant: string,
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    const { manifest } = req.body;
    
    if (!manifest) {
      return res.status(400).json({ error: 'Extension manifest is required' });
    }

    const extension = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const registry = new ExtensionRegistry(trx);
      return await registry.registerExtension(manifest, { tenant_id: tenant });
    });

    logger.info('Extension installed', { 
      tenant,
      extensionId: extension.id,
      name: extension.name
    });

    return res.status(201).json({ extension });
  } catch (error) {
    logger.error('Failed to install extension', { error });
    return res.status(500).json({ error: 'Failed to install extension' });
  }
}

export default withAuth(withErrorHandler(handler));