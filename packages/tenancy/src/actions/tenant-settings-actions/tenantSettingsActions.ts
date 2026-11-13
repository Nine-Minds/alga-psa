'use server';

import { getCurrentUserPermissions } from '@alga-psa/user-composition/actions/userQueryActions';
import { withAuth, hasPermission, type AuthContext } from '@alga-psa/auth';
import { featureFlags } from '@alga-psa/core/server';
import { validateStorableTimeZone } from '@alga-psa/core/timeZones';
import type { IUserWithRoles } from '@alga-psa/types';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import type { WizardData } from '@alga-psa/types';
import type { Knex } from 'knex';
import { persistTenantOnboardingProgress } from '../../server/onboardingProgress';
import { mergeTenantSettingsJson, readTenantSettingsJson, readTenantSettingsRow } from '../../server/tenantSettingsStore';
import { isLicensedUserType } from '@alga-psa/types';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

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

export type TenantSettingsActionError = ActionMessageError | ActionPermissionError;

function tenantSettingsActionErrorFrom(error: unknown): TenantSettingsActionError | null {
  if (error instanceof Error) {
    const message = error.message;
    if (message.startsWith('Permission denied') || message === 'user is not logged in') {
      return permissionError(message);
    }
    if (message === 'Only admin users can clear onboarding data') {
      return permissionError('Permission denied: Only admin users can clear onboarding data.', 'msp/settings:errors.tenantSettings.permissions.clearOnboarding');
    }
    if (message === 'tenantId is required') {
      return actionError('Tenant id is required.', 'msp/settings:errors.tenantSettings.tenantIdRequired');
    }
    if (message.startsWith('Invalid timezone:')) {
      return actionError(message);
    }
  }

  const dbError = error as { code?: string; column?: string };
  if (dbError?.code === '22P02') {
    return actionError('One of the selected tenant setting values is invalid. Please refresh and try again.', 'msp/settings:errors.tenantSettings.invalidValue');
  }
  if (dbError?.code === '23502') {
    return dbError.column
      ? actionError(
          `Missing required tenant settings field: ${dbError.column}.`,
          'msp/settings:errors.tenantSettings.missingFieldNamed',
          { field: dbError.column },
        )
      : actionError('Missing required tenant settings field.', 'msp/settings:errors.tenantSettings.missingField');
  }

  return null;
}

const DEFAULT_EXPERIMENTAL_FEATURES: ExperimentalFeatures = {
  aiAssistant: false,
};

const AI_ASSISTANT_ACTIVATION_FLAG = 'ai-assistant-activation';
const WIZARD_DATA_KEYS = new Set([
  'firstName', 'lastName', 'tenantName', 'email', 'newPassword', 'confirmPassword', 'locale',
  'companyLocationId', 'companyAddressLine1', 'companyAddressLine2', 'companyCity', 'companyStateProvince',
  'companyPostalCode', 'companyCountryCode', 'companyCountryName', 'teamMembers', 'createdTeamMemberEmails',
  'invitedTeamMemberEmails', 'clientName', 'clientEmail', 'clientPhone', 'clientUrl', 'clientId',
  'contactName', 'contactEmail', 'contactRole', 'contactId', 'serviceName', 'serviceDescription',
  'servicePrice', 'serviceBillingMode', 'contractLineName', 'serviceTypeId', 'serviceId', 'currencyCode',
  'boardName', 'supportEmail', 'categories', 'priorities', 'ticketPrefix', 'ticketPaddingLength',
  'ticketStartNumber', 'boardId', 'statusesImported', 'statuses', 'is_itil_compliant',
  'importBoardItilSettings', 'currentStep',
]);

function isWizardDataPatch(value: unknown): value is Partial<WizardData> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every((key) => WIZARD_DATA_KEYS.has(key));
}

const tenantSettingsQuery = (knex: Knex, tenant: string) =>
  tenantDb(knex, tenant).table('tenant_settings');

function normalizeExperimentalFeatures(value: unknown): ExperimentalFeatures {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_EXPERIMENTAL_FEATURES };
  }

  const record = value as Record<string, unknown>;
  return {
    aiAssistant: record.aiAssistant === true,
  };
}

