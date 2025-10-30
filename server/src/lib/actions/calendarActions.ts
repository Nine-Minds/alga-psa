'use server'

import { getCurrentUser } from '../user-actions/userActions';
import { getSecretProviderInstance } from '@alga-psa/shared/core';
import { hasPermission } from '../../auth/rbac';
import { createTenantKnex } from '../../db';
import { generateGoogleCalendarAuthUrl, generateMicrosoftCalendarAuthUrl, generateCalendarNonce } from '@/utils/calendar/oauthHelpers';
import { CalendarProviderService } from '@/services/calendar/CalendarProviderService';
import { CalendarSyncService } from '@/services/calendar/CalendarSyncService';
import { CalendarProviderConfig, CalendarSyncStatus, CalendarConflictResolution } from '@/interfaces/calendar.interfaces';
import { IScheduleEntry } from '@/interfaces/schedule.interfaces';

/**
 * Initiate OAuth flow for calendar provider
 */
export async function initiateCalendarOAuth(params: {
  provider: 'google' | 'microsoft';
  calendarProviderId?: string;
  redirectUri?: string;
}): Promise<{ success: true; authUrl: string; state: string } | { success: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: 'Unauthorized' };

  try {
    // RBAC: validate permission
    const isUpdate = !!params.calendarProviderId;
    const resource = 'system_settings';
    const action = isUpdate ? 'update' : 'create';
    const permitted = await hasPermission(user as any, resource, action);
    if (!permitted) {
      return { success: false, error: 'Forbidden: insufficient permissions' };
    }

    // If calendarProviderId is specified, ensure it belongs to the caller's tenant
    if (params.calendarProviderId) {
      const { knex, tenant } = await createTenantKnex();
      const exists = await knex('calendar_providers')
        .where({ id: params.calendarProviderId, tenant })
        .first();
      if (!exists) {
        return { success: false, error: 'Invalid calendarProviderId for tenant' };
      }
    }

    const { provider, calendarProviderId, redirectUri } = params;
    const secretProvider = await getSecretProviderInstance();

    // Hosted detection
    const nextauthUrl = process.env.NEXTAUTH_URL || (await secretProvider.getAppSecret('NEXTAUTH_URL')) || '';
    const isHosted = nextauthUrl.startsWith('https://algapsa.com');

    let clientId: string | null = null;
    let effectiveRedirectUri = redirectUri || '';

    if (isHosted) {
      if (provider === 'google') {
        clientId = (await secretProvider.getAppSecret('GOOGLE_CLIENT_ID')) || null;
        effectiveRedirectUri = effectiveRedirectUri || (await secretProvider.getAppSecret('GOOGLE_REDIRECT_URI')) || 'https://api.algapsa.com/api/auth/google/calendar/callback';
      } else {
        clientId = (await secretProvider.getAppSecret('MICROSOFT_CLIENT_ID')) || null;
        effectiveRedirectUri = effectiveRedirectUri || (await secretProvider.getAppSecret('MICROSOFT_REDIRECT_URI')) || 'https://api.algapsa.com/api/auth/microsoft/calendar/callback';
      }
    } else {
      if (provider === 'google') {
        clientId = process.env.GOOGLE_CLIENT_ID || (await secretProvider.getTenantSecret(user.tenant, 'google_client_id')) || null;
      } else {
        clientId = process.env.MICROSOFT_CLIENT_ID || (await secretProvider.getTenantSecret(user.tenant, 'microsoft_client_id')) || null;
      }
      if (!effectiveRedirectUri) {
        const base = process.env.NEXT_PUBLIC_BASE_URL || (await secretProvider.getAppSecret('NEXT_PUBLIC_BASE_URL')) || 'http://localhost:3000';
        effectiveRedirectUri = `${base}/api/auth/${provider}/calendar/callback`;
      }
    }

    if (!clientId) {
      return { success: false, error: `${provider} OAuth client ID not configured` };
    }

    const state = {
      tenant: user.tenant,
      provider,
      calendarProviderId,
      nonce: generateCalendarNonce(),
      redirectUri: effectiveRedirectUri
    };

    // Determine Microsoft tenant authority
    let msTenantAuthority: string | undefined;
    if (provider === 'microsoft') {
      msTenantAuthority = process.env.MICROSOFT_TENANT_ID
        || (await secretProvider.getAppSecret('MICROSOFT_TENANT_ID'))
        || (await secretProvider.getTenantSecret(user.tenant, 'microsoft_tenant_id'))
        || 'common';
    }

    const authUrl = provider === 'microsoft'
      ? generateMicrosoftCalendarAuthUrl(clientId, state.redirectUri, state, undefined as any, msTenantAuthority)
      : generateGoogleCalendarAuthUrl(clientId, state.redirectUri, state);

    return { 
      success: true, 
      authUrl, 
      state: Buffer.from(JSON.stringify(state)).toString('base64') 
    };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to initiate OAuth' };
  }
}

/**
 * Get calendar providers for current tenant
 */
export async function getCalendarProviders(): Promise<{
  success: boolean;
  providers?: CalendarProviderConfig[];
  error?: string;
}> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { success: false, error: 'Unauthorized' };
    }

    const providerService = new CalendarProviderService();
    const providers = await providerService.getProviders({
      tenant: user.tenant
    });

    return { success: true, providers };
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to fetch calendar providers' };
  }
}

/**
 * Create calendar provider
 */
