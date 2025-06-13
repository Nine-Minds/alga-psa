import { NextApiRequest, NextApiResponse } from 'next';
import { createTenantKnex } from '@/lib/db';
import { withTransaction } from '@shared/db';
import { ExtensionRegistry } from '../../../../../ee/server/src/lib/extensions/registry';
import { withAuth } from '@/middleware/auth';
import { withErrorHandler } from '@/middleware/errorHandler';
import logger from '@shared/core/logger';
import { Knex } from 'knex';

/**
 * API endpoint to fetch navigation items from enabled extensions
 * GET /api/extensions/navigation
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

    const navigationItems = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const registry = new ExtensionRegistry(trx);
      
      // Get all enabled extensions
      const extensions = await registry.listExtensions({ tenant_id: tenant });
      const enabledExtensions = extensions.filter(ext => ext.is_enabled);
      
      // Extract navigation items from enabled extensions
      const items: any[] = [];
      
      for (const extension of enabledExtensions) {
        const manifest = extension.manifest;
        
        // Check if the extension has navigation components
        if (manifest.components) {
          const navComponents = manifest.components.filter((comp: any) => 
            comp.type === 'navigation' && comp.slot === 'main-navigation'
          );
          
          // Add each navigation component with extension context
          navComponents.forEach((component: any) => {
            items.push({
              extensionId: extension.id,
              extensionName: extension.name,
              component: component.component,
              props: {
                ...component.props,
                // Ensure required props are present
                id: component.props?.id || `${extension.name}-nav`,
                label: component.props?.label || extension.name,
                path: component.props?.path || `/msp/extensions/${extension.name}`,
                priority: component.props?.priority || 50,
                permissions: component.props?.permissions || []
              }
            });
          });
        }
      }
      
      // Sort by priority (higher values first)
      items.sort((a, b) => (b.props.priority || 0) - (a.props.priority || 0));
      
      return items;
    });

    logger.info('Fetched extension navigation items', { 
      tenant, 
      count: navigationItems.length 
    });

    return res.status(200).json({ items: navigationItems });
  } catch (error) {
    logger.error('Failed to fetch extension navigation', { error });
    return res.status(500).json({ error: 'Failed to fetch navigation items' });
  }
}

export default withAuth(withErrorHandler(handler));