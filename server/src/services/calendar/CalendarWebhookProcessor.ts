/**
 * Calendar Webhook Processor
 * Handles incoming webhook notifications from Google Calendar and Microsoft Calendar
 */

import { CalendarSyncService } from '../CalendarSyncService';
import { CalendarProviderService } from '../CalendarProviderService';
import { CalendarProviderConfig } from '../../interfaces/calendar.interfaces';
import { GoogleCalendarAdapter } from './providers/GoogleCalendarAdapter';
import { MicrosoftCalendarAdapter } from './providers/MicrosoftCalendarAdapter';
import { BaseCalendarAdapter } from './providers/base/BaseCalendarAdapter';
import { runWithTenant, createTenantKnex } from '../../lib/db';
import { getAdminConnection } from '@alga-psa/db/admin';

export class CalendarWebhookProcessor {
  private syncService: CalendarSyncService;
  private providerService: CalendarProviderService;

  constructor() {
    this.syncService = new CalendarSyncService();
    this.providerService = new CalendarProviderService();
  }

  /**
   * Process Google Calendar webhook notification (Pub/Sub)
   */
  async processGoogleWebhook(
    pubsubMessage: any,
    subscriptionName?: string
  ): Promise<{ success: number; failed: number }> {
    console.log('📅 Processing Google Calendar webhook notification');

    if (!subscriptionName) {
      console.warn('⚠️ Missing subscription name on Google webhook payload');
      return { success: 0, failed: 1 };
    }

    const provider = await this.getProviderByGoogleSubscription(subscriptionName);
    if (!provider) {
      console.error(`❌ Provider not found for subscription: ${subscriptionName}`);
      return { success: 0, failed: 1 };
    }

    if (provider.sync_direction === 'to_external') {
      console.log('⚠️ Provider configured for one-way sync to external only, skipping webhook');
      return { success: 0, failed: 0 };
    }

    try {
      return await runWithTenant(provider.tenant, async () => {
        const adapter = (await this.createAdapter(provider)) as GoogleCalendarAdapter;
        await adapter.connect();

        const { knex } = await createTenantKnex();

        // Update health table to track webhook receipt
        try {
          const now = new Date().toISOString();
          const existing = await knex('calendar_provider_health')
            .where('calendar_provider_id', provider.id)
            .andWhere('tenant', provider.tenant)
            .first();

          if (existing) {
            await knex('calendar_provider_health')
              .where('calendar_provider_id', provider.id)
              .andWhere('tenant', provider.tenant)
              .update({
                last_webhook_received_at: now,
                updated_at: now
              });
          } else {
            await knex('calendar_provider_health')
              .insert({
                calendar_provider_id: provider.id,
                tenant: provider.tenant,
                last_webhook_received_at: now,
                created_at: now,
                updated_at: now
              });
          }
        } catch (healthError: any) {
          console.warn('[CalendarWebhookProcessor] Failed to update Google health table', { error: healthError.message });
        }

        const fallbackStart = provider.last_sync_at ? new Date(provider.last_sync_at) : undefined;
        let syncToken = provider.provider_config?.syncToken || undefined;

        let changesResult = await adapter.fetchEventChanges({
          syncToken,
          timeMin: fallbackStart
        });

        if (changesResult.resetRequired) {
          console.warn('[CalendarWebhookProcessor] Google sync token invalid, resetting window', {
            providerId: provider.id
          });

          await this.providerService.updateProvider(provider.id, provider.tenant, {
            vendorConfig: { syncToken: null }
          });

          const resetStart =
            fallbackStart ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

          changesResult = await adapter.fetchEventChanges({
            timeMin: resetStart
          });
        }

        if (changesResult.nextSyncToken && changesResult.nextSyncToken !== syncToken) {
          await this.providerService.updateProvider(provider.id, provider.tenant, {
            vendorConfig: { syncToken: changesResult.nextSyncToken }
          });
        }

        let successCount = 0;
        let failedCount = 0;

        for (const change of changesResult.changes) {
          if (!change?.id) {
            continue;
          }

          if (change.changeType === 'deleted') {
            try {
              const mapping = await knex('calendar_event_mappings')
                .where('external_event_id', change.id)
                .andWhere('calendar_provider_id', provider.id)
                .andWhere('tenant', provider.tenant)
                .first();

              if (!mapping) {
                console.warn('[CalendarWebhookProcessor] No mapping found for deleted Google event', {
                  eventId: change.id,
                  providerId: provider.id
                });
                continue;
              }

              await this.executeWithRetry(async () => {
                const result = await this.syncService.deleteScheduleEntry(
                  mapping.schedule_entry_id,
                  provider.id,
                  'all',
                  true // skipExternalDelete - event already deleted in external calendar
                );
                if (!result.success) {
                  throw new Error(result.error || 'Failed to delete schedule entry');
                }
                return result;
              }, `google-delete-${change.id}`);

              successCount++;
            } catch (error: any) {
              failedCount++;
              console.error(`❌ Failed to process Google deletion for event ${change.id}:`, error?.message || error);
            }
          } else {
            try {
              await this.executeWithRetry(async () => {
                const result = await this.syncService.syncExternalEventToSchedule(
                  change.id,
                  provider.id
                );
                if (!result.success) {
                  throw new Error(result.error || 'Failed to sync schedule entry');
                }
                return result;
              }, `google-sync-${change.id}`);

              successCount++;
            } catch (error: any) {
              failedCount++;
              console.error(`❌ Failed to sync Google event ${change.id}:`, error?.message || error);
            }
          }
        }

        return { success: successCount, failed: failedCount };
      });
    } catch (error: any) {
      console.error('❌ Error processing Google Calendar webhook:', error?.message || error);
      return { success: 0, failed: 1 };
    }
  }

