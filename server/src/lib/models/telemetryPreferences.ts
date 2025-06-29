import { Knex } from 'knex';
import UserPreferences from './userPreferences';
import { TELEMETRY_CONFIG, TelemetryPreferences } from '../../config/telemetry';
import logger from '../../utils/logger';

const TELEMETRY_SETTING_PREFIX = 'telemetry_';
const TELEMETRY_CONSENT_SETTING = 'telemetry_consent_version';

export interface TelemetryConsentData extends TelemetryPreferences {
  last_updated: string;
  consent_version: string;
  user_id: string;
  tenant_id: string;
}

export const TelemetryPreferencesModel = {
  /**
   * Get telemetry preferences for a user with privacy-first defaults
   */
  getTelemetryPreferences: async (
    knexOrTrx: Knex | Knex.Transaction, 
    userId: string
  ): Promise<TelemetryConsentData> => {
    try {
      // Get all telemetry-related preferences
      const allPreferences = await UserPreferences.getAllForUser(knexOrTrx, userId);
      const telemetryPrefs = allPreferences.filter(pref => 
        pref.setting_name.startsWith(TELEMETRY_SETTING_PREFIX) ||
        pref.setting_name === TELEMETRY_CONSENT_SETTING
      );

      // Initialize with privacy-first defaults (all disabled)
      const preferences: TelemetryConsentData = {
        ...TELEMETRY_CONFIG.DEFAULT_PREFERENCES,
        last_updated: new Date().toISOString(),
        consent_version: TELEMETRY_CONFIG.PRIVACY.CONSENT_VERSION,
        user_id: userId,
        tenant_id: '', // Will be set by getCurrentTenantId context
      };

      // Apply saved preferences
      for (const pref of telemetryPrefs) {
        if (pref.setting_name === TELEMETRY_CONSENT_SETTING) {
          preferences.consent_version = pref.setting_value;
          preferences.last_updated = pref.updated_at.toISOString();
        } else if (pref.setting_name.startsWith(TELEMETRY_SETTING_PREFIX)) {
          const category = pref.setting_name.replace(TELEMETRY_SETTING_PREFIX, '');
          if (category in preferences) {
            preferences[category] = Boolean(pref.setting_value);
          }
        }
      }

      return preferences;
    } catch (error) {
      logger.error(`Error getting telemetry preferences for user ${userId}:`, error);
      // Return safe defaults on error
      return {
        ...TELEMETRY_CONFIG.DEFAULT_PREFERENCES,
        last_updated: new Date().toISOString(),
        consent_version: TELEMETRY_CONFIG.PRIVACY.CONSENT_VERSION,
        user_id: userId,
        tenant_id: '',
      };
    }
  },

  /**
   * Set telemetry preferences with audit trail
   */
  setTelemetryPreferences: async (
    knexOrTrx: Knex | Knex.Transaction,
    userId: string, 
    preferences: Partial<TelemetryPreferences>
  ): Promise<void> => {
    try {
      const preferencesToSave = [];
      
      // Save each telemetry category preference
      for (const [category, enabled] of Object.entries(preferences)) {
        if (category === 'last_updated' || category === 'consent_version') continue;
        
        preferencesToSave.push({
          user_id: userId,
          setting_name: `${TELEMETRY_SETTING_PREFIX}${category}`,
          setting_value: Boolean(enabled),
          updated_at: new Date()
        });
      }

      // Save consent version update
      preferencesToSave.push({
        user_id: userId,
        setting_name: TELEMETRY_CONSENT_SETTING,
        setting_value: TELEMETRY_CONFIG.PRIVACY.CONSENT_VERSION,
        updated_at: new Date()
      });

      await UserPreferences.bulkUpsert(knexOrTrx, preferencesToSave);
      
      logger.info(`Updated telemetry preferences for user ${userId}`, {
        userId,
        categories: Object.keys(preferences).filter(k => k !== 'last_updated' && k !== 'consent_version'),
        enabledCount: Object.values(preferences).filter(Boolean).length
      });
    } catch (error) {
      logger.error(`Error setting telemetry preferences for user ${userId}:`, error);
      throw error;
    }
  },

  /**
   * Check if a specific telemetry category is enabled for user
   */
  isCategoryEnabled: async (
    knexOrTrx: Knex | Knex.Transaction,
    userId: string,
    category: string
  ): Promise<boolean> => {
    try {
      // First check environment override
      if (TELEMETRY_CONFIG.ENVIRONMENT_OVERRIDES.TELEMETRY_FORCE_DISABLE) {
        return false;
      }

      if (!TELEMETRY_CONFIG.ENVIRONMENT_OVERRIDES.TELEMETRY_ENABLED) {
        return false;
      }

      const preference = await UserPreferences.get(
        knexOrTrx,
        userId,
        `${TELEMETRY_SETTING_PREFIX}${category}`
      );

      // Default to disabled if no preference set
      return preference ? Boolean(preference.setting_value) : false;
    } catch (error) {
      logger.error(`Error checking category ${category} for user ${userId}:`, error);
      return false; // Fail safely - no telemetry on error
    }
  },

  /**
   * Get enabled categories for a user (for telemetry context)
   */
  getEnabledCategories: async (
    knexOrTrx: Knex | Knex.Transaction,
    userId: string
  ): Promise<string[]> => {
    try {
      const preferences = await TelemetryPreferencesModel.getTelemetryPreferences(knexOrTrx, userId);
      
      return Object.entries(preferences)
        .filter(([key, value]) => {
          // Only include actual telemetry categories, not metadata
          return key in TELEMETRY_CONFIG.DEFAULT_PREFERENCES && value === true;
        })
        .map(([key]) => key);
    } catch (error) {
      logger.error(`Error getting enabled categories for user ${userId}:`, error);
      return []; // Return empty array on error
    }
  },

  /**
   * Disable all telemetry for a user (for opt-out or account deletion)
   */
  disableAllTelemetry: async (
    knexOrTrx: Knex | Knex.Transaction,
    userId: string
  ): Promise<void> => {
    try {
      const disabledPreferences = Object.keys(TELEMETRY_CONFIG.DEFAULT_PREFERENCES)
        .reduce((acc, category) => ({ ...acc, [category]: false }), {});

      await TelemetryPreferencesModel.setTelemetryPreferences(
        knexOrTrx,
        userId,
        disabledPreferences
      );

      logger.info(`Disabled all telemetry for user ${userId}`);
    } catch (error) {
      logger.error(`Error disabling all telemetry for user ${userId}:`, error);
      throw error;
    }
  },

  /**
   * Check if user has ever set telemetry preferences (for first-time prompts)
   */
  hasSetPreferences: async (
    knexOrTrx: Knex | Knex.Transaction,
    userId: string
  ): Promise<boolean> => {
    try {
      const consentPreference = await UserPreferences.get(
        knexOrTrx,
        userId,
        TELEMETRY_CONSENT_SETTING
      );

      return consentPreference !== undefined;
    } catch (error) {
      logger.error(`Error checking if user ${userId} has set preferences:`, error);
      return false;
    }
  }
};

export default TelemetryPreferencesModel;