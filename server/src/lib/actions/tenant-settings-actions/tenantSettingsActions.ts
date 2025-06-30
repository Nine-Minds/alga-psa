'use server';

import { getAuthenticatedUser } from '@/lib/actions/user-actions/userActions';
import { getTenantForCurrentRequest } from '@/lib/tenant';
import { knexClient } from '@/lib/db';
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

    const settings = await knexClient
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
    const user = await getAuthenticatedUser();
    if (!user || !user.roles.some(role => role.role_name === 'admin')) {
      throw new Error('Only admin users can update onboarding status');
    }

    const updateData: any = {
      onboarding_completed: completed,
      onboarding_skipped: skipped,
      updated_at: knexClient.fn.now(),
    };

    if (completed) {
      updateData.onboarding_completed_at = knexClient.fn.now();
    }

    if (wizardData) {
      updateData.onboarding_data = JSON.stringify(wizardData);
    }

    // Upsert the tenant settings
    await knexClient('tenant_settings')
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
    const user = await getAuthenticatedUser();
    if (!user || !user.roles.some(role => role.role_name === 'admin')) {
      throw new Error('Only admin users can save onboarding progress');
    }

    // Get existing data to merge with
    const existingSettings = await getTenantSettings();
    const existingData = existingSettings?.onboarding_data || {};

    const mergedData = {
      ...existingData,
      ...wizardData,
    };

    await knexClient('tenant_settings')
      .insert({
        tenant,
        onboarding_data: JSON.stringify(mergedData),
        updated_at: knexClient.fn.now(),
      })
      .onConflict('tenant')
      .merge({
        onboarding_data: JSON.stringify(mergedData),
        updated_at: knexClient.fn.now(),
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
    const user = await getAuthenticatedUser();
    if (!user || !user.roles.some(role => role.role_name === 'admin')) {
      throw new Error('Only admin users can clear onboarding data');
    }

    await knexClient('tenant_settings')
      .where({ tenant })
      .update({
        onboarding_data: null,
        updated_at: knexClient.fn.now(),
      });

  } catch (error) {
    console.error('Error clearing tenant onboarding data:', error);
    throw error;
  }
}