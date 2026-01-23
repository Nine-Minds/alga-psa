import { analytics } from '../posthog';
import { createTenantKnex } from '@alga-psa/db';

export interface FeatureUsage {
  feature_name: string;
  first_used_at?: string;
  last_used_at: string;
  usage_count: number;
  is_active: boolean;
}

export interface UserFeatureProfile {
  user_id: string;
  total_features_used: number;
  feature_adoption_rate: number;
  power_user_score: number;
  most_used_features: string[];
  unused_features: string[];
}

export class FeatureAdoptionTracker {
  // Define all trackable features
  private readonly FEATURES = {
    // Ticket Management
    TICKET_CREATION: 'ticket_creation',
    TICKET_VIEWING: 'ticket_viewing',
    TICKET_BULK_UPDATE: 'ticket_bulk_update',
    TICKET_TEMPLATES: 'ticket_templates',
    TICKET_AUTOMATION: 'ticket_automation',
    TICKET_SLA: 'ticket_sla',
    
    // Time Tracking
    TIME_ENTRY_MANUAL: 'time_entry_manual',
    TIME_ENTRY_TIMER: 'time_entry_timer',
    TIME_SHEET_SUBMISSION: 'time_sheet_submission',
    TIME_APPROVAL_WORKFLOW: 'time_approval_workflow',
    
    // Billing
    INVOICE_GENERATION: 'invoice_generation',
    INVOICE_MANUAL: 'invoice_manual',
    PAYMENT_TRACKING: 'payment_tracking',
    BILLING_RULES: 'billing_rules',
    CREDIT_MANAGEMENT: 'credit_management',
    
    // Reporting
    STANDARD_REPORTS: 'standard_reports',
    CUSTOM_REPORTS: 'custom_reports',
    REPORT_SCHEDULING: 'report_scheduling',
    DASHBOARD_WIDGETS: 'dashboard_widgets',
    
    // Integrations
    EMAIL_INTEGRATION: 'email_integration',
    CALENDAR_SYNC: 'calendar_sync',
    QUICKBOOKS_INTEGRATION: 'quickbooks_integration',
    API_USAGE: 'api_usage',
    
    // Advanced Features
    CUSTOM_FIELDS: 'custom_fields',
    WORKFLOW_AUTOMATION: 'workflow_automation',
    ROLE_MANAGEMENT: 'role_management',
    MULTI_TENANT: 'multi_tenant',
    
    // Collaboration
    TEAM_COLLABORATION: 'team_collaboration',
    CLIENT_PORTAL: 'client_portal',
    KNOWLEDGE_BASE: 'knowledge_base',
    NOTIFICATIONS: 'notifications'
  };

  /**
   * Track feature usage
   */
  trackFeatureUsage(
    featureName: string,
    userId: string,
    metadata?: Record<string, any>
  ): void {
    analytics.capture('feature_used', {
      feature_name: featureName,
      feature_category: this.getFeatureCategory(featureName),
      ...metadata
    }, userId);

    // Check if this is first-time usage
    this.checkFirstTimeUsage(featureName, userId);
  }

  /**
   * Track feature discovery (user found but hasn't used yet)
   */
  trackFeatureDiscovery(
    featureName: string,
    userId: string,
    discoveryMethod: 'navigation' | 'search' | 'tooltip' | 'documentation' | 'other',
    metadata?: Record<string, any>
  ): void {
    analytics.capture('feature_discovered', {
      feature_name: featureName,
      discovery_method: discoveryMethod,
      ...metadata
    }, userId);
  }

  /**
   * Track feature enablement/disablement
   */
  trackFeatureToggle(
    featureName: string,
    enabled: boolean,
    userId: string,
    metadata?: Record<string, any>
  ): void {
    analytics.capture(enabled ? 'feature_enabled' : 'feature_disabled', {
      feature_name: featureName,
      ...metadata
    }, userId);
  }

