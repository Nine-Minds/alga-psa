import { Knex } from 'knex';
import { getCurrentTenantId } from '../db';
import { getCurrentUser } from '../actions/user-actions/userActions';
import { TenantTelemetrySettings, TENANT_TELEMETRY_DEFAULTS, INDUSTRY_DEFAULTS } from '../../config/telemetry';
import logger from '../../utils/logger';

export const TenantTelemetrySettingsModel = {
  /**
   * Get telemetry settings for a tenant
   */
  getTenantTelemetrySettings: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenantId?: string
  ): Promise<TenantTelemetrySettings> => {
    try {
      const resolvedTenantId = tenantId || await getCurrentTenantId();
      
      if (!resolvedTenantId) {
        throw new Error('No tenant context available');
      }

      // Get tenant info to check industry
      const tenant = await knexOrTrx('tenants')
        .where('tenant_id', resolvedTenantId)
        .select('telemetry_settings', 'industry', 'name')
        .first();

      if (!tenant) {
        throw new Error(`Tenant ${resolvedTenantId} not found`);
      }

      // If no telemetry settings exist, create defaults based on industry
      if (!tenant.telemetry_settings) {
        const industryDefaults = INDUSTRY_DEFAULTS[tenant.industry] || INDUSTRY_DEFAULTS.general;
        const defaultSettings: TenantTelemetrySettings = {
          ...TENANT_TELEMETRY_DEFAULTS,
          ...industryDefaults,
          lastUpdated: new Date().toISOString(),
          updatedBy: 'system'
        };

        // Save the defaults
        await knexOrTrx('tenants')
          .where('tenant_id', resolvedTenantId)
          .update({
            telemetry_settings: JSON.stringify(defaultSettings),
            updated_at: knexOrTrx.fn.now()
          });

        return defaultSettings;
      }

      return typeof tenant.telemetry_settings === 'string' 
        ? JSON.parse(tenant.telemetry_settings)
        : tenant.telemetry_settings;

    } catch (error) {
      logger.error('Error getting tenant telemetry settings:', error);
      // Return safe defaults on error
      return TENANT_TELEMETRY_DEFAULTS;
    }
  },

  /**
   * Update tenant telemetry settings (admin only)
   */
  updateTenantTelemetrySettings: async (
    knexOrTrx: Knex | Knex.Transaction,
    settings: Partial<TenantTelemetrySettings>,
    tenantId?: string
  ): Promise<TenantTelemetrySettings> => {
    try {
      const resolvedTenantId = tenantId || await getCurrentTenantId();
      const currentUser = await getCurrentUser();
      
      if (!resolvedTenantId || !currentUser) {
        throw new Error('No tenant or user context available');
      }
      
      const currentUserId = currentUser.user_id;

      // Verify user has admin permissions
      const userRole = await knexOrTrx('users')
        .where({ user_id: currentUserId, tenant: resolvedTenantId })
        .select('role')
        .first();

      if (!userRole || !['admin', 'owner'].includes(userRole.role)) {
        throw new Error('Insufficient permissions to update tenant telemetry settings');
      }

      // Get current settings
      const currentSettings = await TenantTelemetrySettingsModel.getTenantTelemetrySettings(
        knexOrTrx, 
        resolvedTenantId
      );

      // Merge with updates
      const updatedSettings: TenantTelemetrySettings = {
        ...currentSettings,
        ...settings,
        lastUpdated: new Date().toISOString(),
        updatedBy: currentUserId
      };

      // Validate settings
      if (updatedSettings.anonymizationLevel && 
          !['none', 'partial', 'full'].includes(updatedSettings.anonymizationLevel)) {
        throw new Error('Invalid anonymization level');
      }

      // Save to database
      await knexOrTrx('tenants')
        .where('tenant_id', resolvedTenantId)
        .update({
          telemetry_settings: JSON.stringify(updatedSettings),
          updated_at: knexOrTrx.fn.now()
        });

      logger.info(`Updated tenant telemetry settings for tenant ${resolvedTenantId}`, {
        tenantId: resolvedTenantId,
        updatedBy: currentUserId,
        enabled: updatedSettings.enabled,
        allowUserOverride: updatedSettings.allowUserOverride,
        anonymizationLevel: updatedSettings.anonymizationLevel
      });

      return updatedSettings;

    } catch (error) {
      logger.error('Error updating tenant telemetry settings:', error);
      throw error;
    }
  },

  /**
   * Check if telemetry is enabled for a tenant
   */
  isTenantTelemetryEnabled: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenantId?: string
  ): Promise<boolean> => {
    try {
      const settings = await TenantTelemetrySettingsModel.getTenantTelemetrySettings(
        knexOrTrx,
        tenantId
      );
      return settings.enabled;
    } catch (error) {
      logger.error('Error checking tenant telemetry status:', error);
      return false; // Fail safely
    }
  },

  /**
   * Check if users are allowed to override telemetry settings
   */
  canUsersOverride: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenantId?: string
  ): Promise<boolean> => {
    try {
      const settings = await TenantTelemetrySettingsModel.getTenantTelemetrySettings(
        knexOrTrx,
        tenantId
      );
      return settings.enabled && settings.allowUserOverride;
    } catch (error) {
      logger.error('Error checking user override permission:', error);
      return false; // Fail safely
    }
  },

  /**
   * Log consent change for compliance
   */
  logConsentChange: async (
    knexOrTrx: Knex | Knex.Transaction,
    change: {
      tenantId: string;
      userId?: string;
      consentGiven: boolean;
      changedBy: string;
      reason?: string;
      ipAddress?: string;
    }
  ): Promise<void> => {
    try {
      await knexOrTrx('telemetry_consent_log').insert({
        tenant_id: change.tenantId,
        user_id: change.userId,
        consent_given: change.consentGiven,
        changed_by: change.changedBy,
        reason: change.reason,
        ip_address: change.ipAddress,
        timestamp: knexOrTrx.fn.now()
      });
    } catch (error) {
      logger.error('Error logging consent change:', error);
      // Don't throw - logging failure shouldn't break the main operation
    }
  }
};

export default TenantTelemetrySettingsModel;