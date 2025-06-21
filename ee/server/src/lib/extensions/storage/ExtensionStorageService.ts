/**
 * Extension Storage Service
 * Provides isolated storage for each extension
 */

interface StorageData {
  [key: string]: any;
}

class ExtensionStorageServiceClass {
  private storage: Map<string, StorageData> = new Map();

  /**
   * Get a value from extension storage
   */
  async get(extensionId: string, key: string): Promise<any> {
    const extensionStorage = this.storage.get(extensionId);
    if (!extensionStorage) {
      return null;
    }
    return extensionStorage[key] || null;
  }

  /**
   * Set a value in extension storage
   */
  async set(extensionId: string, key: string, value: any): Promise<void> {
    let extensionStorage = this.storage.get(extensionId);
    if (!extensionStorage) {
      extensionStorage = {};
      this.storage.set(extensionId, extensionStorage);
    }
    extensionStorage[key] = value;
    
    // In production, this would persist to database
    // For now, we're using in-memory storage
    console.log(`[Storage] Set ${extensionId}/${key}:`, value);
  }

  /**
   * Remove a value from extension storage
   */
  async remove(extensionId: string, key: string): Promise<void> {
    const extensionStorage = this.storage.get(extensionId);
    if (extensionStorage) {
      delete extensionStorage[key];
      console.log(`[Storage] Removed ${extensionId}/${key}`);
    }
  }

  /**
   * Clear all storage for an extension
   */
  async clear(extensionId: string): Promise<void> {
    this.storage.delete(extensionId);
    console.log(`[Storage] Cleared all data for ${extensionId}`);
  }

  /**
   * Get all keys for an extension
   */
  async keys(extensionId: string): Promise<string[]> {
    const extensionStorage = this.storage.get(extensionId);
    if (!extensionStorage) {
      return [];
    }
    return Object.keys(extensionStorage);
  }

  /**
   * Get all values for an extension
   */
  async getAll(extensionId: string): Promise<StorageData> {
    return this.storage.get(extensionId) || {};
  }
}

// Export singleton instance
export const ExtensionStorageService = new ExtensionStorageServiceClass();