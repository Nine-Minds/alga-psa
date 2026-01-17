'use server';

import { getCurrentUser } from '@/lib/actions/user-actions/userActions';
import { getTenantForCurrentRequest } from '@/lib/tenant';
import { createTenantKnex } from '@/lib/db';
import type { WizardData } from '@alga-psa/ui/components/onboarding/types';

export interface TenantSettings {
  tenant: string;
  onboarding_completed: boolean;
  onboarding_completed_at?: Date;
  onboarding_skipped: boolean;
  onboarding_data?: WizardData;
  settings?: Record<string, any>;
  ticket_display_settings?: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export async function getTenantSettings(): Promise<TenantSettings | null> {
  try {
    const tenant = await getTenantForCurrentRequest();
    if (!tenant) {
      // In E2E test mode without proper session, gracefully return null
      // instead of throwing to allow pages to load
      if (process.env.E2E_AUTH_BYPASS === 'true') {
        return null;
      }
      throw new Error('No tenant found');
    }

    const { knex } = await createTenantKnex();
    const settings = await knex
      .select('*')
      .from('tenant_settings')
      .where({ tenant })
      .first();

    return settings || null;
  } catch (error) {
    console.error('Error getting tenant settings:', error);
    throw error;
  }
}

export async function updateTenantOnboardingStatus(
  completed: boolean,
  wizardData?: WizardData,
  skipped: boolean = false
): Promise<void> {
  try {
    const tenant = await getTenantForCurrentRequest();
    if (!tenant) {
      throw new Error('No tenant found');
    }

    // Ensure user is authenticated (no admin check during onboarding)
    const user = await getCurrentUser();
    if (!user) {
      throw new Error('User must be authenticated');
    }

    const { knex } = await createTenantKnex();
    
    // Use a literal timestamp for Citus compatibility
    const now = new Date();
    
    const updateData: any = {
      onboarding_completed: completed,
      onboarding_skipped: skipped,
      updated_at: now,
    };

    if (completed) {
      updateData.onboarding_completed_at = now;
      // Clear onboarding data when completed
      updateData.onboarding_data = null;
    } else if (wizardData) {
      updateData.onboarding_data = JSON.stringify(wizardData);
    }

    // Check if tenant settings already exist
    const existingSettings = await knex('tenant_settings')
      .where({ tenant })
      .first();

    if (existingSettings) {
      // Update existing settings
      await knex('tenant_settings')
        .where({ tenant })
        .update(updateData);
    } else {
      // Insert new settings
      await knex('tenant_settings')
        .insert({
          tenant,
          ...updateData,
        });
    }

  } catch (error) {
    console.error('Error updating tenant onboarding status:', error);
    throw error;
  }
}

export async function saveTenantOnboardingProgress(
  wizardData: Partial<WizardData>
): Promise<void> {
  try {
    const tenant = await getTenantForCurrentRequest();
    if (!tenant) {
      throw new Error('No tenant found');
    }

    // Ensure user is authenticated (no admin check during onboarding)
    const user = await getCurrentUser();
    if (!user) {
      throw new Error('User must be authenticated');
    }

    // Get existing data to merge with
    const existingSettings = await getTenantSettings();
    const existingData = existingSettings?.onboarding_data || {};

    const mergedData = {
      ...existingData,
      ...wizardData,
    };

    const { knex } = await createTenantKnex();
    
    // Use a literal timestamp for Citus compatibility
    const now = new Date();
    
    // Check if tenant settings already exist
    const existingRecord = await knex('tenant_settings')
      .where({ tenant })
      .first();

    if (existingRecord) {
      // Update existing settings
      await knex('tenant_settings')
        .where({ tenant })
        .update({
          onboarding_data: JSON.stringify(mergedData),
          updated_at: now,
        });
    } else {
      // Insert new settings
      await knex('tenant_settings')
        .insert({
          tenant,
          onboarding_data: JSON.stringify(mergedData),
          updated_at: now,
        });
    }

  } catch (error) {
    console.error('Error saving tenant onboarding progress:', error);
    throw error;
  }
}

export async function clearTenantOnboardingData(): Promise<void> {
  try {
    const tenant = await getTenantForCurrentRequest();
    if (!tenant) {
      throw new Error('No tenant found');
    }

    // Check if user has admin permissions
    const user = await getCurrentUser();
    if (!user || !user.roles.some((role: any) => role.role_name === 'admin')) {
      throw new Error('Only admin users can clear onboarding data');
    }

    const { knex } = await createTenantKnex();
    
    // Use a literal timestamp for Citus compatibility
    const now = new Date();
    
    await knex('tenant_settings')
      .where({ tenant })
      .update({
        onboarding_data: null,
        updated_at: now,
      });

  } catch (error) {
    console.error('Error clearing tenant onboarding data:', error);
    throw error;
  }
}

export async function updateTenantSettings(
  settings: Record<string, any>
): Promise<void> {
  try {
    const tenant = await getTenantForCurrentRequest();
    if (!tenant) {
      throw new Error('No tenant found');
    }

    // Get existing settings to merge
    const existingSettings = await getTenantSettings();
    const currentSettings = existingSettings?.settings || {};

    const updatedSettings = {
      ...currentSettings,
      ...settings
    };

    const { knex } = await createTenantKnex();
    
    // Use a literal timestamp for Citus compatibility
    const now = new Date();
    
    await knex('tenant_settings')
      .insert({
        tenant,
        settings: JSON.stringify(updatedSettings),
        updated_at: now,
      })
      .onConflict('tenant')
      .merge({
        settings: JSON.stringify(updatedSettings),
        updated_at: now,
      });

  } catch (error) {
    console.error('Error updating tenant settings:', error);
    throw error;
  }
}

export async function getTenantAnalyticsSettings(): Promise<any> {
  try {
    const settings = await getTenantSettings();
    return settings?.settings?.analytics || null;
  } catch (error) {
    console.error('Error getting tenant analytics settings:', error);
    return null;
  }
}

export async function updateTenantAnalyticsSettings(
  analyticsSettings: Record<string, any>
): Promise<void> {
  try {
    const existingSettings = await getTenantSettings();
    const currentSettings = existingSettings?.settings || {};

    await updateTenantSettings({
      ...currentSettings,
      analytics: {
        ...currentSettings.analytics,
        ...analyticsSettings,
        last_updated_at: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Error updating tenant analytics settings:', error);
    throw error;
  }
}

export async function initializeTenantSettings(tenantId: string): Promise<void> {
  try {
    const { knex } = await createTenantKnex();
    
    // Use a literal timestamp for Citus compatibility
    const now = new Date();
    
    // Initialize tenant settings with both onboarding flags set to false
    await knex('tenant_settings')
      .insert({
        tenant: tenantId,
        onboarding_completed: false,
        onboarding_skipped: false,
        onboarding_data: null,
        settings: null,
        created_at: now,
        updated_at: now,
      })
      .onConflict('tenant')
      .ignore(); // Don't overwrite if already exists

  } catch (error) {
    console.error('Error initializing tenant settings:', error);
    throw error;
  }
}