  /**
   * Calculate and track user's power user score
   */
  async calculatePowerUserScore(userId: string): Promise<number> {
    try {
      const { knex, tenant } = await createTenantKnex();
      
      // Get user's activity metrics (simplified example)
      const metrics = await this.getUserActivityMetrics(knex, userId, tenant || 'default');
      
      let score = 0;
      
      // Score based on feature diversity
      score += Math.min(metrics.uniqueFeaturesUsed * 5, 30); // Max 30 points
      
      // Score based on advanced feature usage
      score += metrics.advancedFeaturesUsed * 10; // 10 points per advanced feature
      
      // Score based on activity frequency
      if (metrics.daysActive >= 20) score += 20;
      else if (metrics.daysActive >= 10) score += 10;
      else if (metrics.daysActive >= 5) score += 5;
      
      // Score based on content creation
      score += Math.min(Math.floor(metrics.contentCreated / 10), 20); // Max 20 points
      
      // Track the score
      analytics.capture('power_user_score_calculated', {
        score,
        unique_features_used: metrics.uniqueFeaturesUsed,
        advanced_features_used: metrics.advancedFeaturesUsed,
        days_active: metrics.daysActive,
        content_created: metrics.contentCreated
      }, userId);
      
      return Math.min(score, 100); // Cap at 100
    } catch (error) {
      console.error('Error calculating power user score:', error);
      return 0;
    }
  }

  /**
   * Track feature retention (continued usage over time)
   */
  trackFeatureRetention(
    featureName: string,
    userId: string,
    daysSinceFirstUse: number,
    usageCountThisPeriod: number
  ): void {
    const retentionPeriod = this.getRetentionPeriod(daysSinceFirstUse);
    
    analytics.capture('feature_retention', {
      feature_name: featureName,
      retention_period: retentionPeriod,
      days_since_first_use: daysSinceFirstUse,
      usage_count_period: usageCountThisPeriod,
      is_retained: usageCountThisPeriod > 0
    }, userId);
  }

  /**
   * Identify usage patterns by role
   */
  async trackRoleBasedUsage(
    userId: string,
    userRole: string,
    featuresUsed: string[]
  ): Promise<void> {
    const rolePatterns = this.getRoleExpectedFeatures(userRole);
    const expectedFeatures = rolePatterns.expected;
    const unexpectedFeatures = featuresUsed.filter(f => !expectedFeatures.includes(f));
    const missingFeatures = expectedFeatures.filter(f => !featuresUsed.includes(f));
    
    analytics.capture('role_based_usage_pattern', {
      user_role: userRole,
      expected_features_used: expectedFeatures.filter(f => featuresUsed.includes(f)).length,
      unexpected_features_used: unexpectedFeatures.length,
      missing_expected_features: missingFeatures.length,
      adoption_rate: (expectedFeatures.filter(f => featuresUsed.includes(f)).length / expectedFeatures.length) * 100
    }, userId);
  }

  /**
   * Track new feature adoption rate
   */
  trackNewFeatureAdoption(
    featureName: string,
    featureReleaseDate: Date,
    adoptionMetrics: {
      total_users: number;
      adopted_users: number;
      days_since_release: number;
    }
  ): void {
    const adoptionRate = (adoptionMetrics.adopted_users / adoptionMetrics.total_users) * 100;
    
    analytics.capture('new_feature_adoption', {
      feature_name: featureName,
      feature_release_date: featureReleaseDate.toISOString(),
      total_eligible_users: adoptionMetrics.total_users,
      adopted_users: adoptionMetrics.adopted_users,
      adoption_rate: adoptionRate,
      days_since_release: adoptionMetrics.days_since_release,
      adoption_velocity: adoptionMetrics.adopted_users / adoptionMetrics.days_since_release
    });
  }

  /**
   * Helper: Check if this is first-time usage of a feature
   */
  private async checkFirstTimeUsage(featureName: string, userId: string): Promise<void> {
    // In a real implementation, you'd check a database or cache
    // For now, we'll track it as an event
    analytics.capture('feature_first_use', {
      feature_name: featureName,
      feature_category: this.getFeatureCategory(featureName)
    }, userId);
  }

