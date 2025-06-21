import { NextApiRequest, NextApiResponse } from 'next';
import { createTenantKnex } from '@/lib/db';
import { ExtensionRegistry } from '../../../../../ee/server/src/lib/extensions/registry';
import { withAuth } from '@/middleware/auth';
import { withErrorHandler } from '@/middleware/errorHandler';

/**
 * API endpoint to check SoftwareOne extension status
 * GET /api/extensions/check-softwareone
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

    const registry = new ExtensionRegistry(knex);
    
    // Check if SoftwareOne extension exists
    const extension = await registry.getExtension('com.alga.softwareone', { 
      tenant_id: tenant 
    });
    
    if (!extension) {
      return res.status(200).json({ 
        found: false,
        message: 'SoftwareOne extension not found in database',
        tenant
      });
    }

    // Get navigation components
    const navComponents = extension.manifest?.components?.filter(
      (c: any) => c.type === 'navigation' && c.slot === 'main-nav'
    ) || [];

    return res.status(200).json({ 
      found: true,
      extension: {
        id: extension.id,
        name: extension.name,
        version: extension.version,
        is_enabled: extension.is_enabled,
        installed_at: extension.created_at,
        updated_at: extension.updated_at,
        navigationComponents: navComponents.map((c: any) => ({
          id: c.id,
          displayName: c.displayName,
          component: c.component,
          path: c.props?.path
        }))
      },
      tenant
    });
  } catch (error: any) {
    console.error('Failed to check extension:', error);
    return res.status(500).json({ 
      error: 'Failed to check extension',
      details: error.message 
    });
  }
}

export default withAuth(withErrorHandler(handler));