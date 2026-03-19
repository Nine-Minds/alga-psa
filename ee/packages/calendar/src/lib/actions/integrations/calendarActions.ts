'use server';

import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { createTenantKnex, runWithTenant, withTransaction } from '@alga-psa/db';
import {
  generateGoogleCalendarAuthUrl,
  generateMicrosoftCalendarAuthUrl,
  generateCalendarNonce,
  encodeCalendarState,
} from '../../utils/calendar/oauthHelpers';
import { resolveCalendarRedirectUri } from '../../utils/calendar/redirectUri';
import { storeCalendarOAuthState } from '../../utils/calendar/oauthStateStore';
import { resolveMicrosoftConsumerProfileConfig } from '../../microsoftConsumerProfileResolution';
import type { CalendarProviderConfig, CalendarSyncStatus, CalendarConflictResolution } from '@alga-psa/types';
import { CalendarProviderService } from '@alga-psa/ee-calendar/lib/services/calendar/CalendarProviderService';
import { GoogleCalendarAdapter } from '@alga-psa/ee-calendar/lib/services/calendar/providers/GoogleCalendarAdapter';
import { MicrosoftCalendarAdapter } from '@alga-psa/ee-calendar/lib/services/calendar/providers/MicrosoftCalendarAdapter';
import { CalendarSyncService } from '@alga-psa/ee-calendar/lib/services/calendar/CalendarSyncService';
import { CalendarWebhookMaintenanceService } from '@alga-psa/ee-calendar/lib/services/calendar/CalendarWebhookMaintenanceService';

type CalendarActionContext = {
  tenant: string;
};

type CalendarOAuthParams = {
  provider: 'google' | 'microsoft';
  calendarProviderId?: string;
  redirectUri?: string;
  isPopup?: boolean;
};

type CalendarProviderCreateParams = {
  providerType: 'google' | 'microsoft';
  providerName: string;
  calendarId: string;
  syncDirection: 'bidirectional' | 'to_external' | 'from_external';
  vendorConfig: any;
};

type CalendarProviderUpdateParams = {
  providerName?: string;
  calendarId?: string;
  syncDirection?: 'bidirectional' | 'to_external' | 'from_external';
  isActive?: boolean;
  vendorConfig?: any;
};

type AuthenticatedUser = {
  user_id: string;
  user_type?: string;
};

function isClientPortalUser(user: AuthenticatedUser): boolean {
  return user?.user_type === 'client';
}

async function getOwnedCalendarProviderOrNull(params: {
  tenant: string;
  userId: string;
  calendarProviderId: string;
  includeSecrets?: boolean;
}): Promise<CalendarProviderConfig | null> {
  const { tenant, userId, calendarProviderId, includeSecrets } = params;
  const providerService = new CalendarProviderService();
  const provider = await providerService.getProvider(calendarProviderId, tenant, {
    includeSecrets: includeSecrets ?? false,
  });
  if (!provider) return null;
  if (provider.user_id !== userId) return null;
  return provider;
}