  /**
   * Process Google Calendar webhook notification (Calendar push channel web_hook).
   */
  async processGoogleChannelWebhook(params: {
    channelId: string;
    resourceId?: string | null;
    token?: string | null;
    resourceState?: string | null;
  }): Promise<{ success: number; failed: number }> {
    const { channelId, resourceId, token } = params;

    const provider = await this.getProviderByGoogleChannelId(channelId);
    if (!provider) {
      console.error(`❌ Provider not found for Google channel: ${channelId}`);
      return { success: 0, failed: 1 };
    }

    const expectedToken = provider.provider_config?.webhookVerificationToken;
    if (expectedToken && token && expectedToken !== token) {
      console.warn('⚠️ Google Calendar webhook token mismatch', {
        providerId: provider.id,
        channelId
      });
      return { success: 0, failed: 1 };
    }

    const expectedResourceId = provider.provider_config?.webhookResourceId;
    if (expectedResourceId && resourceId && expectedResourceId !== resourceId) {
      console.warn('⚠️ Google Calendar webhook resourceId mismatch', {
        providerId: provider.id,
        channelId
      });
      return { success: 0, failed: 1 };
    }

    // Reuse the same delta-sync pipeline used by Pub/Sub flow.
    try {
      return await runWithTenant(provider.tenant, async () => {
        const adapter = (await this.createAdapter(provider)) as GoogleCalendarAdapter;
        await adapter.connect();

        const { knex } = await createTenantKnex();

        // Update health table to track webhook receipt
        try {
          const now = new Date().toISOString();
          const existing = await knex('calendar_provider_health')
            .where('calendar_provider_id', provider.id)
            .andWhere('tenant', provider.tenant)
            .first();

          if (existing) {
            await knex('calendar_provider_health')
              .where('calendar_provider_id', provider.id)
              .andWhere('tenant', provider.tenant)
              .update({
                last_webhook_received_at: now,
                updated_at: now
              });
          } else {
            await knex('calendar_provider_health').insert({
              calendar_provider_id: provider.id,
              tenant: provider.tenant,
              last_webhook_received_at: now,
              created_at: now,
              updated_at: now
            });
          }
        } catch (healthError: any) {
          console.warn('[CalendarWebhookProcessor] Failed to update Google health table', { error: healthError.message });
        }

        const fallbackStart = provider.last_sync_at ? new Date(provider.last_sync_at) : undefined;
        let syncToken = provider.provider_config?.syncToken || undefined;

        let changesResult = await adapter.fetchEventChanges({
          syncToken,
          timeMin: fallbackStart
        });

        if (changesResult.resetRequired) {
          console.warn('[CalendarWebhookProcessor] Google sync token invalid, resetting window', {
            providerId: provider.id
          });

          await this.providerService.updateProvider(provider.id, provider.tenant, {
            vendorConfig: { syncToken: null }
          });

          const resetStart = fallbackStart ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          changesResult = await adapter.fetchEventChanges({
            timeMin: resetStart
          });
        }

        if (changesResult.nextSyncToken && changesResult.nextSyncToken !== syncToken) {
          await this.providerService.updateProvider(provider.id, provider.tenant, {
            vendorConfig: { syncToken: changesResult.nextSyncToken }
          });
        }

        let successCount = 0;
        let failedCount = 0;

        for (const change of changesResult.changes) {
          if (!change?.id) {
            continue;
          }

          if (change.changeType === 'deleted') {
            try {
              const mapping = await knex('calendar_event_mappings')
                .where('external_event_id', change.id)
                .andWhere('calendar_provider_id', provider.id)
                .andWhere('tenant', provider.tenant)
                .first();

              if (!mapping) {
                console.warn('[CalendarWebhookProcessor] No mapping found for deleted Google event', {
                  eventId: change.id,
                  providerId: provider.id
                });
                continue;
              }

              await this.executeWithRetry(async () => {
                const result = await this.syncService.deleteScheduleEntry(
                  mapping.schedule_entry_id,
                  provider.id,
                  'all',
                  true
                );
                if (!result.success) {
                  throw new Error(result.error || 'Failed to delete schedule entry');
                }
                return result;
              }, `google-delete-${change.id}`);

              successCount++;
            } catch (error: any) {
              failedCount++;
              console.error(`❌ Failed to process Google deletion for event ${change.id}:`, error?.message || error);
            }
          } else {
            try {
              await this.executeWithRetry(async () => {
                const result = await this.syncService.syncExternalEventToSchedule(change.id, provider.id);
                if (!result.success) {
                  throw new Error(result.error || 'Failed to sync schedule entry');
                }
                return result;
              }, `google-sync-${change.id}`);

              successCount++;
            } catch (error: any) {
              failedCount++;
              console.error(`❌ Failed to sync Google event ${change.id}:`, error?.message || error);
            }
          }
        }

        return { success: successCount, failed: failedCount };
      });
    } catch (error: any) {
      console.error('❌ Error processing Google Calendar channel webhook:', error?.message || error);
      return { success: 0, failed: 1 };
    }
  }

