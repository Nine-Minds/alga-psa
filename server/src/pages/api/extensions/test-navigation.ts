import { NextApiRequest, NextApiResponse } from 'next';
import { getAdminConnection } from '@/lib/db/admin';
import { ExtensionRegistry } from '../../../../../ee/server/src/lib/extensions/registry';
import logger from '@shared/core/logger';

/**
 * API endpoint to test navigation items without auth
 * GET /api/extensions/test-navigation
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const knex = await getAdminConnection();
    const tenant = process.env.DEFAULT_TENANT_ID || '50e6ae9c-5efc-497f-8fc8-d674d372498d';
    
    const registry = new ExtensionRegistry(knex);
    
    // Get all enabled extensions
    const extensions = await registry.listExtensions({ tenant_id: tenant });
    const enabledExtensions = extensions.filter(ext => ext.is_enabled);
    
    logger.info('Found enabled extensions', { count: enabledExtensions.length });
    
    // Extract navigation items from enabled extensions
    const items: any[] = [];
    
    for (const extension of enabledExtensions) {
      const manifest = extension.manifest;
      
      // Check if the extension has navigation components
      if (manifest.components) {
        const navComponents = manifest.components.filter((comp: any) => 
          comp.type === 'navigation' && comp.slot === 'main-navigation'
        );
        
        logger.info('Found navigation components', { 
          extensionName: extension.name,
          count: navComponents.length,
          components: navComponents
        });
        
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

    return res.status(200).json({ 
      tenant,
      enabledExtensions: enabledExtensions.map(ext => ({
        id: ext.id,
        name: ext.name,
        version: ext.version,
        is_enabled: ext.is_enabled
      })),
      navigationItems: items,
      count: items.length
    });
  } catch (error: any) {
    logger.error('Failed to test navigation:', error);
    return res.status(500).json({ 
      error: 'Failed to test navigation',
      details: error.message 
    });
  }
}