/**
 * Calendar Sync Event Subscriber
 * Handles schedule entry events and triggers calendar synchronization
 */

import { getEventBus } from '../index';
import { 
  ScheduleEntryCreatedEvent, 
  ScheduleEntryUpdatedEvent, 
  ScheduleEntryDeletedEvent,
  CalendarConflictDetectedEvent,
  EventType 
} from '../events';
import { CalendarSyncService } from '@/services/calendar/CalendarSyncService';
import { CalendarProviderService } from '@/services/calendar/CalendarProviderService';
import logger from '@shared/core/logger';

let syncService: CalendarSyncService;
let providerService: CalendarProviderService;

/**
 * Handle schedule entry created event
 */
async function handleScheduleEntryCreated(event: ScheduleEntryCreatedEvent): Promise<void> {
  try {
    const { entryId, tenantId } = event.payload;
    
    logger.info('[CalendarSyncSubscriber] Handling SCHEDULE_ENTRY_CREATED event', {
      entryId,
      tenantId
    });

    // Get active calendar providers for this tenant
    if (!providerService) {
      providerService = new CalendarProviderService();
    }
    
    const providers = await providerService.getProviders({
      tenant: tenantId,
      active: true
    });

    // Sync to external calendars for providers configured to sync to external
    for (const provider of providers) {
      if (provider.sync_direction === 'to_external' || provider.sync_direction === 'bidirectional') {
        try {
          if (!syncService) {
            syncService = new CalendarSyncService();
          }
          
          const result = await syncService.syncScheduleEntryToExternal(entryId, provider.id);
          
          if (result.success) {
            logger.info('[CalendarSyncSubscriber] Successfully synced schedule entry to calendar', {
              entryId,
              calendarProviderId: provider.id,
              externalEventId: result.externalEventId
            });
          } else {
            logger.warn('[CalendarSyncSubscriber] Failed to sync schedule entry to calendar', {
              entryId,
              calendarProviderId: provider.id,
              error: result.error
            });
          }
        } catch (error: any) {
          logger.error('[CalendarSyncSubscriber] Error syncing schedule entry to calendar', {
            entryId,
            calendarProviderId: provider.id,
            error: error.message
          });
        }
      }
    }
  } catch (error: any) {
    logger.error('[CalendarSyncSubscriber] Error handling SCHEDULE_ENTRY_CREATED event', {
      error: error.message
    });
  }
}

/**
 * Handle schedule entry updated event
 */
async function handleScheduleEntryUpdated(event: ScheduleEntryUpdatedEvent): Promise<void> {
  try {
    const { entryId, tenantId } = event.payload;
    
    logger.info('[CalendarSyncSubscriber] Handling SCHEDULE_ENTRY_UPDATED event', {
      entryId,
      tenantId
    });

    // Get active calendar providers for this tenant
    if (!providerService) {
      providerService = new CalendarProviderService();
    }
    
    const providers = await providerService.getProviders({
      tenant: tenantId,
      active: true
    });

    // Sync to external calendars for providers configured to sync to external
    for (const provider of providers) {
      if (provider.sync_direction === 'to_external' || provider.sync_direction === 'bidirectional') {
        try {
          if (!syncService) {
            syncService = new CalendarSyncService();
          }
          
          const result = await syncService.syncScheduleEntryToExternal(entryId, provider.id);
          
          if (result.success) {
            logger.info('[CalendarSyncSubscriber] Successfully synced schedule entry update to calendar', {
              entryId,
              calendarProviderId: provider.id
            });
          } else {
            logger.warn('[CalendarSyncSubscriber] Failed to sync schedule entry update to calendar', {
              entryId,
              calendarProviderId: provider.id,
              error: result.error
            });
          }
        } catch (error: any) {
          logger.error('[CalendarSyncSubscriber] Error syncing schedule entry update to calendar', {
            entryId,
            calendarProviderId: provider.id,
            error: error.message
          });
        }
      }
    }
  } catch (error: any) {
    logger.error('[CalendarSyncSubscriber] Error handling SCHEDULE_ENTRY_UPDATED event', {
      error: error.message
    });
  }
}

/**
 * Handle schedule entry deleted event
 */
