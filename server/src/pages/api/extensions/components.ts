import { NextApiRequest, NextApiResponse } from 'next';
import { createTenantKnex } from '@/lib/db';
import { withTransaction } from '@shared/db';
import { ExtensionRegistry } from '../../../../../ee/server/src/lib/extensions/registry';
import { withAuth } from '@/middleware/auth';
import { withErrorHandler } from '@/middleware/errorHandler';
import logger from '@shared/core/logger';
import { Knex } from 'knex';

/**
 * API endpoint to fetch extension components by slot or type
 * GET /api/extensions/components?slot=main-nav
 * GET /api/extensions/components?type=navigation
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { knex, tenant } = await createTenantKnex();
    
    if (!tenant) {
      return res.status(400).json({ error: 'Tenant not found' });
    }

    const { slot, type } = req.query;

    if (!slot && !type) {
      return res.status(400).json({ 
        error: 'Either slot or type parameter is required' 
      });
    }

    const components = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const registry = new ExtensionRegistry(trx);
      
      if (slot && typeof slot === 'string') {
        return await registry.getComponentsBySlot(slot, { tenant_id: tenant });
      } else if (type && typeof type === 'string') {
        return await registry.getComponentsByType(type as any, { tenant_id: tenant });
      }
      
      return [];
    });

    logger.info('Fetched extension components', { 
      tenant, 
      slot,
      type,
      count: components.length 
    });

    return res.status(200).json({ components });
  } catch (error) {
    logger.error('Failed to fetch extension components', { error });
    return res.status(500).json({ error: 'Failed to fetch components' });
  }
}

export default withAuth(withErrorHandler(handler));