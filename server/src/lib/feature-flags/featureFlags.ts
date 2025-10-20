import { PostHog } from 'posthog-node';
import { posthogConfig } from '../../config/posthog.config';
import { analytics } from '../analytics/posthog';
import { createTenantKnex } from '../db';

const FEATURE_FLAG_DISABLE_VALUES = new Set(['true', '1', 'yes', 'on']);

const DEFAULT_BOOLEAN_FLAGS: Record<string, boolean> = {
  // Core features (enabled by default)
  'enable_ticket_automation': true,
  'enable_time_tracking': true,
  'enable_billing': true,
  'enable_reporting': true,
  'email-configuration': false, // Email configuration feature flag (disabled by default)
  
  // New features (disabled by default)
  'new_ticket_ui': false,
  'ai_ticket_suggestions': false,
  'advanced_workflow_engine': false,
  'beta_mobile_app': false,
  'new_dashboard_layout': false,
  
  // Experimental features
  'enable_voice_commands': false,
  'enable_ai_time_tracking': false,
  'enable_predictive_analytics': false,
  
  // Performance features
  'enable_query_caching': true,
  'enable_lazy_loading': true,
  'enable_websocket_updates': false,
  
  // Integration features
  'enable_slack_integration': true,
  'enable_teams_integration': true,
  'enable_jira_sync': false,
  'enable_salesforce_sync': false,
  
  // Migration features
  'enable_client_client_dual_write': true, // Dual-write to both clients and clients tables during migration
};

const DEFAULT_VARIANT_FLAGS: Record<string, string> = {
  'dashboard_layout': 'classic',
  'ticket_list_view': 'table',
  'invoice_template': 'standard',
  'email_composer': 'rich_text',
};

function featureFlagsAreDisabled(): boolean {
  const raw =
    process.env.NEXT_PUBLIC_DISABLE_FEATURE_FLAGS ?? process.env.DISABLE_FEATURE_FLAGS;
  if (typeof raw !== 'string') {
    return false;
  }
  return FEATURE_FLAG_DISABLE_VALUES.has(raw.toLowerCase());
}

export interface FeatureFlagContext {
  userId?: string;
  tenantId?: string;
  userRole?: string;
  companySize?: 'small' | 'medium' | 'large' | 'enterprise';
  subscriptionPlan?: string;
  customProperties?: Record<string, any>;
}

export interface FeatureFlagVariant {
  key: string;
  name: string;
  rolloutPercentage?: number;
}