const getTenantSettingsForTenant = (tenant: string): Promise<TenantSettings | null> => readTenantSettingsRow(tenant);

async function canTenantActivateAiAssistant(
  tenant: string,
  user?: Pick<IUserWithRoles, 'user_id' | 'user_type'>
): Promise<boolean> {
  return featureFlags.isEnabled(AI_ASSISTANT_ACTIVATION_FLAG, {
    tenantId: tenant,
    userId: user?.user_id,
  });
}

export const getTenantSettings = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext
): Promise<TenantSettings | null> => {
  if (!isLicensedUserType(user.user_type)) throw new Error('Permission denied: Internal user required');
  const canRead = await hasPermission(user, 'settings', 'read');
  const canRunSetup = await hasPermission(user, 'settings', 'update');
  if (!canRead && !canRunSetup) throw new Error('Permission denied: Cannot read tenant settings');
  return getTenantSettingsForTenant(tenant);
});
export const getExperimentalFeaturesForTenant = async (
  tenant: string,
  user?: Pick<IUserWithRoles, 'user_id' | 'user_type'>
): Promise<ExperimentalFeatures> => {
  const settings = await getTenantSettingsForTenant(tenant);
  const features = normalizeExperimentalFeatures(settings?.settings?.experimentalFeatures);
  if (!(await canTenantActivateAiAssistant(tenant, user))) {
    features.aiAssistant = false;
  }

  return features;
};

export const getExperimentalFeatures = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext
): Promise<ExperimentalFeatures> => {
  return getExperimentalFeaturesForTenant(tenant, user);
});

export const canEnableAiAssistant = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext
): Promise<boolean> => {
  return canTenantActivateAiAssistant(tenant, user);
});

export const updateExperimentalFeatures = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext,
  features: Partial<ExperimentalFeatures>
): Promise<void | TenantSettingsActionError> => {
  try {
    if (!isLicensedUserType(user.user_type) || !features || typeof features !== 'object' || Array.isArray(features) ||
      Object.keys(features).some((key) => key !== 'aiAssistant') ||
      (features.aiAssistant !== undefined && typeof features.aiAssistant !== 'boolean')) {
      return actionError('Invalid experimental feature settings.');
    }
    const permissions = await getCurrentUserPermissions();
    if (!permissions.includes('settings:update')) {
      return permissionError('Permission denied: Cannot update settings', 'msp/settings:errors.tenantSettings.permissions.update');
    }

    if (features.aiAssistant === true && !(await canTenantActivateAiAssistant(tenant, user))) {
      return permissionError('Permission denied: Cannot enable AI Assistant for this tenant', 'msp/settings:errors.tenantSettings.permissions.enableAiAssistant');
    }

    const current = await getExperimentalFeaturesForTenant(tenant, user);
    const merged: ExperimentalFeatures = {
      ...current,
      ...features,
    };

    await mergeTenantSettingsJson(tenant, { experimentalFeatures: merged });
  } catch (error) {
    console.error('Error updating experimental features:', error);
    const expected = tenantSettingsActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

export const isExperimentalFeatureEnabled = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext,
  featureKey: string
): Promise<boolean> => {
  const features = await getExperimentalFeaturesForTenant(tenant, user);
  return (features as unknown as Record<string, unknown>)[featureKey] === true;
});

export const updateTenantOnboardingStatus = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext,
  completed: boolean,
  wizardData?: WizardData,
  skipped: boolean = false
): Promise<void> => {
  if (!isLicensedUserType(user.user_type) || !(await hasPermission(user, 'settings', 'update'))) throw new Error('Permission denied: Workspace setup access required');
  if (typeof completed !== 'boolean' || typeof skipped !== 'boolean' || (wizardData !== undefined && !isWizardDataPatch(wizardData))) {
    throw new Error('Invalid tenant onboarding update.');
  }
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
    const existingSettings = await tenantSettingsQuery(knex, tenant)
      .first();

    if (existingSettings) {
      // Update existing settings
      await tenantSettingsQuery(knex, tenant)
        .update(updateData);
    } else {
      // Insert new settings
      await tenantSettingsQuery(knex, tenant)
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
  user: IUserWithRoles,
  { tenant }: AuthContext,
  wizardData: Partial<WizardData>
): Promise<void> => {
  if (!isLicensedUserType(user.user_type) || !(await hasPermission(user, 'settings', 'update'))) throw new Error('Permission denied: Workspace setup access required');
  if (!isWizardDataPatch(wizardData)) throw new Error('Invalid tenant onboarding progress.');
  try {
    const { knex } = await createTenantKnex();
    await persistTenantOnboardingProgress(knex, tenant, wizardData);
  } catch (error) {
    console.error('Error saving tenant onboarding progress:', error);
    throw error;
  }
});