export async function initiateCalendarOAuthImpl(
  user: AuthenticatedUser,
  { tenant }: CalendarActionContext,
  params: CalendarOAuthParams
): Promise<{ success: true; authUrl: string; state: string } | { success: false; error: string }> {
  try {
    if (isClientPortalUser(user)) {
      return { success: false, error: 'Forbidden: calendar integrations are not available in the client portal' };
    }

    if (params.calendarProviderId) {
      const owned = await getOwnedCalendarProviderOrNull({
        tenant,
        userId: user.user_id,
        calendarProviderId: params.calendarProviderId,
        includeSecrets: true,
      });
      if (!owned) return { success: false, error: 'Forbidden: calendar provider not found or not owned by user' };
    }

    const { provider, calendarProviderId, redirectUri: requestedRedirectUri, isPopup } = params;
    const secretProvider = await getSecretProviderInstance();

    let existingRedirectUri: string | undefined;
    let existingProviderConfig: CalendarProviderConfig['provider_config'] | undefined;
    if (calendarProviderId) {
      const owned = await getOwnedCalendarProviderOrNull({
        tenant,
        userId: user.user_id,
        calendarProviderId,
        includeSecrets: true,
      });
      if (!owned) return { success: false, error: 'Forbidden: calendar provider not found or not owned by user' };
      existingRedirectUri = owned.provider_config?.redirectUri;
      existingProviderConfig = owned.provider_config;
    }

    let clientId: string | null = null;

    if (provider === 'google') {
      clientId =
        (await secretProvider.getTenantSecret(tenant, 'google_calendar_client_id')) ||
        (await secretProvider.getTenantSecret(tenant, 'google_client_id')) ||
        null;
    } else {
      const microsoftProfile = await resolveMicrosoftConsumerProfileConfig(tenant, 'calendar');
      if (microsoftProfile.status !== 'ready') {
        return {
          success: false,
          error: microsoftProfile.message || 'Microsoft Calendar binding is not configured',
        };
      }
      clientId = microsoftProfile.clientId || null;
    }

    if (!clientId) {
      return { success: false, error: `${provider} OAuth client ID not configured` };
    }

    const redirectUri = await resolveCalendarRedirectUri({
      tenant,
      provider,
      secretProvider,
      hosted: false,
      requestedRedirectUri,
      existingRedirectUri,
    });

    const state = {
      tenant,
      provider,
      calendarProviderId,
      nonce: generateCalendarNonce(),
      redirectUri,
      timestamp: Date.now(),
      hosted: false,
      isPopup,
    };
    const encodedState = encodeCalendarState(state);

    const msTenantAuthority = 'common';

    const authUrl =
      provider === 'microsoft'
        ? await generateMicrosoftCalendarAuthUrl({
            clientId,
            redirectUri: state.redirectUri,
            state: encodedState,
            tenantId: msTenantAuthority,
          })
        : await generateGoogleCalendarAuthUrl({
            clientId,
            redirectUri: state.redirectUri,
            state: encodedState,
          });

    await storeCalendarOAuthState(state.nonce, state, 10 * 60);

    return {
      success: true,
      authUrl,
      state: encodedState,
    };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to initiate OAuth' };
  }
}

export async function getCalendarProvidersImpl(
  user: AuthenticatedUser,
  { tenant }: CalendarActionContext
): Promise<{
  success: boolean;
  providers?: CalendarProviderConfig[];
  error?: string;
}> {
  try {
    const providerService = new CalendarProviderService();
    const providers = await providerService.getProviders({
      tenant,
      userId: user.user_id,
    });

    return { success: true, providers };
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to fetch calendar providers' };
  }
}

export async function createCalendarProviderImpl(
  user: AuthenticatedUser,
  { tenant }: CalendarActionContext,
  params: CalendarProviderCreateParams
): Promise<{
  success: boolean;
  provider?: CalendarProviderConfig;
  error?: string;
}> {
  if (isClientPortalUser(user)) {
    return { success: false, error: 'Forbidden: calendar integrations are not available in the client portal' };
  }

  try {
    const providerService = new CalendarProviderService();

    const existingProviders = await providerService.getProviders({
      tenant,
      userId: user.user_id,
      providerType: params.providerType,
      calendarId: params.calendarId,
    });

    if (existingProviders.length > 0) {
      const existing = existingProviders[0];
      const needsUpdate =
        existing.name !== params.providerName ||
        existing.sync_direction !== params.syncDirection ||
        !existing.active;

      if (needsUpdate) {
        await providerService.updateProvider(existing.id, tenant, {
          providerName: params.providerName,
          calendarId: params.calendarId,
          syncDirection: params.syncDirection,
          isActive: true,
        });
        const updated = await providerService.getProvider(existing.id, tenant, { includeSecrets: false });
        return { success: true, provider: updated ?? existing };
      }

      return { success: true, provider: existing };
    }

    const provider = await providerService.createProvider({
      tenant,
      userId: user.user_id,
      providerType: params.providerType,
      providerName: params.providerName,
      calendarId: params.calendarId,
      isActive: true,
      syncDirection: params.syncDirection,
      vendorConfig: params.vendorConfig,
    });

    return { success: true, provider };
  } catch (error: any) {
    if (
      typeof error?.message === 'string' &&
      (error.message.includes('calendar_providers_tenant_calendar_id_provider_type_unique') ||
        error.message.includes('calendar_providers_tenant_user_provider_unique'))
    ) {
      try {
        const providerService = new CalendarProviderService();
        const existingProviders = await providerService.getProviders({
          tenant,
          userId: user.user_id,
          providerType: params.providerType,
        });
        const existing = existingProviders[0];
        if (existing) {
          return { success: true, provider: existing };
        }
      } catch {
        // fall through
      }
    }
    return { success: false, error: error?.message || 'Failed to create calendar provider' };
  }
}

