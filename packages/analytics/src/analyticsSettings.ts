import { v4 as uuidv4 } from 'uuid';
import { getTenantSettingsByTenantId } from '@alga-psa/tenancy/actions';
import { createTenantKnex } from '@alga-psa/db';
import { getTenantForCurrentRequest } from '@alga-psa/tenancy/server';
import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { getAppVersion } from './utils/version';

interface AnalyticsSettings {
  instance_id: string;
  instance_created_at: string;
  usage_stats_enabled: boolean;
  first_seen_version: string;
  environment: string;
  last_updated_at?: string;
}

// Cache for performance
const instanceIdCache: Map<string, string> = new Map();

/**
 * Get or create a stable instance ID for the current tenant
 */
export async function getOrCreateInstanceId(): Promise<string> {
  try {
    // First check environment variable override
    if (process.env.INSTANCE_ID) {
      return process.env.INSTANCE_ID;
    }

    // Get current tenant
    const tenant = await getTenantForCurrentRequest();
    if (!tenant) {
      // Fallback for system-level operations
      return getSystemInstanceId();
    }

    // Check cache
    const cached = instanceIdCache.get(tenant);
    if (cached) {
      return cached;
    }

    // Get from tenant settings
    const settings = await getTenantSettingsByTenantId(tenant);
    const analyticsSettings = settings?.settings?.analytics as AnalyticsSettings | undefined;

    if (analyticsSettings?.instance_id) {
      instanceIdCache.set(tenant, analyticsSettings.instance_id);
      return analyticsSettings.instance_id;
    }

    // Generate new instance ID
    const newInstanceId = uuidv4();
    await saveAnalyticsSettings(tenant, {
      instance_id: newInstanceId,
      instance_created_at: new Date().toISOString(),
      usage_stats_enabled: process.env.ALGA_USAGE_STATS !== 'false',
      first_seen_version: getAppVersion(),
      environment: process.env.NODE_ENV || 'development'
    });

    instanceIdCache.set(tenant, newInstanceId);
    return newInstanceId;
  } catch (error) {
    console.error('Error getting instance ID:', error);
    // Fallback to hostname-based ID
    return getSystemInstanceId();
  }
}

/**
 * Get analytics settings for the current tenant
 */
export async function getAnalyticsSettings(): Promise<AnalyticsSettings | null> {
  try {
    const tenant = await getTenantForCurrentRequest();
    if (!tenant) return null;
    const settings = await getTenantSettingsByTenantId(tenant);
    return (settings?.settings?.analytics as AnalyticsSettings) || null;
  } catch (error) {
    console.error('Error getting analytics settings:', error);
    return null;
  }
}

/**
 * Update analytics settings for a tenant
 */
async function saveAnalyticsSettings(tenant: string, analyticsSettings: AnalyticsSettings): Promise<void> {
  try {
    const { knex } = await createTenantKnex();
    
    await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Get existing settings to merge
      const existingSettings = await trx('tenant_settings')
        .select('settings')
        .where({ tenant })
        .first();

      const currentSettings = existingSettings?.settings || {};
      const updatedSettings = {
        ...currentSettings,
        analytics: {
          ...currentSettings.analytics,
          ...analyticsSettings,
          last_updated_at: new Date().toISOString()
        }
      };

      // Check if tenant settings already exist
      const existingRecord = await trx('tenant_settings')
        .where({ tenant })
        .first();

      if (existingRecord) {
        // Update existing settings
        await trx('tenant_settings')
          .where({ tenant })
          .update({
            settings: JSON.stringify(updatedSettings),
            updated_at: trx.fn.now()
          });
      } else {
        // Insert new settings
        await trx('tenant_settings')
          .insert({
            tenant,
            settings: JSON.stringify(updatedSettings),
            updated_at: trx.fn.now()
          });
      }
    });
  } catch (error) {
    console.error('Error saving analytics settings:', error);
    throw error;
  }
}

/**
 * Update analytics preferences (e.g., opt-out)
 */
export async function updateAnalyticsPreferences(preferences: Partial<AnalyticsSettings>): Promise<void> {
  try {
    const tenant = await getTenantForCurrentRequest();
    if (!tenant) {
      throw new Error('No tenant found');
    }

    const currentSettings = await getAnalyticsSettings() || {
      instance_id: await getOrCreateInstanceId(),
      instance_created_at: new Date().toISOString(),
      usage_stats_enabled: true,
      first_seen_version: getAppVersion(),
      environment: process.env.NODE_ENV || 'development'
    };

    await saveAnalyticsSettings(tenant, {
      ...currentSettings,
      ...preferences
    });

    // Clear cache if usage stats were disabled
    if (preferences.usage_stats_enabled === false) {
      instanceIdCache.delete(tenant);
    }
  } catch (error) {
    console.error('Error updating analytics preferences:', error);
    throw error;
  }
}

/**
 * Get system-level instance ID for operations without tenant context
 */
function getSystemInstanceId(): string {
  // Use a consistent system ID based on hostname
  const hostname = require('os').hostname();
  const crypto = require('crypto');
  return crypto.createHash('sha256')
    .update(`system_${hostname}`)
    .digest('hex')
    .substring(0, 16);
}

/**
 * Check if analytics is enabled for the current tenant
 */
export async function isAnalyticsEnabled(): Promise<boolean> {
  // First check global environment variable
  if (process.env.ALGA_USAGE_STATS === 'false') {
    return false;
  }

  // Then check tenant-specific settings
  const settings = await getAnalyticsSettings();
  return settings?.usage_stats_enabled !== false;
}

/**
 * Clear instance ID cache (useful for testing or tenant switches)
 */
export function clearInstanceIdCache(): void {
  instanceIdCache.clear();
}