  /**
   * Helper: Get feature category
   */
  private getFeatureCategory(featureName: string): string {
    const categories: Record<string, string[]> = {
      ticketing: ['ticket_creation', 'ticket_bulk_update', 'ticket_templates', 'ticket_automation', 'ticket_sla'],
      time_tracking: ['time_entry_manual', 'time_entry_timer', 'time_sheet_submission', 'time_approval_workflow'],
      billing: ['invoice_generation', 'invoice_manual', 'payment_tracking', 'billing_rules', 'credit_management'],
      reporting: ['standard_reports', 'custom_reports', 'report_scheduling', 'dashboard_widgets'],
      integrations: ['email_integration', 'calendar_sync', 'quickbooks_integration', 'api_usage'],
      advanced: ['custom_fields', 'workflow_automation', 'role_management', 'multi_tenant'],
      collaboration: ['team_collaboration', 'client_portal', 'knowledge_base', 'notifications']
    };

    for (const [category, features] of Object.entries(categories)) {
      if (features.includes(featureName)) {
        return category;
      }
    }
    return 'other';
  }

  /**
   * Helper: Get user activity metrics
   */
  private async getUserActivityMetrics(knex: any, userId: string, tenant: string): Promise<any> {
    // Simplified metrics - in production, these would come from actual database queries
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Count unique features used (mock data)
    const uniqueFeaturesUsed = 12;
    
    // Count advanced features used (mock data)
    const advancedFeaturesUsed = 3;
    
    // Count days active in last 30 days (mock data)
    const daysActive = 18;
    
    // Count content created (tickets, invoices, etc.) (mock data)
    const contentCreated = 45;

    return {
      uniqueFeaturesUsed,
      advancedFeaturesUsed,
      daysActive,
      contentCreated
    };
  }

  /**
   * Helper: Get retention period label
   */
  private getRetentionPeriod(daysSinceFirstUse: number): string {
    if (daysSinceFirstUse <= 1) return 'day_1';
    if (daysSinceFirstUse <= 7) return 'week_1';
    if (daysSinceFirstUse <= 30) return 'month_1';
    if (daysSinceFirstUse <= 90) return 'month_3';
    if (daysSinceFirstUse <= 180) return 'month_6';
    return 'month_6_plus';
  }

  /**
   * Helper: Get expected features by role
   */
  private getRoleExpectedFeatures(role: string): { expected: string[] } {
    const roleFeatures: Record<string, string[]> = {
      admin: [
        this.FEATURES.TICKET_CREATION,
        this.FEATURES.TICKET_BULK_UPDATE,
        this.FEATURES.INVOICE_GENERATION,
        this.FEATURES.BILLING_RULES,
        this.FEATURES.CUSTOM_REPORTS,
        this.FEATURES.ROLE_MANAGEMENT,
        this.FEATURES.WORKFLOW_AUTOMATION
      ],
      manager: [
        this.FEATURES.TICKET_CREATION,
        this.FEATURES.TIME_APPROVAL_WORKFLOW,
        this.FEATURES.STANDARD_REPORTS,
        this.FEATURES.DASHBOARD_WIDGETS,
        this.FEATURES.TEAM_COLLABORATION
      ],
      technician: [
        this.FEATURES.TICKET_CREATION,
        this.FEATURES.TIME_ENTRY_MANUAL,
        this.FEATURES.TIME_ENTRY_TIMER,
        this.FEATURES.TIME_SHEET_SUBMISSION,
        this.FEATURES.KNOWLEDGE_BASE
      ],
      client: [
        this.FEATURES.CLIENT_PORTAL,
        this.FEATURES.TICKET_CREATION,
        this.FEATURES.KNOWLEDGE_BASE
      ]
    };

    return {
      expected: roleFeatures[role] || []
    };
  }
}

// Singleton instance
export const featureAdoptionTracker = new FeatureAdoptionTracker();