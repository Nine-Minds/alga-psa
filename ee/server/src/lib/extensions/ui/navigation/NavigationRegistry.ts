/**
 * Navigation Extension Registry
 * 
 * Manages registration and retrieval of navigation extensions
 */
import { NavigationItemProps, ExtensionComponentType } from '../../types';
import { ExtensionNavigationItem } from './NavigationTypes';
import { logger } from '../../../../utils/logger';

/**
 * Registry for navigation extensions
 */
export class NavigationRegistry {
  private items: ExtensionNavigationItem[] = [];
  
  /**
   * Register a navigation item
   */
  registerNavigationItem(
    extensionId: string,
    component: string | undefined,
    props: NavigationItemProps
  ): void {
    const { id } = props;
    
    // Check for duplicate item IDs
    const duplicateItem = this.items.find(item => item.props.id === id);
    
    if (duplicateItem) {
      logger.warn('Duplicate navigation item ID found', {
        itemId: id,
        existingExtensionId: duplicateItem.extensionId,
        newExtensionId: extensionId
      });
      
      // Update the existing item instead of adding a duplicate
      const index = this.items.findIndex(item => item.props.id === id);
      this.items[index] = { extensionId, component, props };
    } else {
      // Add new item
      this.items.push({ extensionId, component, props });
      
      // Sort items by priority (higher values first)
      this.items.sort((a, b) => 
        (b.props.priority || 0) - (a.props.priority || 0)
      );
    }
    
    logger.debug('Navigation item registered', {
      extensionId,
      itemId: id,
      path: props.path
    });
  }
  
  /**
   * Get all navigation items
   */
  getNavigationItems(): ExtensionNavigationItem[] {
    return this.items;
  }
  
  /**
   * Get a specific navigation item by ID
   */
  getNavigationItem(id: string): ExtensionNavigationItem | undefined {
    return this.items.find(item => item.props.id === id);
  }
  
  /**
   * Remove navigation items for an extension
   */
  removeExtensionItems(extensionId: string): void {
    this.items = this.items.filter(item => item.extensionId !== extensionId);
    logger.debug('Removed navigation items for extension', { extensionId });
  }
  
  /**
   * Clear all navigation items
   */
  clear(): void {
    this.items = [];
    logger.debug('Cleared navigation registry');
  }
}

// Create singleton instance
export const navigationRegistry = new NavigationRegistry();