export class FeatureFlags {
  private client: PostHog | null = null;
  private flagCache: Map<string, { value: boolean | string; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 60000; // 1 minute cache
  private anonymizeUserIds: boolean;

  constructor() {
    this.anonymizeUserIds = process.env.ANALYTICS_ANONYMIZE_USER_IDS !== 'false';
    // Use the same client as analytics if available
    if (analytics.isEnabled && analytics.getClient()) {
      this.client = analytics.getClient();
    } else if (process.env.ALGA_USAGE_STATS !== 'false') {
      // Initialize a separate client if needed
      this.client = new PostHog(
        posthogConfig.apiKey,
        {
          host: posthogConfig.apiHost,
          flushAt: 20,
          flushInterval: 30000,
        }
      );
    }
  }

  /**
   * Check if a feature flag is enabled for a given context
   */
  async isEnabled(
    flagKey: string,
    context: FeatureFlagContext = {}
  ): Promise<boolean> {
    if (featureFlagsAreDisabled()) {
      return true;
    }

    // Check cache first
    const cached = this.getCachedValue(flagKey);
    if (cached !== null && typeof cached === 'boolean') {
      return cached;
    }

    // If analytics is disabled, use default values
    if (!this.client) {
      return this.getDefaultValue(flagKey);
    }

    try {
      const distinctId = this.getDistinctId(context);
      const properties = await this.buildProperties(context);

      const isEnabled = await this.client.isFeatureEnabled(
        flagKey,
        distinctId,
        {
          personProperties: properties,
          groups: context.tenantId ? { tenant: context.tenantId } : undefined,
        }
      );

      // Cache the result
      this.setCachedValue(flagKey, isEnabled || false);

      // Track feature flag evaluation
      if (context.userId) {
        analytics.capture('feature_flag_evaluated', {
          flag_key: flagKey,
          flag_value: isEnabled,
          evaluation_context: {
            has_user: !!context.userId,
            has_tenant: !!context.tenantId,
          }
        }, context.userId);
      }

      return isEnabled || false;
    } catch (error) {
      console.error(`Error evaluating feature flag ${flagKey}:`, error);
      return this.getDefaultValue(flagKey);
    }
  }

  /**
   * Get a feature flag variant (for A/B testing)
   */
  async getVariant(
    flagKey: string,
    context: FeatureFlagContext = {}
  ): Promise<string | null> {
    // Check cache first
    const cached = this.getCachedValue(flagKey);
    if (cached !== null && typeof cached === 'string') {
      return cached;
    }

    if (featureFlagsAreDisabled()) {
      return this.getDefaultVariant(flagKey);
    }

    if (!this.client) {
      return this.getDefaultVariant(flagKey);
    }

    try {
      const distinctId = this.getDistinctId(context);
      const properties = await this.buildProperties(context);

      const variant = await this.client.getFeatureFlag(
        flagKey,
        distinctId,
        {
          personProperties: properties,
          groups: context.tenantId ? { tenant: context.tenantId } : undefined,
        }
      );

      const variantValue = typeof variant === 'string' ? variant : null;
      
      // Cache the result
      if (variantValue) {
        this.setCachedValue(flagKey, variantValue);
      }

      // Track variant assignment
      if (context.userId && variantValue) {
        analytics.capture('feature_flag_variant_assigned', {
          flag_key: flagKey,
          variant: variantValue,
          evaluation_context: {
            has_user: !!context.userId,
            has_tenant: !!context.tenantId,
          }
        }, context.userId);
      }

      return variantValue;
    } catch (error) {
      console.error(`Error getting feature flag variant ${flagKey}:`, error);
      return this.getDefaultVariant(flagKey);
    }
  }

  /**
   * Get all feature flags for a context
   */
  async getAllFlags(context: FeatureFlagContext = {}): Promise<Record<string, boolean | string>> {
    if (featureFlagsAreDisabled()) {
      return this.getAllDefaultValues();
    }

    if (!this.client) {
      return this.getAllDefaultValues();
    }

    try {
      const distinctId = this.getDistinctId(context);
      const properties = await this.buildProperties(context);

      const flags = await this.client.getAllFlags(
        distinctId,
        {
          personProperties: properties,
          groups: context.tenantId ? { tenant: context.tenantId } : undefined,
        }
      );

      return flags || {};
    } catch (error) {
      console.error('Error getting all feature flags:', error);
      return this.getAllDefaultValues();
    }
  }

  /**
   * Manually override a feature flag (useful for testing)
   */
  setOverride(flagKey: string, value: boolean | string): void {
    this.setCachedValue(flagKey, value, Infinity); // Never expire overrides
  }

  /**
   * Clear a manual override
   */
  clearOverride(flagKey: string): void {
    this.flagCache.delete(flagKey);
  }

  /**
   * Clear all cached values
   */
  clearCache(): void {
    this.flagCache.clear();
  }

  /**
   * Helper: Get distinct ID for PostHog
   */
  private getDistinctId(context: FeatureFlagContext): string {
    if (context.userId) {
      // Use the same logic as analytics - anonymize based on env var
      return !this.anonymizeUserIds
        ? `user_${context.userId}`
        : `user_${this.hashUserId(context.userId)}`;
    }
    
    if (context.tenantId) {
      return `tenant_${context.tenantId}`;
    }
    
    // Fallback to a generic ID
    return 'anonymous';
  }

  /**
   * Helper: Build properties for feature flag evaluation
   */
  private async buildProperties(context: FeatureFlagContext): Promise<Record<string, any>> {
    const properties: Record<string, any> = {
      environment: process.env.NODE_ENV || 'development',
      ...context.customProperties,
    };

    if (context.userRole) {
      properties.user_role = context.userRole;
    }

    if (context.companySize) {
      properties.company_size = context.companySize;
    }

    if (context.subscriptionPlan) {
      properties.subscription_plan = context.subscriptionPlan;
    }

    // Add tenant-specific properties if needed
    if (context.tenantId) {
      try {
        const { knex } = await createTenantKnex();
        const tenantInfo = await knex('tenants')
          .where({ tenant: context.tenantId })
          .first();
        
        if (tenantInfo) {
          properties.tenant_created_at = tenantInfo.created_at;
          properties.tenant_status = tenantInfo.status;
        }
      } catch (error) {
        // Ignore errors fetching tenant info
      }
    }

    return properties;
  }

  /**
   * Helper: Get cached value
   */
  private getCachedValue(flagKey: string): boolean | string | null {
    const cached = this.flagCache.get(flagKey);
    if (!cached) return null;

    const now = Date.now();
    if (now - cached.timestamp > this.CACHE_TTL) {
      this.flagCache.delete(flagKey);
      return null;
    }

    return cached.value;
  }

  /**
   * Helper: Set cached value
   */
  private setCachedValue(flagKey: string, value: boolean | string, ttl?: number): void {
    this.flagCache.set(flagKey, {
      value,
      timestamp: Date.now(),
    });
  }

  /**
   * Helper: Hash user ID for privacy
   */
  private hashUserId(userId: string): string {
    const crypto = require('crypto');
    return crypto.createHash('sha256')
      .update(userId)
      .digest('hex')
      .substring(0, 16);
  }

  /**
   * Get default value for a feature flag
   */
  private getDefaultValue(flagKey: string): boolean {
    return DEFAULT_BOOLEAN_FLAGS[flagKey] ?? false;
  }

  /**
   * Get default variant for a feature flag
   */
  private getDefaultVariant(flagKey: string): string | null {
    return DEFAULT_VARIANT_FLAGS[flagKey] ?? null;
  }

  /**
   * Get all default values
   */
  private getAllDefaultValues(): Record<string, boolean | string> {
    return {
      ...DEFAULT_BOOLEAN_FLAGS,
      ...DEFAULT_VARIANT_FLAGS,
    };
  }
}

// Singleton instance
export const featureFlags = new FeatureFlags();
