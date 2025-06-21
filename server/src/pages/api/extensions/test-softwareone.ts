import { NextApiRequest, NextApiResponse } from 'next';
import { getAdminConnection } from '@/lib/db/admin';
import { ExtensionRegistry } from '../../../../../ee/server/src/lib/extensions/registry';
import logger from '@shared/core/logger';

/**
 * API endpoint to test SoftwareOne extension status without auth
 * GET /api/extensions/test-softwareone
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Use admin connection
    const knex = await getAdminConnection();
    
    // Get tenant from environment or default
    const tenant = process.env.DEFAULT_TENANT_ID || '50e6ae9c-5efc-497f-8fc8-d674d372498d';
    
    const registry = new ExtensionRegistry(knex);
    
    // Check if SoftwareOne extension exists
    const extension = await registry.getExtensionByName('SoftwareOne Integration', { 
      tenant_id: tenant 
    });
    
    if (!extension) {
      return res.status(200).json({ 
        found: false,
        message: 'SoftwareOne extension not found in database',
        tenant
      });
    }

    // Get all components
    const components = extension.manifest?.components || [];
    
    // Get navigation components from registry
    const navComponents = await registry.getComponentsBySlot('main-navigation', {
      tenant_id: tenant
    });

    return res.status(200).json({ 
      found: true,
      extension: {
        id: extension.id,
        name: extension.name,
        version: extension.version,
        is_enabled: extension.is_enabled,
        installed_at: extension.created_at,
        updated_at: extension.updated_at,
        components: components.map((c: any) => ({
          type: c.type,
          slot: c.slot,
          component: c.component,
          props: c.props
        }))
      },
      navigation_from_registry: navComponents.map((c: any) => ({
        extensionId: c.extensionId,
        extensionName: extension.name,
        type: c.type,
        slot: c.slot,
        component: c.component,
        props: c.props
      })),
      tenant
    });
  } catch (error: any) {
    logger.error('Failed to test extension:', error);
    return res.status(500).json({ 
      error: 'Failed to test extension',
      details: error.message 
    });
  }
}