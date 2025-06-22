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
    logger.info('[getExtensionNavigationItems] Starting to fetch navigation items');
    
    const { knex, tenant } = await createTenantKnex();
    
    if (!tenant) {
      logger.error('[getExtensionNavigationItems] Tenant not found');
      return [];
    }
    
    logger.info('[getExtensionNavigationItems] Tenant found:', tenant);

    const navigationItems = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const registry = new ExtensionRegistry(trx);
      
      // Get all enabled extensions
      const extensions = await registry.listExtensions({ tenant_id: tenant });
      logger.info('[getExtensionNavigationItems] Total extensions found:', extensions.length);
      
      const enabledExtensions = extensions.filter(ext => ext.is_enabled);
      logger.info('[getExtensionNavigationItems] Enabled extensions:', enabledExtensions.map(e => ({ id: e.id, name: e.name, is_enabled: e.is_enabled })));
      
      // Extract navigation items from enabled extensions
      const items: ExtensionNavigationItem[] = [];
      
      for (const extension of enabledExtensions) {
        const manifest = extension.manifest;
        logger.info('[getExtensionNavigationItems] Processing extension:', { 
          id: extension.id, 
          name: extension.name,
          hasComponents: !!manifest.components,
          componentsCount: manifest.components?.length || 0
        });
        
        // Check if the extension has navigation components
        if (manifest.components) {
          const navComponents = manifest.components.filter((comp: any) => 
            comp.type === 'navigation' && comp.slot === 'main-navigation'
          );
          
          logger.info('[getExtensionNavigationItems] Navigation components found:', navComponents.length);
          
          // Add each navigation component with extension context
          navComponents.forEach((component: any) => {
           // Robustly clean the component path to handle stale data in the database
           // Only remove 'dist/' prefix if present, but preserve 'components/' subdirectory
           const cleanedPath = component.component
             ?.replace(/^dist\//, '');

           logger.info('[getExtensionNavigationItems] Component paths:', {
             original: component.component,
             cleaned: cleanedPath
           });
           
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
      
      logger.info('[getExtensionNavigationItems] Final items:', items);
      
      return items;
    });

    logger.info('[getExtensionNavigationItems] Fetched extension navigation items', { 
      tenant, 
      count: navigationItems.length,
      items: navigationItems
    });

    return navigationItems;
  } catch (error) {
    logger.error('[getExtensionNavigationItems] Failed to fetch extension navigation', { error });
    return [];
  }
}