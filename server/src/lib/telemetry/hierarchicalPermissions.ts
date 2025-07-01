import { Knex } from 'knex';
import TenantTelemetrySettingsModel from '../models/tenantTelemetrySettings';
import TelemetryPreferencesModel from '../models/telemetryPreferences';
import { getCurrentTenantId } from '../db';
import logger from '../../utils/logger';

export interface TelemetryDecision {
  allowed: boolean;
  reason: string;
  anonymizationLevel: 'none' | 'partial' | 'full';
  tenantSettings: {
    enabled: boolean;
    allowUserOverride: boolean;
  };
  userSettings: {
    optedOut: boolean;
    canOptOut: boolean;
  };
}

export class HierarchicalTelemetryManager {
  private knex: Knex;

  constructor(knex: Knex) {
    this.knex = knex;
  }

  /**
   * Main decision function: Should we track telemetry for this user?
   */
  async shouldTrackTelemetry(
    userId: string,
    tenantId?: string,
    category?: string
  ): Promise<TelemetryDecision> {
    try {
      const resolvedTenantId = tenantId || await getCurrentTenantId();
      
      if (!resolvedTenantId) {
        return this.createDecision(false, 'No tenant context available');
      }

      // 1. Telemetry is enabled by default (no legacy environment overrides)

      // 2. Get tenant settings
      const tenantSettings = await TenantTelemetrySettingsModel.getTenantTelemetrySettings(
        this.knex,
        resolvedTenantId
      );

      if (!tenantSettings.enabled) {
        return this.createDecision(
          false, 
          'Tenant: Telemetry disabled by organization admin',
          tenantSettings.anonymizationLevel,
          { enabled: false, allowUserOverride: tenantSettings.allowUserOverride },
          { optedOut: false, canOptOut: false }
        );
      }

      // 3. Check user preferences (if tenant allows override)
      if (tenantSettings.allowUserOverride) {
        const userPreferences = await TelemetryPreferencesModel.getTelemetryPreferences(
          this.knex,
          userId
        );

        // Check if user has opted out
        if (userPreferences.error_tracking === false && 
            userPreferences.performance_metrics === false &&
            userPreferences.usage_analytics === false &&
            userPreferences.system_metrics === false) {
          
          return this.createDecision(
            false,
            'User: Opted out of all telemetry',
            tenantSettings.anonymizationLevel,
            { enabled: true, allowUserOverride: true },
            { optedOut: true, canOptOut: true }
          );
        }

        // Check specific category if provided
        if (category && !(userPreferences as any)[category]) {
          return this.createDecision(
            false,
            `User: Opted out of ${category}`,
            tenantSettings.anonymizationLevel,
            { enabled: true, allowUserOverride: true },
            { optedOut: true, canOptOut: true }
          );
        }
      }

      // 4. All checks passed - telemetry is allowed
      return this.createDecision(
        true,
        tenantSettings.allowUserOverride ? 'Allowed: User consented' : 'Allowed: Organization policy',
        tenantSettings.anonymizationLevel,
        { enabled: true, allowUserOverride: tenantSettings.allowUserOverride },
        { 
          optedOut: false, 
          canOptOut: tenantSettings.allowUserOverride 
        }
      );

    } catch (error) {
      logger.error('Error in telemetry decision logic:', error);
      return this.createDecision(false, 'Error: Failed to check permissions');
    }
  }

  /**
   * Check if telemetry collection should happen (quick check)
   */
  async canCollectTelemetry(
    userId: string,
    category: string,
    tenantId?: string
  ): Promise<boolean> {
    const decision = await this.shouldTrackTelemetry(userId, tenantId, category);
    return decision.allowed;
  }

  /**
   * Get telemetry context with hierarchical settings
   */
  async getTelemetryContext(
    userId: string,
    tenantId?: string
  ): Promise<{
    user_id_hash?: string;
    tenant_id_hash?: string;
    consent_type: 'tenant' | 'user' | 'none';
    anonymization_level: string;
    environment: string;
  }> {
    try {
      const decision = await this.shouldTrackTelemetry(userId, tenantId);
      
      if (!decision.allowed) {
        return {
          consent_type: 'none',
          anonymization_level: 'full',
          environment: process.env.NODE_ENV || 'development'
        };
      }

      const resolvedTenantId = tenantId || await getCurrentTenantId();
      
      return {
        user_id_hash: this.hashUserId(userId, decision.anonymizationLevel),
        tenant_id_hash: resolvedTenantId ? this.hashTenantId(resolvedTenantId, decision.anonymizationLevel) : undefined,
        consent_type: decision.tenantSettings.allowUserOverride ? 'user' : 'tenant',
        anonymization_level: decision.anonymizationLevel,
        environment: process.env.NODE_ENV || 'development'
      };

    } catch (error) {
      logger.error('Error getting telemetry context:', error);
      return {
        consent_type: 'none',
        anonymization_level: 'full',
        environment: process.env.NODE_ENV || 'development'
      };
    }
  }

  /**
   * Check if user needs consent prompt
   */
  async needsConsentPrompt(userId: string, tenantId?: string): Promise<boolean> {
    try {
      const decision = await this.shouldTrackTelemetry(userId, tenantId);
      
      // Don't prompt if tenant doesn't allow user override
      if (!decision.userSettings.canOptOut) {
        return false;
      }

      // Don't prompt if telemetry is disabled at tenant level
      if (!decision.tenantSettings.enabled) {
        return false;
      }

      // Check if user has set any preferences
      const hasSetPreferences = await TelemetryPreferencesModel.hasSetPreferences(
        this.knex,
        userId
      );

      return !hasSetPreferences;

    } catch (error) {
      logger.error('Error checking consent prompt need:', error);
      return false;
    }
  }

  /**
   * Helper to create consistent decision objects
   */
  private createDecision(
    allowed: boolean,
    reason: string,
    anonymizationLevel: 'none' | 'partial' | 'full' = 'full',
    tenantSettings = { enabled: false, allowUserOverride: false },
    userSettings = { optedOut: false, canOptOut: false }
  ): TelemetryDecision {
    return {
      allowed,
      reason,
      anonymizationLevel,
      tenantSettings,
      userSettings
    };
  }

  /**
   * Hash user ID based on anonymization level
   */
  private hashUserId(userId: string, level: 'none' | 'partial' | 'full'): string {
    if (level === 'none') {
      return userId;
    }

    const salt = 'default-salt-change-in-production';
    const crypto = require('crypto');
    
    if (level === 'partial') {
      // Partial: Use first 8 characters of hash for some correlation
      return crypto
        .createHash('sha256')
        .update(userId + salt + 'user')
        .digest('hex')
        .substring(0, 8);
    }

    // Full: Use longer hash but still consistent for correlation
    return crypto
      .createHash('sha256')
      .update(userId + salt + 'user')
      .digest('hex')
      .substring(0, 16);
  }

  /**
   * Hash tenant ID based on anonymization level
   */
  private hashTenantId(tenantId: string, level: 'none' | 'partial' | 'full'): string {
    if (level === 'none') {
      return tenantId;
    }

    const salt = 'default-salt-change-in-production';
    const crypto = require('crypto');
    
    if (level === 'partial') {
      return crypto
        .createHash('sha256')
        .update(tenantId + salt + 'tenant')
        .digest('hex')
        .substring(0, 8);
    }

    return crypto
      .createHash('sha256')
      .update(tenantId + salt + 'tenant')
      .digest('hex')
      .substring(0, 16);
  }
}

export default HierarchicalTelemetryManager;