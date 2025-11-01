'use server'

import { getCurrentUser } from '../user-actions/userActions';
import { getSecretProviderInstance } from '@alga-psa/shared/core';
import { hasPermission } from '../../auth/rbac';
import { createTenantKnex, runWithTenant } from '../../db';
import { generateGoogleCalendarAuthUrl, generateMicrosoftCalendarAuthUrl, generateCalendarNonce, encodeCalendarState } from '@/utils/calendar/oauthHelpers';
import { resolveCalendarRedirectUri } from '@/utils/calendar/redirectUri';
import { storeCalendarOAuthState } from '@/utils/calendar/oauthStateStore';
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

    const { provider, calendarProviderId, redirectUri: requestedRedirectUri } = params;
    const secretProvider = await getSecretProviderInstance();
    const tenant = user.tenant;

    // Hosted detection
    const nextauthUrl = process.env.NEXTAUTH_URL || (await secretProvider.getAppSecret('NEXTAUTH_URL')) || '';
    const isHostedFlow = nextauthUrl.startsWith('https://algapsa.com');

    let existingRedirectUri: string | undefined;
    if (calendarProviderId) {
      const providerService = new CalendarProviderService();
      const providerRecord = await providerService.getProvider(calendarProviderId, tenant, { includeSecrets: true });
      if (!providerRecord) {
        return { success: false, error: 'Invalid calendarProviderId for tenant' };
      }
      existingRedirectUri = providerRecord.provider_config?.redirectUri;
    }

    let clientId: string | null = null;

    if (isHostedFlow) {
      if (provider === 'google') {
        clientId = (await secretProvider.getAppSecret('GOOGLE_CALENDAR_CLIENT_ID')) || null;
      } else {
        clientId = (await secretProvider.getAppSecret('MICROSOFT_CLIENT_ID')) || null;
      }
    } else {
      if (provider === 'google') {
        clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID
          || (await secretProvider.getTenantSecret(tenant, 'google_calendar_client_id'))
          || null;
      } else {
        clientId = process.env.MICROSOFT_CLIENT_ID
          || (await secretProvider.getTenantSecret(tenant, 'microsoft_client_id'))
          || null;
      }
    }

    if (!clientId) {
      return { success: false, error: `${provider} OAuth client ID not configured` };
    }

    const redirectUri = await resolveCalendarRedirectUri({
      tenant,
      provider,
      secretProvider,
      hosted: isHostedFlow,
      requestedRedirectUri,
      existingRedirectUri
    });

    const state = {
      tenant,
      provider,
      calendarProviderId,
      nonce: generateCalendarNonce(),
      redirectUri,
      timestamp: Date.now(),
      hosted: isHostedFlow
    };
    const encodedState = encodeCalendarState(state);

    // Determine Microsoft tenant authority
    let msTenantAuthority: string | undefined;
    if (provider === 'microsoft') {
      msTenantAuthority = process.env.MICROSOFT_TENANT_ID
        || (await secretProvider.getAppSecret('MICROSOFT_TENANT_ID'))
        || (await secretProvider.getTenantSecret(user.tenant, 'microsoft_tenant_id'))
        || 'common';
    }

    const authUrl = provider === 'microsoft'
      ? await generateMicrosoftCalendarAuthUrl({
          clientId,
          redirectUri: state.redirectUri,
          state: encodedState,
          tenantId: msTenantAuthority
        })
      : await generateGoogleCalendarAuthUrl({
          clientId,
          redirectUri: state.redirectUri,
          state: encodedState
        });

    await storeCalendarOAuthState(state.nonce, state, 10 * 60);

    return { 
      success: true, 
      authUrl, 
      state: encodedState 
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
    const provider = await providerService.updateProvider(calendarProviderId, user.tenant, params);

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
    await providerService.deleteProvider(calendarProviderId, user.tenant);

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
    if (!tenant) {
      return { success: false, error: 'Tenant context unavailable' };
    }
    
    // Get all mappings for this entry
    const mappings = await knex('calendar_event_mappings')
      .where('schedule_entry_id', entryId)
      .andWhere('tenant', tenant)
      .select('*');

    // Get providers for each mapping
    const providerService = new CalendarProviderService();
    const statuses: CalendarSyncStatus[] = [];

    for (const mapping of mappings) {
      const provider = await providerService.getProvider(
        mapping.calendar_provider_id,
        tenant,
        { includeSecrets: false }
      );
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
    const provider = await providerService.getProvider(calendarProviderId, user.tenant);

    if (!provider) {
      return { success: false, error: 'Calendar provider not found' };
    }

    const syncService = new CalendarSyncService();
    const failures: string[] = [];
    let pushed = 0;
    let pulled = 0;

    const allowPush = provider.sync_direction === 'bidirectional' || provider.sync_direction === 'to_external';
    const allowPull = provider.sync_direction === 'bidirectional' || provider.sync_direction === 'from_external';

    await runWithTenant(user.tenant, async () => {
      const { knex } = await createTenantKnex();

      const mappings = await knex('calendar_event_mappings')
        .where('tenant', user.tenant)
        .andWhere('calendar_provider_id', calendarProviderId)
        .select('schedule_entry_id', 'external_event_id');

      for (const mapping of mappings) {
        if (allowPush) {
          const result = await syncService.syncScheduleEntryToExternal(mapping.schedule_entry_id, calendarProviderId, true);
          if (result.success) {
            pushed += 1;
          } else {
            failures.push(`Push ${mapping.schedule_entry_id}: ${result.error || 'unknown error'}`);
          }
        }

        if (allowPull) {
          const result = await syncService.syncExternalEventToSchedule(mapping.external_event_id, calendarProviderId, true);
          if (result.success) {
            pulled += 1;
          } else {
            failures.push(`Pull ${mapping.external_event_id}: ${result.error || 'unknown error'}`);
          }
        }
      }

      if (allowPush) {
        const recentEntriesQuery = knex('schedule_entries')
          .where('schedule_entries.tenant', user.tenant)
          .modify((builder) => {
            if (provider.last_sync_at) {
              builder.andWhere('schedule_entries.updated_at', '>', provider.last_sync_at);
            }
          })
          .leftJoin('calendar_event_mappings as cem', function () {
            this.on('cem.schedule_entry_id', '=', 'schedule_entries.entry_id')
              .andOn('cem.tenant', '=', 'schedule_entries.tenant')
              .andOn('cem.calendar_provider_id', '=', knex.raw('?', [calendarProviderId]));
          })
          .whereNull('cem.id')
          .limit(50)
          .select('schedule_entries.entry_id as entry_id');

        const recentEntries = await recentEntriesQuery;

        for (const entry of recentEntries) {
          const result = await syncService.syncScheduleEntryToExternal(entry.entry_id, calendarProviderId, true);
          if (result.success) {
            pushed += 1;
          } else {
            failures.push(`Push ${entry.entry_id}: ${result.error || 'unknown error'}`);
          }
        }
      }
    });

    if (failures.length === 0) {
      await providerService.updateProviderStatus(calendarProviderId, {
        status: 'connected',
        lastSyncAt: new Date().toISOString(),
        errorMessage: null
      });
      return { success: true };
    }

    const summary = `Manual sync completed with ${failures.length} issue(s). Pushed=${pushed}, Pulled=${pulled}.`;
    await providerService.updateProviderStatus(calendarProviderId, {
      status: 'error',
      errorMessage: `${summary} Details: ${failures.join('; ').slice(0, 500)}`
    });

    return { success: false, error: summary };
  } catch (error: any) {
    const message = error?.message || 'Failed to sync calendar provider';
    try {
      const providerService = new CalendarProviderService();
      await providerService.updateProviderStatus(calendarProviderId, {
        status: 'error',
        errorMessage: message
      });
    } catch (statusError) {
      console.warn('[calendarActions] Failed to update provider status after sync error', statusError);
    }
    return { success: false, error: message };
  }
}