export async function updateCalendarProviderImpl(
  user: AuthenticatedUser,
  { tenant }: CalendarActionContext,
  calendarProviderId: string,
  params: CalendarProviderUpdateParams
): Promise<{
  success: boolean;
  provider?: CalendarProviderConfig;
  error?: string;
}> {
  try {
    if (isClientPortalUser(user)) {
      return { success: false, error: 'Forbidden: calendar integrations are not available in the client portal' };
    }

    const owned = await getOwnedCalendarProviderOrNull({ tenant, userId: user.user_id, calendarProviderId });
    if (!owned) return { success: false, error: 'Forbidden: calendar provider not found or not owned by user' };

    const providerService = new CalendarProviderService();
    const provider = await providerService.updateProvider(calendarProviderId, tenant, params);

    return { success: true, provider };
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to update calendar provider' };
  }
}

export async function deleteCalendarProviderImpl(
  user: AuthenticatedUser,
  { tenant }: CalendarActionContext,
  calendarProviderId: string
): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    if (isClientPortalUser(user)) {
      return { success: false, error: 'Forbidden: calendar integrations are not available in the client portal' };
    }

    const owned = await getOwnedCalendarProviderOrNull({ tenant, userId: user.user_id, calendarProviderId });
    if (!owned) return { success: false, error: 'Forbidden: calendar provider not found or not owned by user' };

    const providerService = new CalendarProviderService();
    await providerService.deleteProvider(calendarProviderId, tenant);

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to delete calendar provider' };
  }
}

export async function syncScheduleEntryToCalendarImpl(
  user: AuthenticatedUser,
  { tenant }: CalendarActionContext,
  entryId: string,
  calendarProviderId: string
): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    if (isClientPortalUser(user)) {
      return { success: false, error: 'Forbidden: calendar integrations are not available in the client portal' };
    }

    const owned = await getOwnedCalendarProviderOrNull({ tenant, userId: user.user_id, calendarProviderId });
    if (!owned) return { success: false, error: 'Forbidden: calendar provider not found or not owned by user' };

    const syncService = new CalendarSyncService();
    return await syncService.syncScheduleEntryToExternal(entryId, calendarProviderId);
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to sync schedule entry' };
  }
}

export async function syncExternalEventToScheduleImpl(
  user: AuthenticatedUser,
  { tenant }: CalendarActionContext,
  externalEventId: string,
  calendarProviderId: string
): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    if (isClientPortalUser(user)) {
      return { success: false, error: 'Forbidden: calendar integrations are not available in the client portal' };
    }

    const owned = await getOwnedCalendarProviderOrNull({ tenant, userId: user.user_id, calendarProviderId });
    if (!owned) return { success: false, error: 'Forbidden: calendar provider not found or not owned by user' };

    const syncService = new CalendarSyncService();
    return await syncService.syncExternalEventToSchedule(externalEventId, calendarProviderId);
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to sync external event' };
  }
}

export async function resolveCalendarConflictImpl(
  user: AuthenticatedUser,
  { tenant }: CalendarActionContext,
  resolution: CalendarConflictResolution
): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    if (isClientPortalUser(user)) {
      return { success: false, error: 'Forbidden: calendar integrations are not available in the client portal' };
    }

    const { knex } = await createTenantKnex();
    const mapping = await withTransaction(knex, async (trx) => {
      return trx('calendar_event_mappings as cem')
        .join('calendar_providers as cp', function (this: any) {
          this.on('cp.id', '=', 'cem.calendar_provider_id').andOn('cp.tenant', '=', 'cem.tenant');
        })
        .where('cem.tenant', tenant)
        .andWhere('cem.id', resolution.mappingId)
        .andWhere('cp.user_id', user.user_id)
        .first(['cem.id']);
    });
    if (!mapping) return { success: false, error: 'Forbidden: mapping not found or not owned by user' };

    const syncService = new CalendarSyncService();
    return await syncService.resolveConflict(
      resolution.mappingId,
      resolution.resolution,
      resolution.mergeData
    );
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to resolve conflict' };
  }
}

