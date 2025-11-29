'use server'

import { getCurrentUser } from '../user-actions/userActions';
import { getSecretProviderInstance } from '@alga-psa/shared/core';
import { hasPermission } from '../../auth/rbac';
import { createTenantKnex, runWithTenant } from '../../db';
import { generateGoogleCalendarAuthUrl, generateMicrosoftCalendarAuthUrl, generateCalendarNonce, encodeCalendarState } from '@/utils/calendar/oauthHelpers';
import { resolveCalendarRedirectUri } from '@/utils/calendar/redirectUri';
import { storeCalendarOAuthState } from '@/utils/calendar/oauthStateStore';
import { CalendarProviderService } from '@/services/calendar/CalendarProviderService';
import { GoogleCalendarAdapter } from '@/services/calendar/providers/GoogleCalendarAdapter';
import { MicrosoftCalendarAdapter } from '@/services/calendar/providers/MicrosoftCalendarAdapter';
import { CalendarSyncService } from '@/services/calendar/CalendarSyncService';
import { CalendarWebhookMaintenanceService } from '@/services/calendar/CalendarWebhookMaintenanceService';
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
    let existingProviderConfig: CalendarProviderConfig['provider_config'] | undefined;
    if (calendarProviderId) {
      const providerService = new CalendarProviderService();
      const providerRecord = await providerService.getProvider(calendarProviderId, tenant, { includeSecrets: true });
      if (!providerRecord) {
        return { success: false, error: 'Invalid calendarProviderId for tenant' };
      }
      existingRedirectUri = providerRecord.provider_config?.redirectUri;
      existingProviderConfig = providerRecord.provider_config;
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
          || (await secretProvider.getAppSecret('GOOGLE_CALENDAR_CLIENT_ID'))
          || null;
      } else {
        clientId = process.env.MICROSOFT_CLIENT_ID
          || (await secretProvider.getTenantSecret(tenant, 'microsoft_client_id'))
          || (await secretProvider.getAppSecret('MICROSOFT_CLIENT_ID'))
          || null;
      }
    }

    if (!clientId && existingProviderConfig && provider === 'microsoft') {
      clientId = existingProviderConfig.clientId || null;
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

    // For multi-tenant Azure AD apps, always use 'common' for the authorization URL
    // This allows users from any Azure AD tenant to authenticate
    const msTenantAuthority = 'common';

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
 * Get calendar providers for current user
 * Each user has their own calendar sync configuration
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
      tenant: user.tenant,
      userId: user.user_id
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
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, error: 'Unauthorized' };
  }

  const permitted = await hasPermission(user as any, 'system_settings', 'create');
  if (!permitted) {
    return { success: false, error: 'Forbidden: insufficient permissions' };
  }

  try {
    const providerService = new CalendarProviderService();

    // Reuse existing provider when unique constraint would be violated
    // Each user can only have one provider per type
    const existingProviders = await providerService.getProviders({
      tenant: user.tenant,
      userId: user.user_id,
      providerType: params.providerType,
      calendarId: params.calendarId
    });

    if (existingProviders.length > 0) {
      const existing = existingProviders[0];
      const needsUpdate =
        existing.name !== params.providerName ||
        existing.sync_direction !== params.syncDirection ||
        !existing.active;

      if (needsUpdate) {
        await providerService.updateProvider(existing.id, user.tenant, {
          providerName: params.providerName,
          calendarId: params.calendarId,
          syncDirection: params.syncDirection,
          isActive: true
        });
        const updated = await providerService.getProvider(existing.id, user.tenant, { includeSecrets: false });
        return { success: true, provider: updated ?? existing };
      }

      return { success: true, provider: existing };
    }

    const provider = await providerService.createProvider({
      tenant: user.tenant,
      userId: user.user_id,
      providerType: params.providerType,
      providerName: params.providerName,
      calendarId: params.calendarId,
      isActive: true,
      syncDirection: params.syncDirection,
      vendorConfig: params.vendorConfig
    });

    return { success: true, provider };
  } catch (error: any) {
    // Handle race where provider created concurrently
    // Check for both old and new unique constraint names
    if (typeof error?.message === 'string' &&
        (error.message.includes('calendar_providers_tenant_calendar_id_provider_type_unique') ||
         error.message.includes('calendar_providers_tenant_user_provider_unique'))) {
      try {
        const providerService = new CalendarProviderService();
        const existingProviders = await providerService.getProviders({
          tenant: user.tenant,
          userId: user.user_id,
          providerType: params.providerType
        });
        const existing = existingProviders[0];
        if (existing) {
          return { success: true, provider: existing };
        }
      } catch (secondaryError) {
        // fall through to default error handling
      }
    }
    return { success: false, error: error?.message || 'Failed to create calendar provider' };
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

      const knownExternalIds = new Set<string>(
        mappings
          .map((mapping) => mapping.external_event_id)
          .filter((id): id is string => Boolean(id))
      );

      for (const mapping of mappings) {
        if (allowPush) {
          const result = await syncService.syncScheduleEntryToExternal(mapping.schedule_entry_id, calendarProviderId, true);
          if (result.success) {
            pushed += 1;
            if (result.externalEventId) {
              knownExternalIds.add(result.externalEventId);
            }
          } else {
            failures.push(`Push ${mapping.schedule_entry_id}: ${result.error || 'unknown error'}`);
          }
        }

        if (allowPull) {
          const result = await syncService.syncExternalEventToSchedule(mapping.external_event_id, calendarProviderId, true);
          if (result.success) {
            pulled += 1;
            if (mapping.external_event_id) {
              knownExternalIds.add(mapping.external_event_id);
            }
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
            if (result.externalEventId) {
              knownExternalIds.add(result.externalEventId);
            }
          } else {
            failures.push(`Push ${entry.entry_id}: ${result.error || 'unknown error'}`);
          }
        }
      }

      if (allowPull) {
        const hasProviderSecrets = provider.provider_config && provider.provider_config.clientId;
        if (!hasProviderSecrets) {
          failures.push('Pull: Provider credentials are missing, cannot list external events.');
          return;
        }

        const adapter =
          provider.provider_type === 'google'
            ? new GoogleCalendarAdapter(provider)
            : new MicrosoftCalendarAdapter(provider);

        await adapter.connect();

        const now = Date.now();
        const lookbackMs = 1000 * 60 * 60 * 24 * 30; // 30 days
        const lookaheadMs = 1000 * 60 * 60 * 24 * 30; // 30 days
        const lastSyncAt = provider.last_sync_at ? new Date(provider.last_sync_at) : null;
        const startWindow = lastSyncAt
          ? new Date(Math.min(lastSyncAt.getTime(), now - lookbackMs))
          : new Date(now - lookbackMs);
        const endWindow = new Date(now + lookaheadMs);

        try {
          try {
            await adapter.registerWebhookSubscription();
          } catch (subscriptionError: any) {
            failures.push(`Webhook registration failed: ${subscriptionError?.message || 'unknown error'}`);
          }

          const externalEvents = await adapter.listEvents(startWindow, endWindow);
          for (const event of externalEvents) {
            const externalId = event.id;
            if (!externalId) {
              continue;
            }
            if (knownExternalIds.has(externalId)) {
              continue;
            }

            const result = await syncService.syncExternalEventToSchedule(externalId, calendarProviderId, true);
            if (result.success) {
              pulled += 1;
              knownExternalIds.add(externalId);
            } else {
              failures.push(`Pull ${externalId}: ${result.error || 'unknown error'}`);
            }
          }
        } catch (error: any) {
          failures.push(`Pull listing failed: ${error?.message || 'unable to list external events'}`);
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

/**
 * Manually retry Microsoft calendar subscription renewal for a specific provider
 */
export async function retryMicrosoftCalendarSubscriptionRenewal(
  providerId: string
): Promise<{ success: boolean; message?: string; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: 'Unauthorized' };

  try {
    // RBAC: validate permission
    const resource = 'system_settings';
    const action = 'update';
    const permitted = await hasPermission(user as any, resource, action);
    if (!permitted) {
      return { success: false, error: 'Forbidden: insufficient permissions' };
    }

    // Verify provider belongs to user's tenant
    const { knex, tenant } = await createTenantKnex();
    const provider = await knex('calendar_providers')
      .where({ id: providerId, tenant })
      .first();
    
    if (!provider) {
      return { success: false, error: 'Provider not found or access denied' };
    }

    if (provider.provider_type !== 'microsoft') {
      return { success: false, error: 'Provider is not a Microsoft calendar provider' };
    }

    const service = new CalendarWebhookMaintenanceService();
    const results = await service.renewMicrosoftWebhooks({
      tenantId: tenant,
      providerId: providerId,
      lookAheadMinutes: 0 // Force check regardless of expiration time
    });

    if (results.length === 0) {
      return { success: false, error: 'Provider not found or not eligible for renewal' };
    }

    const result = results[0];
    if (result.success) {
      return { 
        success: true, 
        message: `Subscription ${result.action} successfully${result.newExpiration ? ` (expires: ${new Date(result.newExpiration).toLocaleString()})` : ''}` 
      };
    } else {
      return { success: false, error: result.error || 'Renewal failed' };
    }
  } catch (error: any) {
    console.error('[calendarActions] Manual renewal failed:', error);
    return { success: false, error: error.message || 'Internal server error' };
  }
}
