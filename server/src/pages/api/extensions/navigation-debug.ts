import { NextApiRequest, NextApiResponse } from 'next';
import { getAdminConnection } from '@/lib/db/admin';
import { ExtensionRegistry } from '../../../../../ee/server/src/lib/extensions/registry';

/**
 * Debug API endpoint to fetch navigation items without auth
 * GET /api/extensions/navigation-debug
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const knex = await getAdminConnection();
    
    // Get the first tenant for debugging
    const firstTenant = await knex('tenants').select('tenant').first();
    
    if (!firstTenant) {
      // Check if extensions table exists
      const tableExists = await knex.schema.hasTable('extensions');
      if (!tableExists) {
        return res.status(200).json({ 
          error: 'Extensions table does not exist',
          items: [],
          debug: {
            tablesChecked: ['extensions'],
            tableExists: false
          }
        });
      }
      
      return res.status(200).json({ 
        error: 'No tenants found in database',
        items: [],
        debug: {
          tenantsChecked: true,
          tenantCount: 0
        }
      });
    }

    const tenantId = firstTenant.tenant;
    const registry = new ExtensionRegistry(knex);
    
    // Get all extensions (not just enabled ones for debugging)
    const allExtensions = await registry.listExtensions({ tenant_id: tenantId });
    
    // Extract navigation items from all extensions
    const items: any[] = [];
    const debugInfo = {
      tenantId,
      totalExtensions: allExtensions.length,
      enabledExtensions: allExtensions.filter(ext => ext.is_enabled).length,
      extensionDetails: allExtensions.map(ext => ({
        id: ext.id,
        name: ext.name,
        enabled: ext.is_enabled,
        hasComponents: !!ext.manifest?.components,
        componentCount: ext.manifest?.components?.length || 0,
        navComponents: ext.manifest?.components?.filter((c: any) => c.type === 'navigation').length || 0,
        manifest: ext.manifest // Include full manifest for debugging
      }))
    };
    
    for (const extension of allExtensions) {
      const manifest = extension.manifest;
      
      // Check if the extension has navigation components
      if (manifest?.components) {
        // Log all components for debugging
        console.log(`Extension ${extension.name} components:`, JSON.stringify(manifest.components, null, 2));
        
        const navComponents = manifest.components.filter((comp: any) => {
          const isNav = comp.type === 'navigation';
          const isMainNav = comp.slot === 'main-nav';
          console.log(`Component check: type=${comp.type}, slot=${comp.slot}, isNav=${isNav}, isMainNav=${isMainNav}`);
          return isNav && isMainNav;
        });
        
        console.log(`Found ${navComponents.length} navigation components for ${extension.name}`);
        
        // Add each navigation component with extension context
        navComponents.forEach((component: any) => {
          const item = {
            extensionId: extension.id,
            extensionName: extension.name,
            enabled: extension.is_enabled,
            component: component.component,
            props: {
              ...component.props,
              id: component.props?.id || `${extension.name}-nav`,
              label: component.props?.label || extension.name,
              path: component.props?.path || `/msp/extensions/${extension.name}`,
              priority: component.props?.priority || 50,
              permissions: component.props?.permissions || []
            }
          };
          console.log(`Adding navigation item:`, JSON.stringify(item, null, 2));
          items.push(item);
        });
      }
    }
    
    // Sort by priority (higher values first)
    items.sort((a, b) => (b.props.priority || 0) - (a.props.priority || 0));
    
    // Close the connection
    await knex.destroy();
    
    return res.status(200).json({ 
      items,
      debug: debugInfo
    });
  } catch (error: any) {
    console.error('Navigation debug error:', error);
    return res.status(200).json({ 
      error: error.message,
      items: [],
      debug: {
        errorType: error.constructor.name,
        stack: error.stack
      }
    });
  }
}