  /**
   * Process Microsoft Calendar webhook notification
   */
  async processMicrosoftWebhook(
    notifications: any[]
  ): Promise<{ success: number; failed: number }> {
    const subscriptionCache = new Map<string, CalendarProviderConfig | null>();
    const providerNotifications = new Map<string, { provider: CalendarProviderConfig; notifications: any[] }>();
    let successCount = 0;
    let failedCount = 0;

    for (const notification of notifications) {
      if (!this.isValidMicrosoftNotification(notification)) {
        console.warn('⚠️ Invalid Microsoft Calendar notification format:', notification);
        failedCount++;
        continue;
      }

      const subscriptionId = notification.subscriptionId;
      let provider = subscriptionCache.get(subscriptionId);
      if (provider === undefined) {
        provider = await this.getProviderByMicrosoftSubscription(subscriptionId);
        subscriptionCache.set(subscriptionId, provider);
      }

      if (!provider) {
        console.error(`❌ Provider not found for subscription: ${subscriptionId}`);
        failedCount++;
        continue;
      }

      if (provider.sync_direction === 'to_external') {
        console.log('⚠️ Provider configured for one-way sync to external only, skipping webhook');
        continue;
      }

      const vendorConfig = provider.provider_config || {};
      if (
        vendorConfig.webhookVerificationToken &&
        notification.clientState !== vendorConfig.webhookVerificationToken
      ) {
        console.error(`❌ Invalid client state for provider ${provider.id}`);
        failedCount++;
        continue;
      }

      let existing = providerNotifications.get(provider.id);
      if (!existing) {
        existing = { provider, notifications: [] };
        providerNotifications.set(provider.id, existing);
      }
      existing.notifications.push(notification);
    }

    for (const [providerId, entry] of providerNotifications.entries()) {
      const { provider, notifications: notificationsForProvider } = entry;

      try {
        const result = await runWithTenant(provider.tenant, async () => {
          const adapter = (await this.createAdapter(provider)) as MicrosoftCalendarAdapter;
          await adapter.connect();

          const { knex } = await createTenantKnex();

          let deltaLink = provider.provider_config?.deltaLink || undefined;
          let deltaResult = await adapter.fetchDeltaChanges(deltaLink);

          if (deltaResult.resetRequired) {
            console.warn('[CalendarWebhookProcessor] Microsoft delta link invalid, resetting', {
              providerId
            });

            await this.providerService.updateProvider(provider.id, provider.tenant, {
              vendorConfig: { deltaLink: null }
            });
            deltaResult = await adapter.fetchDeltaChanges(undefined);
          }

          if (deltaResult.deltaLink && deltaResult.deltaLink !== deltaLink) {
            await this.providerService.updateProvider(provider.id, provider.tenant, {
              vendorConfig: { deltaLink: deltaResult.deltaLink }
            });
          }

          const queuedChanges: Array<{ id: string; changeType: 'updated' | 'deleted' }> = [];
          const seen = new Set<string>();

          for (const change of deltaResult.changes) {
            const key = `${change.id}:${change.changeType}`;
            if (!seen.has(key)) {
              queuedChanges.push(change);
              seen.add(key);
            }
          }

          for (const notification of notificationsForProvider) {
            const eventId =
              notification.resourceData?.id ||
              this.extractEventIdFromResource(notification.resource);
            if (!eventId) {
              continue;
            }

            const type =
              typeof notification.changeType === 'string' &&
              notification.changeType.toLowerCase() === 'deleted'
                ? 'deleted'
                : 'updated';

            const key = `${eventId}:${type}`;
            if (!seen.has(key)) {
              queuedChanges.push({ id: eventId, changeType: type });
              seen.add(key);
            }
          }

          let localSuccess = 0;
          let localFailed = 0;

          for (const change of queuedChanges) {
            if (change.changeType === 'deleted') {
              try {
                const mapping = await knex('calendar_event_mappings')
                  .where('external_event_id', change.id)
                  .andWhere('calendar_provider_id', provider.id)
                  .andWhere('tenant', provider.tenant)
                  .first();

                if (!mapping) {
                  console.warn('[CalendarWebhookProcessor] No mapping found for deleted Microsoft event', {
                    eventId: change.id,
                    providerId
                  });
                  continue;
                }

                await this.executeWithRetry(async () => {
                  const result = await this.syncService.deleteScheduleEntry(
                    mapping.schedule_entry_id,
                    provider.id,
                    'all',
                    true // skipExternalDelete - event already deleted in external calendar
                  );
                  if (!result.success) {
                    throw new Error(result.error || 'Failed to delete schedule entry');
                  }
                  return result;
                }, `microsoft-delete-${change.id}`);

                localSuccess++;
              } catch (error: any) {
                localFailed++;
                console.error(`❌ Failed to process Microsoft deletion for event ${change.id}:`, error?.message || error);
              }
            } else {
              try {
                await this.executeWithRetry(async () => {
                  const result = await this.syncService.syncExternalEventToSchedule(
                    change.id,
                    provider.id
                  );
                  if (!result.success) {
                    throw new Error(result.error || 'Failed to sync schedule entry');
                  }
                  return result;
                }, `microsoft-sync-${change.id}`);

                localSuccess++;
              } catch (error: any) {
                localFailed++;
                console.error(`❌ Failed to sync Microsoft event ${change.id}:`, error?.message || error);
              }
            }
          }

          return { success: localSuccess, failed: localFailed };
        });

        successCount += result.success;
        failedCount += result.failed;
      } catch (error: any) {
        failedCount++;
        console.error('❌ Error processing Microsoft Calendar notification batch:', error?.message || error);
      }
    }

    return { success: successCount, failed: failedCount };
  }

