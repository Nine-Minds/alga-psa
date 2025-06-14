'use server';

import { createTenantKnex } from '@/lib/db';
import { withTransaction } from '@shared/db';
import { ExtensionRegistry } from '../../../../ee/server/src/lib/extensions/registry';
import logger from '@shared/core/logger';
import { Knex } from 'knex';

// Import the type from the extension system
import { NavigationItemProps } from '../../../../ee/server/src/lib/extensions/types';

export interface ExtensionNavigationItem {
  extensionId: string;
  extensionName?: string;
  component?: string;
  props: NavigationItemProps;
}

/**
 * Server action to fetch navigation items from enabled extensions
 */
export async function getExtensionNavigationItems(): Promise<ExtensionNavigationItem[]> {
  try {
    const { knex, tenant } = await createTenantKnex();
    
    if (!tenant) {
      logger.error('Tenant not found in getExtensionNavigationItems');
      return [];
    }

    const navigationItems = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const registry = new ExtensionRegistry(trx);
      
      // Get all enabled extensions
      const extensions = await registry.listExtensions({ tenant_id: tenant });
      const enabledExtensions = extensions.filter(ext => ext.is_enabled);
      
      // Extract navigation items from enabled extensions
      const items: ExtensionNavigationItem[] = [];
      
      for (const extension of enabledExtensions) {
        const manifest = extension.manifest;
        
        // Check if the extension has navigation components
        if (manifest.components) {
          const navComponents = manifest.components.filter((comp: any) => 
            comp.type === 'navigation' && comp.slot === 'main-navigation'
          );
          
          // Add each navigation component with extension context
          navComponents.forEach((component: any) => {
           // Robustly clean the component path to handle stale data in the database
           // Only remove 'dist/' prefix if present, but preserve 'components/' subdirectory
           const cleanedPath = component.component
             ?.replace(/^dist\//, '');

           console.log('[extension-actions] Original component path:', component.component);
           console.log('[extension-actions] Cleaned component path:', cleanedPath);
           
           items.push({
             extensionId: extension.id,
             extensionName: extension.name,
             component: cleanedPath,
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

    logger.info('Fetched extension navigation items via server action', { 
      tenant, 
      count: navigationItems.length 
    });

    return navigationItems;
  } catch (error) {
    logger.error('Failed to fetch extension navigation via server action', { error });
    return [];
  }
}