async function handleScheduleEntryDeleted(event: ScheduleEntryDeletedEvent): Promise<void> {
  try {
    const { entryId, tenantId } = event.payload;
    
    logger.info('[CalendarSyncSubscriber] Handling SCHEDULE_ENTRY_DELETED event', {
      entryId,
      tenantId
    });

    // Get active calendar providers for this tenant
    if (!providerService) {
      providerService = new CalendarProviderService();
    }
    
    const providers = await providerService.getProviders({
      tenant: tenantId,
      active: true
    });

    // Delete from external calendars for providers configured to sync to external
    for (const provider of providers) {
      if (provider.sync_direction === 'to_external' || provider.sync_direction === 'bidirectional') {
        try {
          if (!syncService) {
            syncService = new CalendarSyncService();
          }
          
          const result = await syncService.deleteScheduleEntry(entryId, provider.id, 'all');
          
          if (result.success) {
            logger.info('[CalendarSyncSubscriber] Successfully deleted schedule entry from calendar', {
              entryId,
              calendarProviderId: provider.id
            });
          } else {
            logger.warn('[CalendarSyncSubscriber] Failed to delete schedule entry from calendar', {
              entryId,
              calendarProviderId: provider.id,
              error: result.error
            });
          }
        } catch (error: any) {
          logger.error('[CalendarSyncSubscriber] Error deleting schedule entry from calendar', {
            entryId,
            calendarProviderId: provider.id,
            error: error.message
          });
        }
      }
    }
  } catch (error: any) {
    logger.error('[CalendarSyncSubscriber] Error handling SCHEDULE_ENTRY_DELETED event', {
      error: error.message
    });
  }
}

/**
 * Handle calendar conflict detected event
 */
async function handleCalendarConflictDetected(event: CalendarConflictDetectedEvent): Promise<void> {
  try {
    const { mappingId, tenantId, scheduleEntryId, externalEventId } = event.payload;
    
    logger.info('[CalendarSyncSubscriber] Handling CALENDAR_CONFLICT_DETECTED event', {
      mappingId,
      tenantId,
      scheduleEntryId,
      externalEventId
    });

    // TODO: Send notification to user about conflict
    // This could be done via:
    // 1. In-app notification
    // 2. Email notification
    // 3. UI component that displays conflicts
    
    logger.info('[CalendarSyncSubscriber] Conflict detected, user notification should be sent', {
      mappingId,
      scheduleEntryId,
      externalEventId
    });
  } catch (error: any) {
    logger.error('[CalendarSyncSubscriber] Error handling CALENDAR_CONFLICT_DETECTED event', {
      error: error.message
    });
  }
}

/**
 * Register calendar sync subscriber
 */
export async function registerCalendarSyncSubscriber(): Promise<void> {
  try {
    logger.info('[CalendarSyncSubscriber] Starting registration');
    
    const eventBus = getEventBus();
    
    // Subscribe to schedule entry events
    await eventBus.subscribe('SCHEDULE_ENTRY_CREATED', handleScheduleEntryCreated);
    await eventBus.subscribe('SCHEDULE_ENTRY_UPDATED', handleScheduleEntryUpdated);
    await eventBus.subscribe('SCHEDULE_ENTRY_DELETED', handleScheduleEntryDeleted);
    await eventBus.subscribe('CALENDAR_CONFLICT_DETECTED', handleCalendarConflictDetected);
    
    logger.info('[CalendarSyncSubscriber] Successfully registered all calendar sync event handlers');
  } catch (error: any) {
    logger.error('[CalendarSyncSubscriber] Failed to register calendar sync subscriber', {
      error: error.message
    });
    throw error;
  }
}

/**
 * Unregister calendar sync subscriber
 */
export async function unregisterCalendarSyncSubscriber(): Promise<void> {
  try {
    logger.info('[CalendarSyncSubscriber] Unregistering calendar sync subscriber');
    
    const eventBus = getEventBus();
    
    // Note: EventBus unsubscribe requires the handler function reference
    // For now, we'll just log the unregistration
    // Full unregistration would require storing handler references
    
    logger.info('[CalendarSyncSubscriber] Calendar sync subscriber unregistered');
  } catch (error: any) {
    logger.error('[CalendarSyncSubscriber] Failed to unregister calendar sync subscriber', {
      error: error.message
    });
  }
}