  /**
   * Get provider by Google subscription name
   */
  private async getProviderByGoogleSubscription(subscriptionName: string): Promise<CalendarProviderConfig | null> {
    try {
      const knex = await getAdminConnection();
      const row = await knex('google_calendar_provider_config as gc')
        .join('calendar_providers as cp', function() {
          this.on('gc.calendar_provider_id', '=', 'cp.id')
            .andOn('gc.tenant', '=', 'cp.tenant');
        })
        .where('gc.pubsub_subscription_name', subscriptionName)
        .andWhere('cp.is_active', true)
        .first({
          provider_id: 'cp.id',
          provider_tenant: 'cp.tenant',
        });

      if (!row) {
        return null;
      }

      return this.providerService.getProvider(row.provider_id, row.provider_tenant);
    } catch (error: any) {
      console.error('Failed to get provider by Google subscription:', error);
      return null;
    }
  }

  private async getProviderByGoogleChannelId(channelId: string): Promise<CalendarProviderConfig | null> {
    try {
      const knex = await getAdminConnection();
      const row = await knex('google_calendar_provider_config as gc')
        .join('calendar_providers as cp', function() {
          this.on('gc.calendar_provider_id', '=', 'cp.id')
            .andOn('gc.tenant', '=', 'cp.tenant');
        })
        .where('gc.webhook_subscription_id', channelId)
        .andWhere('cp.is_active', true)
        .first({
          provider_id: 'cp.id',
          provider_tenant: 'cp.tenant',
        });

      if (!row) {
        return null;
      }

      return this.providerService.getProvider(row.provider_id, row.provider_tenant, { includeSecrets: true });
    } catch (error: any) {
      console.error('Failed to get provider by Google channel ID:', error);
      return null;
    }
  }

