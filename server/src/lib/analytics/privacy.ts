// Re-export all client-safe methods
export { PrivacyHelper as ClientPrivacyHelper } from './privacy.client';

// Import client helper for extending
import { PrivacyHelper as ClientHelper } from './privacy.client';

/**
 * Server-side privacy helper that extends client methods
 * This includes methods that require server-only imports
 */
export class PrivacyHelper extends ClientHelper {
  /**
   * Get instance identifier (hashed for privacy) - async server version
   * This method uses the stable ID from the database
   */
  static async getInstanceIdAsync(): Promise<string> {
    // Only use the stable ID on server side
    if (typeof window === 'undefined') {
      try {
        // Use dynamic import with server-only path
        const { getOrCreateInstanceId } = await import('./analyticsSettingsServer');
        const stableId = await getOrCreateInstanceId();
        // Hash the stable ID for consistency with previous implementation
        return this.hashString(stableId);
      } catch (error) {
        console.error('Error getting stable instance ID:', error);
      }
    }
    
    // Fallback to simple instance ID
    return this.getInstanceId();
  }
}