export const clearTenantOnboardingData = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext
): Promise<void | TenantSettingsActionError> => {
  try {
    // Check if user has admin permissions
    if (!isLicensedUserType(user.user_type) || !(await hasPermission(user, 'settings', 'update')) || !user.roles.some((role: any) => role.role_name === 'admin')) {
      return permissionError('Permission denied: Only admin users can clear onboarding data.', 'msp/settings:errors.tenantSettings.permissions.clearOnboarding');
    }

    const { knex } = await createTenantKnex();

    // Use a literal timestamp for Citus compatibility
    const now = new Date();

    await tenantSettingsQuery(knex, tenant)
      .update({
        onboarding_data: null,
        updated_at: now,
      });

  } catch (error) {
    console.error('Error clearing tenant onboarding data:', error);
    const expected = tenantSettingsActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

export const getTenantAnalyticsSettings = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext
): Promise<any> => {
  if (!isLicensedUserType(user.user_type) || !(await hasPermission(user, 'settings', 'read'))) throw new Error('Permission denied: Cannot read tenant analytics settings');
  const settings = await getTenantSettingsForTenant(tenant);
  return settings?.settings?.analytics || null;
});

/**
 * Get tenant timezone (authenticated, for UI).
 */
export const getTenantTimezoneAuth = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext
): Promise<string | null> => {
  if (!isLicensedUserType(user.user_type) || (!(await hasPermission(user, 'settings', 'read')) && !(await hasPermission(user, 'settings', 'update')))) {
    throw new Error('Permission denied: Cannot read tenant timezone');
  }
  const settings = await readTenantSettingsJson(tenant);
  const timezone = settings.timezone;
  return typeof timezone === 'string' && timezone.length > 0 ? timezone : null;
});

/**
 * Set tenant timezone (authenticated, requires settings:update permission).
 */
export const setTenantTimezone = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext,
  timezone: string
): Promise<void | TenantSettingsActionError> => {
  if (!isLicensedUserType(user.user_type) || !(await hasPermission(user, 'settings', 'update'))) {
    return permissionError('Permission denied: Cannot update settings', 'msp/settings:errors.tenantSettings.permissions.update');
  }
  if (typeof timezone !== 'string') return actionError('Invalid timezone value.');
  // Tenant timezone saves are always explicit, so always validate. UTC aliases
  // come back mapped to "UTC"; non-city IDs (EST, Etc/GMT+5, US/Eastern) are rejected.
  // Both failures are returned as action errors with a messageKey, so they never
  // reach the thrown-error 'Invalid timezone:' prefix mapping in tenantSettingsActionErrorFrom.
  const validation = validateStorableTimeZone(timezone);
  if (validation.ok === false) {
    return validation.reason === 'not_location'
      ? actionError(
          `${timezone} isn't a city-based time zone. Choose a zone such as America/New_York.`,
          'msp/settings:errors.tenantSettings.nonLocationTimezone',
          { timezone },
        )
      : actionError(`Invalid timezone: ${timezone}`, 'msp/settings:errors.tenantSettings.invalidTimezone', { timezone });
  }
  if (!validation.timeZone) {
    // An empty value is not a timezone to store at the tenant level.
    return actionError(`Invalid timezone: ${timezone}`, 'msp/settings:errors.tenantSettings.invalidTimezone', { timezone });
  }
  return mergeTenantSettingsJson(tenant, { timezone: validation.timeZone });
});
