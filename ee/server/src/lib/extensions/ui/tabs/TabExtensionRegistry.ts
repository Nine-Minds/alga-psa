/**
 * Tab Extension Registry
 * 
 * Manages registration and retrieval of tab extensions
 */
import { TabExtensionProps, ExtensionComponentType } from '../../types';
import { ExtensionTabItem } from './TabExtensionTypes';
import logger from '../../../../../../../server/src/utils/logger';

/**
 * Registry for tab extensions
 */
export class TabExtensionRegistry {
  private tabs: Map<string, ExtensionTabItem[]> = new Map();
  
  /**
   * Register a tab extension
   */
  registerTab(
    extensionId: string,
    component: string,
    props: TabExtensionProps
  ): void {
    const { parentPage, id } = props;
    
    // Initialize tabs array for parent page if it doesn't exist
    if (!this.tabs.has(parentPage)) {
      this.tabs.set(parentPage, []);
    }
    
    // Check for duplicate tab IDs in the same parent page
    const existingTabs = this.tabs.get(parentPage) || [];
    const duplicateTab = existingTabs.find(tab => tab.props.id === id);
    
    if (duplicateTab) {
      logger.warn('Duplicate tab ID found', {
        parentPage,
        tabId: id,
        existingExtensionId: duplicateTab.extensionId,
        newExtensionId: extensionId
      });
      
      // Update the existing tab instead of adding a duplicate
      const index = existingTabs.findIndex(tab => tab.props.id === id);
      existingTabs[index] = { extensionId, component, props };
    } else {
      // Add new tab
      existingTabs.push({ extensionId, component, props });
      
      // Sort tabs by priority (higher values first)
      existingTabs.sort((a, b) => 
        (b.props.priority || 0) - (a.props.priority || 0)
      );
    }
    
    // Update tabs for parent page
    this.tabs.set(parentPage, existingTabs);
    
    logger.debug('Tab extension registered', {
      extensionId,
      parentPage,
      tabId: id
    });
  }
  
  /**
   * Get all tabs for a parent page
   */
  getTabsForParentPage(parentPage: string): ExtensionTabItem[] {
    return this.tabs.get(parentPage) || [];
  }
  
  /**
   * Get all parent pages with tab extensions
   */
  getParentPages(): string[] {
    return Array.from(this.tabs.keys());
  }
  
  /**
   * Check if a tab exists
   */
  hasTab(parentPage: string, tabId: string): boolean {
    const tabs = this.tabs.get(parentPage) || [];
    return tabs.some(tab => tab.props.id === tabId);
  }
  
  /**
   * Get a specific tab by ID
   */
  getTab(parentPage: string, tabId: string): ExtensionTabItem | undefined {
    const tabs = this.tabs.get(parentPage) || [];
    return tabs.find(tab => tab.props.id === tabId);
  }
  
  /**
   * Remove tabs for an extension
   */
  removeExtensionTabs(extensionId: string): void {
    // Iterate over all parent pages
    for (const [parentPage, tabs] of this.tabs.entries()) {
      // Filter out tabs from the specified extension
      const updatedTabs = tabs.filter(tab => tab.extensionId !== extensionId);
      
      // Update the map or remove the entry if empty
      if (updatedTabs.length > 0) {
        this.tabs.set(parentPage, updatedTabs);
      } else {
        this.tabs.delete(parentPage);
      }
    }
    
    logger.debug('Removed tabs for extension', { extensionId });
  }
  
  /**
   * Clear all tabs
   */
  clear(): void {
    this.tabs.clear();
    logger.debug('Cleared tab extension registry');
  }
}

// Create singleton instance
export const tabExtensionRegistry = new TabExtensionRegistry();