export async function createCalendarProvider(params: {
  providerType: 'google' | 'microsoft';
  providerName: string;
  calendarId: string;
  syncDirection: 'bidirectional' | 'to_external' | 'from_external';
  vendorConfig: any;
}): Promise<{
  success: boolean;
  provider?: CalendarProviderConfig;
  error?: string;
}> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { success: false, error: 'Unauthorized' };
    }

    const permitted = await hasPermission(user as any, 'system_settings', 'create');
    if (!permitted) {
      return { success: false, error: 'Forbidden: insufficient permissions' };
    }

    const providerService = new CalendarProviderService();
    const provider = await providerService.createProvider({
      tenant: user.tenant,
      providerType: params.providerType,
      providerName: params.providerName,
      calendarId: params.calendarId,
      isActive: true,
      syncDirection: params.syncDirection,
      vendorConfig: params.vendorConfig
    });

    return { success: true, provider };
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to create calendar provider' };
  }
}

/**
 * Update calendar provider
 */
export async function updateCalendarProvider(
  calendarProviderId: string,
  params: {
    providerName?: string;
    calendarId?: string;
    syncDirection?: 'bidirectional' | 'to_external' | 'from_external';
    isActive?: boolean;
    vendorConfig?: any;
  }
): Promise<{
  success: boolean;
  provider?: CalendarProviderConfig;
  error?: string;
}> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { success: false, error: 'Unauthorized' };
    }

    const permitted = await hasPermission(user as any, 'system_settings', 'update');
    if (!permitted) {
      return { success: false, error: 'Forbidden: insufficient permissions' };
    }

    const providerService = new CalendarProviderService();
    const provider = await providerService.updateProvider(calendarProviderId, params);

    return { success: true, provider };
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to update calendar provider' };
  }
}

/**
 * Delete calendar provider
 */
export async function deleteCalendarProvider(
  calendarProviderId: string
): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { success: false, error: 'Unauthorized' };
    }

    const permitted = await hasPermission(user as any, 'system_settings', 'delete');
    if (!permitted) {
      return { success: false, error: 'Forbidden: insufficient permissions' };
    }

    const providerService = new CalendarProviderService();
    await providerService.deleteProvider(calendarProviderId);

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to delete calendar provider' };
  }
}

/**
 * Sync schedule entry to external calendar
 */
export async function syncScheduleEntryToCalendar(
  entryId: string,
  calendarProviderId: string
): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { success: false, error: 'Unauthorized' };
    }

    const syncService = new CalendarSyncService();
    const result = await syncService.syncScheduleEntryToExternal(entryId, calendarProviderId);

    return result;
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to sync schedule entry' };
  }
}

/**
 * Sync external calendar event to schedule entry
 */
export async function syncExternalEventToSchedule(
  externalEventId: string,
  calendarProviderId: string
): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { success: false, error: 'Unauthorized' };
    }

    const syncService = new CalendarSyncService();
    const result = await syncService.syncExternalEventToSchedule(externalEventId, calendarProviderId);

    return result;
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to sync external event' };
  }
}

/**
 * Resolve calendar sync conflict
 */
export async function resolveCalendarConflict(
  resolution: CalendarConflictResolution
): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { success: false, error: 'Unauthorized' };
    }

    const syncService = new CalendarSyncService();
    const result = await syncService.resolveConflict(
      resolution.mappingId,
      resolution.resolution,
      resolution.mergeData
    );

    return result;
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to resolve conflict' };
  }
}

/**
 * Get sync status for a schedule entry
 */
export async function getScheduleEntrySyncStatus(
  entryId: string
): Promise<{
  success: boolean;
  status?: CalendarSyncStatus[];
  error?: string;
}> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { success: false, error: 'Unauthorized' };
    }

    const { knex, tenant } = await createTenantKnex();
    
    // Get all mappings for this entry
    const mappings = await knex('calendar_event_mappings')
      .where('schedule_entry_id', entryId)
      .andWhere('tenant', tenant)
      .select('*');

    // Get providers for each mapping
    const providerService = new CalendarProviderService();
    const statuses: CalendarSyncStatus[] = [];

    for (const mapping of mappings) {
      const provider = await providerService.getProvider(mapping.calendar_provider_id);
      if (provider) {
        statuses.push({
          providerId: provider.id,
          providerName: provider.name,
          providerType: provider.provider_type,
          isActive: provider.active,
          lastSyncAt: mapping.last_synced_at,
          syncDirection: provider.sync_direction,
          errorMessage: mapping.sync_error_message,
          entrySyncStatus: {
            entryId: mapping.schedule_entry_id,
            syncStatus: mapping.sync_status,
            externalEventId: mapping.external_event_id
          }
        });
      }
    }

    return { success: true, status: statuses };
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to get sync status' };
  }
}

/**
 * Manual sync trigger for a calendar provider
 */
export async function syncCalendarProvider(
  calendarProviderId: string
): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { success: false, error: 'Unauthorized' };
    }

    const permitted = await hasPermission(user as any, 'system_settings', 'update');
    if (!permitted) {
      return { success: false, error: 'Forbidden: insufficient permissions' };
    }

    const providerService = new CalendarProviderService();
    const provider = await providerService.getProvider(calendarProviderId);
    
    if (!provider) {
      return { success: false, error: 'Calendar provider not found' };
    }

    // TODO: Implement full sync logic
    // This would sync all schedule entries to/from the external calendar
    // For now, just return success
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to sync calendar provider' };
  }
}