export async function getScheduleEntrySyncStatusImpl(
  user: AuthenticatedUser,
  { tenant }: CalendarActionContext,
  entryId: string
): Promise<{
  success: boolean;
  status?: CalendarSyncStatus[];
  error?: string;
}> {
  try {
    if (isClientPortalUser(user)) {
      return { success: false, error: 'Forbidden: calendar integrations are not available in the client portal' };
    }

    const { knex } = await createTenantKnex();
    const mappings = await withTransaction(knex, async (trx) => {
      return trx('calendar_event_mappings as cem')
        .join('calendar_providers as cp', function (this: any) {
          this.on('cp.id', '=', 'cem.calendar_provider_id').andOn('cp.tenant', '=', 'cem.tenant');
        })
        .where('cem.schedule_entry_id', entryId)
        .andWhere('cem.tenant', tenant)
        .andWhere('cp.user_id', user.user_id)
        .select('cem.*');
    });

    const providerService = new CalendarProviderService();
    const statuses: CalendarSyncStatus[] = [];

    for (const mapping of mappings) {
      const provider = await providerService.getProvider(mapping.calendar_provider_id, tenant, {
        includeSecrets: false,
      });
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
            externalEventId: mapping.external_event_id,
          },
        });
      }
    }

    return { success: true, status: statuses };
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to get sync status' };
  }
}

export async function syncCalendarProviderImpl(
  user: AuthenticatedUser,
  { tenant }: CalendarActionContext,
  calendarProviderId: string
): Promise<{
  success: boolean;
  started?: boolean;
  error?: string;
}> {
  try {
    if (isClientPortalUser(user)) {
      return { success: false, error: 'Forbidden: calendar integrations are not available in the client portal' };
    }

    const providerService = new CalendarProviderService();
    const provider = await providerService.getProvider(calendarProviderId, tenant);

    if (!provider) {
      return { success: false, error: 'Calendar provider not found' };
    }

    if (provider.user_id !== user.user_id) {
      return { success: false, error: 'Forbidden: calendar provider not found or not owned by user' };
    }

    const tenantId = tenant;

    setImmediate(async () => {
      console.log(`[calendarActions] Starting background sync for provider ${calendarProviderId}`);
      const startTime = Date.now();

      try {
        const syncService = new CalendarSyncService();
        const failures: string[] = [];
        let pushed = 0;
        let pulled = 0;

        const allowPush =
          provider.sync_direction === 'bidirectional' || provider.sync_direction === 'to_external';
        const allowPull =
          provider.sync_direction === 'bidirectional' || provider.sync_direction === 'from_external';

        await runWithTenant(tenantId, async () => {
          const { knex } = await createTenantKnex(tenantId);

          const now = new Date();
          const windowStart = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
          const windowEnd = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000);

          const mappings = await withTransaction(knex, async (trx) => {
            return trx('calendar_event_mappings as cem')
              .join('schedule_entries as se', function (this: any) {
                this.on('se.entry_id', '=', 'cem.schedule_entry_id').andOn('se.tenant', '=', 'cem.tenant');
              })
              .where('cem.tenant', tenantId)
              .andWhere('cem.calendar_provider_id', calendarProviderId)
              .andWhere(function (this: any) {
                this.where('se.scheduled_start', '<=', windowEnd).andWhere('se.scheduled_end', '>=', windowStart);
              })
              .select('cem.schedule_entry_id', 'cem.external_event_id');
          });

          for (const mapping of mappings) {
            if (allowPush) {
              const result = await syncService.syncScheduleEntryToExternal(
                mapping.schedule_entry_id,
                calendarProviderId,
                true
              );
              if (result.success) {
                pushed += 1;
              } else {
                failures.push(`Push ${mapping.schedule_entry_id}: ${result.error || 'unknown error'}`);
              }
            }

            if (allowPull) {
              const result = await syncService.syncExternalEventToSchedule(
                mapping.external_event_id,
                calendarProviderId,
                true
              );
              if (result.success) {
                pulled += 1;
              } else {
                failures.push(`Pull ${mapping.external_event_id}: ${result.error || 'unknown error'}`);
              }
            }
          }

          if (allowPush) {
            const recentEntries = await withTransaction(knex, async (trx) => {
              return trx('schedule_entries')
                .where('schedule_entries.tenant', tenantId)
                .andWhere('schedule_entries.scheduled_start', '<=', windowEnd)
                .andWhere('schedule_entries.scheduled_end', '>=', windowStart)
                .leftJoin('calendar_event_mappings as cem', function (this: any) {
                  this.on('cem.schedule_entry_id', '=', 'schedule_entries.entry_id')
                    .andOn('cem.tenant', '=', 'schedule_entries.tenant')
                    .andOn('cem.calendar_provider_id', '=', trx.raw('?', [calendarProviderId]));
                })
                .whereNull('cem.id')
                .limit(100)
                .select('schedule_entries.entry_id as entry_id');
            });

            for (const entry of recentEntries) {
              const result = await syncService.syncScheduleEntryToExternal(entry.entry_id, calendarProviderId, true);
              if (result.success) {
                pushed += 1;
              } else {
                failures.push(`Push ${entry.entry_id}: ${result.error || 'unknown error'}`);
              }
            }
          }

          if (allowPull) {
            const hasProviderSecrets = provider.provider_config && provider.provider_config.clientId;
            if (hasProviderSecrets) {
              try {
                const adapter =
                  provider.provider_type === 'google'
                    ? new GoogleCalendarAdapter(provider)
                    : new MicrosoftCalendarAdapter(provider);

                await adapter.connect();
                await adapter.registerWebhookSubscription();
              } catch (subscriptionError: any) {
                failures.push(
                  `Webhook registration failed: ${subscriptionError?.message || 'unknown error'}`
                );
              }
            }
          }
        });

        const duration = Date.now() - startTime;

        if (failures.length === 0) {
          await providerService.updateProviderStatus(calendarProviderId, {
            status: 'connected',
            lastSyncAt: new Date().toISOString(),
            errorMessage: null,
          });
          console.log(
            `[calendarActions] Background sync completed successfully in ${duration}ms. Pushed=${pushed}, Pulled=${pulled}`
          );
        } else {
          const summary = `Manual sync completed with ${failures.length} issue(s). Pushed=${pushed}, Pulled=${pulled}.`;
          await providerService.updateProviderStatus(calendarProviderId, {
            status: 'error',
            errorMessage: `${summary} Details: ${failures.join('; ').slice(0, 500)}`,
          });
          console.warn(`[calendarActions] Background sync completed with errors in ${duration}ms: ${summary}`);
        }
      } catch (error: any) {
        const message = error?.message || 'Failed to sync calendar provider';
        console.error('[calendarActions] Background sync failed:', error);
        try {
          await providerService.updateProviderStatus(calendarProviderId, {
            status: 'error',
            errorMessage: message,
          });
        } catch (statusError) {
          console.warn('[calendarActions] Failed to update provider status after sync error', statusError);
        }
      }
    });

    return { success: true, started: true };
  } catch (error: any) {
    return { success: false, error: error?.message || 'Failed to start calendar sync' };
  }
}

