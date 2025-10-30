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
    try {
      console.log('📅 Processing Google Calendar webhook notification');

      // Decode Pub/Sub message
      const messageData = pubsubMessage.data ? 
        JSON.parse(Buffer.from(pubsubMessage.data, 'base64').toString()) : 
        {};

      if (!messageData || !subscriptionName) {
        console.warn('⚠️ Invalid Google Calendar notification format');
        return { success: 0, failed: 1 };
      }

      // Get provider by subscription name
      const provider = await this.getProviderByGoogleSubscription(subscriptionName);
      if (!provider) {
        console.error(`❌ Provider not found for subscription: ${subscriptionName}`);
        return { success: 0, failed: 1 };
      }

      // Check sync direction
      if (provider.sync_direction === 'to_external') {
        console.log('⚠️ Provider configured for one-way sync to external only, skipping webhook');
        return { success: 0, failed: 0 };
      }

      // Get adapter and process webhook
      const adapter = await this.createAdapter(provider);
      await adapter.connect();

      // Process webhook notification to get changed event IDs
      const eventIds = await adapter.processWebhookNotification({
        message: pubsubMessage,
        subscription: subscriptionName
      });

      // If no specific event IDs, we need to sync based on resource state
      // For Google Calendar, we may need to query for changes
      if (eventIds.length === 0 && messageData.resourceState) {
        // Query calendar for changes since last sync
        const now = new Date();
        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const events = await adapter.listEvents(yesterday, now);
        eventIds.push(...events.map(e => e.id));
      }

      let successCount = 0;
      let failedCount = 0;

      // Sync each changed event
      for (const eventId of eventIds) {
        try {
          const result = await this.syncService.syncExternalEventToSchedule(
            eventId,
            provider.id
          );

          if (result.success) {
            successCount++;
            console.log(`✅ Synced Google Calendar event ${eventId} to schedule entry`);
          } else {
            failedCount++;
            console.error(`❌ Failed to sync Google Calendar event ${eventId}:`, result.error);
          }
        } catch (error: any) {
          failedCount++;
          console.error(`❌ Error syncing Google Calendar event ${eventId}:`, error.message);
        }
      }

      return { success: successCount, failed: failedCount };
    } catch (error: any) {
      console.error('❌ Error processing Google Calendar webhook:', error);
      return { success: 0, failed: 1 };
    }
  }

  /**
   * Process Microsoft Calendar webhook notification
   */
  async processMicrosoftWebhook(
    notifications: any[]
  ): Promise<{ success: number; failed: number }> {
    let successCount = 0;
    let failedCount = 0;

    for (const notification of notifications) {
      try {
        if (!this.isValidMicrosoftNotification(notification)) {
          console.warn('⚠️ Invalid Microsoft Calendar notification format:', notification);
          failedCount++;
          continue;
        }

        // Get provider by subscription ID
        const provider = await this.getProviderByMicrosoftSubscription(notification.subscriptionId);
        if (!provider) {
          console.error(`❌ Provider not found for subscription: ${notification.subscriptionId}`);
          failedCount++;
          continue;
        }

        // Check sync direction
        if (provider.sync_direction === 'to_external') {
          console.log('⚠️ Provider configured for one-way sync to external only, skipping webhook');
          continue;
        }

        // Validate client state
        const vendorConfig = provider.provider_config || {};
        if (vendorConfig.webhookVerificationToken) {
          if (notification.clientState !== vendorConfig.webhookVerificationToken) {
            console.error(`❌ Invalid client state for provider ${provider.id}`);
            failedCount++;
            continue;
          }
        }

        // Extract event ID from notification
        const eventId = notification.resourceData?.id || 
          this.extractEventIdFromResource(notification.resource);

        if (!eventId) {
          console.error('❌ Could not extract event ID from notification');
          failedCount++;
          continue;
        }

        // Determine change type
        const changeType = notification.changeType.toLowerCase();

        // Handle deletion
        if (changeType === 'deleted') {
          // Find mapping and delete schedule entry
          const { knex, tenant } = await import('../../lib/db').then(m => m.createTenantKnex());
          const mapping = await knex('calendar_event_mappings')
            .where('external_event_id', eventId)
            .andWhere('calendar_provider_id', provider.id)
            .andWhere('tenant', tenant)
            .first();

          if (mapping) {
            try {
              await this.syncService.deleteScheduleEntry(
                mapping.schedule_entry_id,
                provider.id,
                'all'
              );
              successCount++;
              console.log(`✅ Deleted schedule entry for external event ${eventId}`);
            } catch (error: any) {
              failedCount++;
              console.error(`❌ Failed to delete schedule entry:`, error.message);
            }
          }
          continue;
        }

        // Handle created/updated
        const result = await this.syncService.syncExternalEventToSchedule(
          eventId,
          provider.id
        );

        if (result.success) {
          successCount++;
          console.log(`✅ Synced Microsoft Calendar event ${eventId} to schedule entry`);
        } else {
          failedCount++;
          console.error(`❌ Failed to sync Microsoft Calendar event ${eventId}:`, result.error);
        }
      } catch (error: any) {
        console.error('❌ Error processing Microsoft Calendar notification:', error);
        failedCount++;
      }
    }

    return { success: successCount, failed: failedCount };
  }

  /**
   * Get provider by Google subscription name
   */
  private async getProviderByGoogleSubscription(subscriptionName: string): Promise<CalendarProviderConfig | null> {
    try {
      const { knex, tenant } = await import('../../lib/db').then(m => m.createTenantKnex());
      
      const row = await knex('google_calendar_provider_config as gc')
        .join('calendar_providers as cp', function() {
          this.on('gc.calendar_provider_id', '=', 'cp.id')
            .andOn('gc.tenant', '=', 'cp.tenant');
        })
        .where('gc.pubsub_subscription_name', subscriptionName)
        .andWhere('cp.is_active', true)
        .first('cp.*', 'gc.*');

      if (!row) {
        return null;
      }

      return this.providerService.getProvider(row.id);
    } catch (error: any) {
      console.error('Failed to get provider by Google subscription:', error);
      return null;
    }
  }

  /**
   * Get provider by Microsoft subscription ID
   */
  private async getProviderByMicrosoftSubscription(subscriptionId: string): Promise<CalendarProviderConfig | null> {
    try {
      const { knex, tenant } = await import('../../lib/db').then(m => m.createTenantKnex());
      
      const row = await knex('microsoft_calendar_provider_config as mc')
        .join('calendar_providers as cp', function() {
          this.on('mc.calendar_provider_id', '=', 'cp.id')
            .andOn('mc.tenant', '=', 'cp.tenant');
        })
        .where('mc.webhook_subscription_id', subscriptionId)
        .andWhere('cp.is_active', true)
        .first('cp.*', 'mc.*');

      if (!row) {
        return null;
      }

      return this.providerService.getProvider(row.id);
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
}

