/**
 * Custom Page Extension Registry
 * 
 * Manages registration and retrieval of custom page extensions
 */
import { CustomPageProps, ExtensionComponentType } from '../../types';
import { ExtensionPage } from './PageTypes';
import { logger } from '../../../../utils/logger';

/**
 * Registry for custom page extensions
 */
export class PageRegistry {
  private pages: Map<string, ExtensionPage> = new Map();
  
  /**
   * Register a custom page
   */
  registerPage(
    extensionId: string,
    component: string,
    props: CustomPageProps
  ): void {
    const { id, path } = props;
    
    // Use path as the key for lookup
    const key = this.normalizePath(path);
    
    // Check for duplicate page paths
    if (this.pages.has(key)) {
      const existingPage = this.pages.get(key)!;
      logger.warn('Duplicate custom page path found', {
        path,
        existingExtensionId: existingPage.extensionId,
        newExtensionId: extensionId
      });
      
      // Update the existing page instead of adding a duplicate
      this.pages.set(key, { extensionId, component, props });
    } else {
      // Add new page
      this.pages.set(key, { extensionId, component, props });
    }
    
    logger.debug('Custom page registered', {
      extensionId,
      pageId: id,
      path
    });
  }
  
  /**
   * Get all registered pages
   */
  getAllPages(): ExtensionPage[] {
    return Array.from(this.pages.values());
  }
  
  /**
   * Get a page by its path
   */
  getPageByPath(path: string): ExtensionPage | undefined {
    const key = this.normalizePath(path);
    return this.pages.get(key);
  }
  
  /**
   * Remove pages for an extension
   */
  removeExtensionPages(extensionId: string): void {
    // Find keys to remove
    const keysToRemove: string[] = [];
    
    for (const [key, page] of this.pages.entries()) {
      if (page.extensionId === extensionId) {
        keysToRemove.push(key);
      }
    }
    
    // Remove pages
    for (const key of keysToRemove) {
      this.pages.delete(key);
    }
    
    logger.debug('Removed pages for extension', { 
      extensionId,
      pagesRemoved: keysToRemove.length
    });
  }
  
  /**
   * Clear all pages
   */
  clear(): void {
    this.pages.clear();
    logger.debug('Cleared page registry');
  }
  
  /**
   * Normalize a path for consistent lookup
   */
  private normalizePath(path: string): string {
    // Ensure path starts with /
    if (!path.startsWith('/')) {
      path = '/' + path;
    }
    
    // Remove trailing slash if present (unless it's just '/')
    if (path.length > 1 && path.endsWith('/')) {
      path = path.slice(0, -1);
    }
    
    return path.toLowerCase();
  }
}

// Create singleton instance
export const pageRegistry = new PageRegistry();