export async function retryMicrosoftCalendarSubscriptionRenewalImpl(
  user: AuthenticatedUser,
  { tenant }: CalendarActionContext,
  providerId: string
): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    if (isClientPortalUser(user)) {
      return { success: false, error: 'Forbidden: calendar integrations are not available in the client portal' };
    }

    const { knex } = await createTenantKnex();
    const provider = await knex('calendar_providers').where({ id: providerId, tenant }).first();

    if (!provider) {
      return { success: false, error: 'Provider not found or access denied' };
    }

    if (provider.user_id !== user.user_id) {
      return { success: false, error: 'Forbidden: calendar provider not found or not owned by user' };
    }

    if (provider.provider_type !== 'microsoft') {
      return { success: false, error: 'Provider is not a Microsoft calendar provider' };
    }

    const service = new CalendarWebhookMaintenanceService();
    const results = await service.renewMicrosoftWebhooks({
      tenantId: tenant,
      providerId,
      lookAheadMinutes: 0,
    });

    if (results.length === 0) {
      return { success: false, error: 'Provider not found or not eligible for renewal' };
    }

    const result = results[0];
    if (result.success) {
      return {
        success: true,
        message: `Subscription ${result.action} successfully${
          result.newExpiration ? ` (expires: ${new Date(result.newExpiration).toLocaleString()})` : ''
        }`,
      };
    }

    return { success: false, error: result.error || 'Renewal failed' };
  } catch (error: any) {
    console.error('[calendarActions] Manual renewal failed:', error);
    return { success: false, error: error.message || 'Internal server error' };
  }
}
