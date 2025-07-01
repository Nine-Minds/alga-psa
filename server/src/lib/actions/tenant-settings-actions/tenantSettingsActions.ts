'use server';

import { getCurrentUser } from '@/lib/actions/user-actions/userActions';
import { getTenantForCurrentRequest } from '@/lib/tenant';
import { createTenantKnex } from '@/lib/db';
import { WizardData } from '@/components/onboarding/types';

export interface TenantSettings {
  tenant: string;
  onboarding_completed: boolean;
  onboarding_completed_at?: Date;
  onboarding_skipped: boolean;
  onboarding_data?: WizardData;
  settings?: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export async function getTenantSettings(): Promise<TenantSettings | null> {
  try {
    const tenant = await getTenantForCurrentRequest();
    if (!tenant) {
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

    // Check if user has admin permissions
    const user = await getCurrentUser();
    if (!user || !user.roles.some((role: any) => role.role_name === 'admin')) {
      throw new Error('Only admin users can update onboarding status');
    }

    const { knex } = await createTenantKnex();
    
    const updateData: any = {
      onboarding_completed: completed,
      onboarding_skipped: skipped,
      updated_at: knex.fn.now(),
    };

    if (completed) {
      updateData.onboarding_completed_at = knex.fn.now();
    }

    if (wizardData) {
      updateData.onboarding_data = JSON.stringify(wizardData);
    }

    // Upsert the tenant settings
    await knex('tenant_settings')
      .insert({
        tenant,
        ...updateData,
      })
      .onConflict('tenant')
      .merge(updateData);

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

    // Check if user has admin permissions
    const user = await getCurrentUser();
    if (!user || !user.roles.some((role: any) => role.role_name === 'admin')) {
      throw new Error('Only admin users can save onboarding progress');
    }

    // Get existing data to merge with
    const existingSettings = await getTenantSettings();
    const existingData = existingSettings?.onboarding_data || {};

    const mergedData = {
      ...existingData,
      ...wizardData,
    };

    const { knex } = await createTenantKnex();
    
    await knex('tenant_settings')
      .insert({
        tenant,
        onboarding_data: JSON.stringify(mergedData),
        updated_at: knex.fn.now(),
      })
      .onConflict('tenant')
      .merge({
        onboarding_data: JSON.stringify(mergedData),
        updated_at: knex.fn.now(),
      });

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
    
    await knex('tenant_settings')
      .where({ tenant })
      .update({
        onboarding_data: null,
        updated_at: knex.fn.now(),
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
    
    await knex('tenant_settings')
      .insert({
        tenant,
        settings: JSON.stringify(updatedSettings),
        updated_at: knex.fn.now(),
      })
      .onConflict('tenant')
      .merge({
        settings: JSON.stringify(updatedSettings),
        updated_at: knex.fn.now(),
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