  /**
   * Get provider by Microsoft subscription ID
   */
  private async getProviderByMicrosoftSubscription(subscriptionId: string): Promise<CalendarProviderConfig | null> {
    try {
      const knex = await getAdminConnection();
      const row = await knex('microsoft_calendar_provider_config as mc')
        .join('calendar_providers as cp', function() {
          this.on('mc.calendar_provider_id', '=', 'cp.id')
            .andOn('mc.tenant', '=', 'cp.tenant');
        })
        .where('mc.webhook_subscription_id', subscriptionId)
        .andWhere('cp.is_active', true)
        .first({
          provider_id: 'cp.id',
          provider_tenant: 'cp.tenant',
        });

      if (!row) {
        return null;
      }

      return this.providerService.getProvider(row.provider_id, row.provider_tenant);
    } catch (error: any) {
      console.error('Failed to get provider by Microsoft subscription:', error);
      return null;
    }
  }

  /**
   * Create adapter instance for provider
   */
  private async createAdapter(provider: CalendarProviderConfig): Promise<BaseCalendarAdapter> {
    switch (provider.provider_type) {
      case 'google':
        return new GoogleCalendarAdapter(provider);
      case 'microsoft':
        return new MicrosoftCalendarAdapter(provider);
      default:
        throw new Error(`Unsupported provider type: ${provider.provider_type}`);
    }
  }

  /**
   * Validate Microsoft notification format
   */
  private isValidMicrosoftNotification(notification: any): boolean {
    return (
      notification &&
      notification.changeType &&
      (notification.resourceData?.id || notification.resource) &&
      notification.subscriptionId
    );
  }

  /**
   * Extract event ID from Microsoft resource URL
   */
  private extractEventIdFromResource(resource: string): string | null {
    if (!resource) return null;
    
    // Resource format: /me/calendar/events/{eventId}
    const match = resource.match(/\/events\/([^\/]+)/);
    return match ? match[1] : null;
  }

  private async executeWithRetry<T>(fn: () => Promise<T>, label: string, attempts: number = 3): Promise<T> {
    let lastError: any;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        console.warn(`[CalendarWebhookProcessor] ${label} failed`, {
          attempt,
          attempts,
          error: error instanceof Error ? error.message : error
        });
        if (attempt < attempts) {
          await this.sleep(attempt * 250);
        }
      }
    }
    throw lastError;
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
