import { PostHog } from 'posthog-node';
import crypto from 'crypto';
import os from 'os';
import { posthogConfig, isPostHogEnabled } from '../../config/posthog.config';

export class UsageAnalytics {
  private client: PostHog | null = null;
  public isEnabled: boolean;
  private isHosted: boolean;
  
  constructor() {
    this.isHosted = process.env.DEPLOYMENT_TYPE === 'hosted';
    this.isEnabled = isPostHogEnabled();
    
    // Show usage stats notice in terminal for on-premise deployments (server-side only)
    if (!this.isHosted && typeof window === 'undefined') {
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
      
      console.log(`Usage statistics enabled (${this.isHosted ? 'hosted' : 'on-premise'} mode)`);
    } else {
      console.log('Usage statistics disabled by ALGA_USAGE_STATS=false');
    }
  }
  
  async capture(event: string, properties: Record<string, any> = {}, userId?: string) {
    if (!this.client) return;
    
    const distinctId = await this.getDistinctId(userId);
    const sanitizedProperties = this.sanitizeProperties(properties);
    
    this.client.capture({
      distinctId,
      event,
      properties: {
        ...sanitizedProperties,
        deployment_type: this.isHosted ? 'hosted' : 'on-premise',
        app_version: process.env.npm_package_version || process.env.APP_VERSION,
        environment: process.env.NODE_ENV,
      },
    });
  }
  
  captureSync(event: string, properties: Record<string, any> = {}, userId?: string) {
    if (!this.client) return;
    
    const distinctId = this.getDistinctIdSync(userId);
    const sanitizedProperties = this.sanitizeProperties(properties);
    
    this.client.capture({
      distinctId,
      event,
      properties: {
        ...sanitizedProperties,
        deployment_type: this.isHosted ? 'hosted' : 'on-premise',
        app_version: process.env.npm_package_version || process.env.APP_VERSION,
        environment: process.env.NODE_ENV,
      },
    });
  }
  
  async identify(userId: string, properties: Record<string, any> = {}) {
    if (!this.client) return;
    
    const distinctId = await this.getDistinctId(userId);
    const sanitizedProperties = this.sanitizeProperties(properties);
    
    this.client.identify({
      distinctId,
      properties: sanitizedProperties,
    });
  }
  
  identifySync(userId: string, properties: Record<string, any> = {}) {
    if (!this.client) return;
    
    const distinctId = this.getDistinctIdSync(userId);
    const sanitizedProperties = this.sanitizeProperties(properties);
    
    this.client.identify({
      distinctId,
      properties: sanitizedProperties,
    });
  }
  
  async shutdown() {
    if (this.client) {
      await this.client.shutdown();
    }
  }
  
  private cachedInstanceId: string | null = null;
  
  async getDistinctId(userId?: string): Promise<string> {
    if (this.isHosted && userId) {
      return `hosted_${userId}`;
    }
    
    // For on-premise, use stable instance ID
    try {
      if (!this.cachedInstanceId) {
        const { getOrCreateInstanceId } = await import('./analyticsSettingsServer');
        const stableId = await getOrCreateInstanceId();
        this.cachedInstanceId = crypto.createHash('sha256')
          .update(stableId)
          .digest('hex')
          .substring(0, 16);
      }
      return this.cachedInstanceId;
    } catch (error) {
      console.error('Error getting stable instance ID:', error);
      // Fallback to hostname-based ID
      const instanceId = process.env.INSTANCE_ID || os.hostname();
      return crypto.createHash('sha256')
        .update(instanceId)
        .digest('hex')
        .substring(0, 16);
    }
  }
  
  getDistinctIdSync(userId?: string): string {
    if (this.isHosted && userId) {
      return `hosted_${userId}`;
    }
    
    // Synchronous fallback for cases where async is not possible
    const instanceId = process.env.INSTANCE_ID || os.hostname();
    return crypto.createHash('sha256')
      .update(instanceId)
      .digest('hex')
      .substring(0, 16);
  }
  
  private sanitizeProperties(properties: Record<string, any>): Record<string, any> {
    if (this.isHosted) {
      // For hosted, include tenant context but remove PII
      return this.removePII(properties);
    }
    
    // For on-premise, aggressively anonymize
    return this.anonymizeProperties(properties);
  }
  
  private removePII(properties: Record<string, any>): Record<string, any> {
    const sanitized = { ...properties };
    
    // Remove common PII fields
    const piiFields = [
      'email', 'name', 'phone', 'address', 'ssn', 
      'credit_card', 'password', 'ip_address', 'ip',
      'first_name', 'last_name', 'full_name', 'username',
      'user_email', 'customer_name', 'client_name'
    ];
    
    for (const field of piiFields) {
      delete sanitized[field];
    }
    
    // Recursively clean nested objects
    for (const [key, value] of Object.entries(sanitized)) {
      if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.removePII(value);
      }
    }
    
    return sanitized;
  }
  
  private anonymizeProperties(properties: Record<string, any>): Record<string, any> {
    const anonymized: Record<string, any> = {};
    
    // Whitelist of safe properties for on-premise
    const safeProperties = [
      'feature', 'action', 'type', 'category', 'status',
      'count', 'duration', 'size', 'format', 'method',
      'success', 'error_type', 'version', 'browser',
      'os', 'device_type', 'screen_size', 'language'
    ];
    
    for (const [key, value] of Object.entries(properties)) {
      if (safeProperties.includes(key)) {
        anonymized[key] = value;
      } else if (typeof value === 'number') {
        // Numbers are generally safe
        anonymized[key] = value;
      } else if (typeof value === 'boolean') {
        // Booleans are safe
        anonymized[key] = value;
      }
    }
    
    return anonymized;
  }

  async trackPerformance(metricName: string, value: number, metadata?: Record<string, any>) {
    await this.capture('performance_metric', {
      metric_name: metricName,
      value,
      unit: 'ms',
      ...metadata
    });
  }
  
  trackPerformanceSync(metricName: string, value: number, metadata?: Record<string, any>) {
    this.captureSync('performance_metric', {
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

// Create a proxy that handles both sync and async calls for backward compatibility
const analyticsProxy = new Proxy(getAnalytics(), {
  get(target, prop, receiver) {
    if (prop === 'capture') {
      // Return a function that works both sync and async
      return (event: string, properties?: Record<string, any>, userId?: string) => {
        // Use sync version for now to maintain backward compatibility
        target.captureSync(event, properties, userId);
        // Also queue the async version for better accuracy
        target.capture(event, properties, userId).catch(err => 
          console.error('Async analytics capture failed:', err)
        );
      };
    }
    if (prop === 'identify') {
      // Return a function that works both sync and async
      return (userId: string, properties?: Record<string, any>) => {
        // Use sync version for now to maintain backward compatibility
        target.identifySync(userId, properties);
        // Also queue the async version for better accuracy
        target.identify(userId, properties).catch(err => 
          console.error('Async analytics identify failed:', err)
        );
      };
    }
    if (prop === 'trackPerformance') {
      // Return a function that works both sync and async
      return (metricName: string, value: number, metadata?: Record<string, any>) => {
        // Use sync version for now to maintain backward compatibility
        target.trackPerformanceSync(metricName, value, metadata);
        // Also queue the async version for better accuracy
        target.trackPerformance(metricName, value, metadata).catch(err => 
          console.error('Async analytics trackPerformance failed:', err)
        );
      };
    }
    return Reflect.get(target, prop, receiver);
  }
});

// Export singleton for convenience
export const analytics = analyticsProxy as UsageAnalytics;