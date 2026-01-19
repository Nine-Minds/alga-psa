import { PostHog } from 'posthog-node';
import crypto from 'crypto';
import os from 'os';
import { posthogConfig, isPostHogEnabled } from './config/posthog.config';
import { getAppVersion } from './utils/version';

export class UsageAnalytics {
  private client: PostHog | null = null;
  public isEnabled: boolean;
  private anonymizeUserIds: boolean;
  
  constructor() {
    this.anonymizeUserIds = process.env.ANALYTICS_ANONYMIZE_USER_IDS !== 'false';
    this.isEnabled = isPostHogEnabled();
    
    // Show usage stats notice in terminal on first run (server-side only)
    if (typeof window === 'undefined') {
      import('./terminal-notice').then(({ showUsageStatsNotice }) => {
        showUsageStatsNotice();
      }).catch(() => {
        // Ignore errors in client-side environment
      });
    }
    
    if (this.isEnabled) {
      this.client = new PostHog(
        posthogConfig.apiKey,
        { 
          host: posthogConfig.apiHost,
          flushAt: 20,
          flushInterval: 30000,
        }
      );
      
      console.log(`Usage statistics enabled (user IDs ${this.anonymizeUserIds ? 'anonymized' : 'preserved'})`);
    } else {
      console.log('Usage statistics disabled by ALGA_USAGE_STATS=false');
    }
  }
  
  async capture(event: string, properties: Record<string, any> = {}, userId?: string) {
    if (!this.client) return;
    
    const distinctId = await this.getDistinctId(userId);
    
    this.client.capture({
      distinctId,
      event,
      properties: {
        ...properties,
        user_ids_anonymized: this.anonymizeUserIds,
        app_version: getAppVersion(),
        environment: process.env.NODE_ENV,
      },
    });
  }
  
  async identify(userId: string, properties: Record<string, any> = {}) {
    if (!this.client) return;
    
    const distinctId = await this.getDistinctId(userId);
    
    this.client.identify({
      distinctId,
      properties,
    });
  }
  
  async shutdown() {
    if (this.client) {
      await this.client.shutdown();
    }
  }
  
  private cachedInstanceId: string | null = null;
  
  async getDistinctId(userId?: string): Promise<string> {
    // If user IDs should not be anonymized and we have a user ID, use it
    if (!this.anonymizeUserIds && userId) {
      return `user_${userId}`;
    }
    
    // For anonymized mode or when no userId, use stable instance ID
    try {
      if (!this.cachedInstanceId) {
        const { getOrCreateInstanceId } = await import('./analyticsSettingsServer');
        this.cachedInstanceId = await getOrCreateInstanceId();
      }
      return this.cachedInstanceId;
    } catch (error) {
      console.error('Error getting stable instance ID:', error);
      // Use the fallback from analyticsSettings
      const instanceId = process.env.INSTANCE_ID || os.hostname();
      return crypto.createHash('sha256')
        .update(instanceId)
        .digest('hex')
        .substring(0, 16);
    }
  }
  

  async trackPerformance(metricName: string, value: number, metadata?: Record<string, any>) {
    await this.capture('performance_metric', {
      metric_name: metricName,
      value,
      unit: 'ms',
      ...metadata
    });
  }

  /**
   * Get the PostHog client instance (for feature flags)
   */
  getClient(): PostHog | null {
    return this.client;
  }
}

// Singleton instance
let analyticsInstance: UsageAnalytics | null = null;

export function getAnalytics(): UsageAnalytics {
  if (!analyticsInstance) {
    analyticsInstance = new UsageAnalytics();
  }
  return analyticsInstance;
}

// Export singleton for convenience
export const analytics = getAnalytics();
