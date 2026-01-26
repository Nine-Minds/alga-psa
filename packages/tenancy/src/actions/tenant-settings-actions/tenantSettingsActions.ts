'use server';

import { getCurrentUserPermissions } from '@alga-psa/users/actions';
import { withAuth, type AuthContext } from '@alga-psa/auth';
import type { IUserWithRoles } from '@alga-psa/types';
import { createTenantKnex } from '@alga-psa/db';
import type { WizardData } from '@alga-psa/types';

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

export interface ExperimentalFeatures {
  aiAssistant: boolean;
}

const DEFAULT_EXPERIMENTAL_FEATURES: ExperimentalFeatures = {
  aiAssistant: false,
};

function normalizeExperimentalFeatures(value: unknown): ExperimentalFeatures {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_EXPERIMENTAL_FEATURES };
  }

  const record = value as Record<string, unknown>;
  return {
    aiAssistant: record.aiAssistant === true,
  };
}

const getTenantSettingsForTenant = async (tenant: string): Promise<TenantSettings | null> => {
  const { knex } = await createTenantKnex(tenant);
  const settings = await knex
    .select('*')
    .from('tenant_settings')
    .where({ tenant })
    .first();

  return settings || null;
};

export const getTenantSettings = withAuth(async (
  _user: IUserWithRoles,
  { tenant }: AuthContext
): Promise<TenantSettings | null> => {
  return getTenantSettingsForTenant(tenant);
});

export async function getTenantSettingsByTenantId(tenantId: string): Promise<TenantSettings | null> {
  if (!tenantId) {
    throw new Error('tenantId is required');
  }
  return getTenantSettingsForTenant(tenantId);
}

const getExperimentalFeaturesForTenant = async (tenant: string): Promise<ExperimentalFeatures> => {
  const settings = await getTenantSettingsForTenant(tenant);
  return normalizeExperimentalFeatures(settings?.settings?.experimentalFeatures);
};

export const getExperimentalFeatures = withAuth(async (
  _user: IUserWithRoles,
  { tenant }: AuthContext
): Promise<ExperimentalFeatures> => {
  return getExperimentalFeaturesForTenant(tenant);
});

export const updateExperimentalFeatures = withAuth(async (
  _user: IUserWithRoles,
  { tenant }: AuthContext,
  features: Partial<ExperimentalFeatures>
): Promise<void> => {
  try {
    const permissions = await getCurrentUserPermissions();
    if (!permissions.includes('settings:update')) {
      throw new Error('Permission denied: Cannot update settings');
    }

    const current = await getExperimentalFeaturesForTenant(tenant);
    const merged: ExperimentalFeatures = {
      ...current,
      ...features,
    };

    await updateTenantSettings({
      experimentalFeatures: merged,
    });
  } catch (error) {
    console.error('Error updating experimental features:', error);
    throw error;
  }
});

export const isExperimentalFeatureEnabled = withAuth(async (
  _user: IUserWithRoles,
  { tenant }: AuthContext,
  featureKey: string
): Promise<boolean> => {
  const features = await getExperimentalFeaturesForTenant(tenant);
  return (features as unknown as Record<string, unknown>)[featureKey] === true;
});

export const updateTenantOnboardingStatus = withAuth(async (
  _user: IUserWithRoles,
  { tenant }: AuthContext,
  completed: boolean,
  wizardData?: WizardData,
  skipped: boolean = false
): Promise<void> => {
  try {
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
});

export const saveTenantOnboardingProgress = withAuth(async (
  _user: IUserWithRoles,
  { tenant }: AuthContext,
  wizardData: Partial<WizardData>
): Promise<void> => {
  try {
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
});

export const clearTenantOnboardingData = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext
): Promise<void> => {
  try {
    // Check if user has admin permissions
    if (!user.roles.some((role: any) => role.role_name === 'admin')) {
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
});

const normalizeSettingsRecord = (value: unknown): Record<string, any> => {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, any>) : {};
    } catch {
      return {};
    }
  }
  return typeof value === 'object' ? (value as Record<string, any>) : {};
};

const getCurrentTenantSettingsJson = async (tenant: string): Promise<Record<string, any>> => {
  const { knex } = await createTenantKnex(tenant);
  const row = await knex
    .select('settings')
    .from('tenant_settings')
    .where({ tenant })
    .first();
  return normalizeSettingsRecord(row?.settings);
};

const upsertTenantSettingsJson = async (tenant: string, updatedSettings: Record<string, any>): Promise<void> => {
  const { knex } = await createTenantKnex(tenant);
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
};

const updateTenantSettingsInternal = withAuth(async (
  _user: IUserWithRoles,
  { tenant }: AuthContext,
  settings: Record<string, any>
): Promise<void> => {
  try {
    const currentSettings = await getCurrentTenantSettingsJson(tenant);
    const updatedSettings = {
      ...currentSettings,
      ...settings,
    };

    await upsertTenantSettingsJson(tenant, updatedSettings);
  } catch (error) {
    console.error('Error updating tenant settings:', error);
    throw error;
  }
});

const updateTenantAnalyticsSettingsInternal = withAuth(async (
  _user: IUserWithRoles,
  { tenant }: AuthContext,
  analyticsSettings: Record<string, any>
): Promise<void> => {
  try {
    const currentSettings = await getCurrentTenantSettingsJson(tenant);
    const currentAnalytics = normalizeSettingsRecord(currentSettings.analytics);
    const updatedSettings = {
      ...currentSettings,
      analytics: {
        ...currentAnalytics,
        ...analyticsSettings,
        last_updated_at: new Date().toISOString(),
      },
    };

    await upsertTenantSettingsJson(tenant, updatedSettings);
  } catch (error) {
    console.error('Error updating tenant analytics settings:', error);
    throw error;
  }
});

export async function updateTenantSettings(
  settings: Record<string, any>
): Promise<void> {
  return updateTenantSettingsInternal(settings);
}

export const getTenantAnalyticsSettings = withAuth(async (
  _user: IUserWithRoles,
  { tenant }: AuthContext
): Promise<any> => {
  const settings = await getTenantSettingsForTenant(tenant);
  return settings?.settings?.analytics || null;
});

export async function updateTenantAnalyticsSettings(
  analyticsSettings: Record<string, any>
): Promise<void> {
  return updateTenantAnalyticsSettingsInternal(analyticsSettings);
}

export async function initializeTenantSettings(tenantId: string): Promise<void> {
  try {
    const { knex } = await createTenantKnex(tenantId);
    
    // Use a literal timestamp for Citus compatibility
    const now = new Date();
    
    // Initialize tenant settings with both onboarding flags set to false
    await knex('tenant_settings')
      .insert({
        tenant: tenantId,
        onboarding_completed: false,
        onboarding_skipped: false,
        onboarding_data: null,
        settings: JSON.stringify({
          experimentalFeatures: DEFAULT_EXPERIMENTAL_FEATURES,
        }),
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
