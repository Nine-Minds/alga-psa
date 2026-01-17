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
import logger from '@alga-psa/core/logger';
import { createTenantKnex, runWithTenant } from 'server/src/lib/db';
import { TenantEmailService } from 'server/src/lib/services/TenantEmailService';
import { StaticTemplateProcessor } from 'server/src/lib/email/tenant/templateProcessors';
import { CalendarProviderConfig } from '@/interfaces/calendar.interfaces';
import { IScheduleEntry } from '@/interfaces/schedule.interfaces';
import { isValidEmail } from '../../utils/validation';

let syncService: CalendarSyncService;
let providerService: CalendarProviderService;

/**
 * Handle schedule entry created event
 */
async function handleScheduleEntryCreated(event: ScheduleEntryCreatedEvent): Promise<void> {
  const { entryId, tenantId, changes } = event.payload;

  if (!tenantId) {
    logger.warn('[CalendarSyncSubscriber] Received SCHEDULE_ENTRY_CREATED with missing tenantId', { entryId });
    return;
  }

  try {
    await runWithTenant(tenantId, async () => {
      logger.info('[CalendarSyncSubscriber] Handling SCHEDULE_ENTRY_CREATED event', {
        entryId,
        tenantId
      });

      // Get the entry's assigned user IDs from the event payload
      const assignedUserIds = changes?.assignedUserIds || [];
      if (assignedUserIds.length === 0) {
        logger.debug('[CalendarSyncSubscriber] Entry has no assigned users, skipping sync', { entryId });
        return;
      }

      if (!providerService) {
        providerService = new CalendarProviderService();
      }

      const providers = await providerService.getProviders({
        tenant: tenantId,
        isActive: true
      });

      if (!providers.length) {
        logger.debug('[CalendarSyncSubscriber] No active providers found for tenant', { tenantId });
        return;
      }

      if (!syncService) {
        syncService = new CalendarSyncService();
      }

      for (const provider of providers) {
        if (provider.tenant !== tenantId) {
          logger.warn('[CalendarSyncSubscriber] Skipping provider with mismatched tenant', {
            providerId: provider.id,
            providerTenant: provider.tenant,
            eventTenant: tenantId
          });
          continue;
        }

        // Only sync to providers that have a user_id (user-specific sync)
        // Skip legacy tenant-level providers without a user_id
        if (!provider.user_id) {
          logger.debug('[CalendarSyncSubscriber] Skipping provider - no user_id (legacy tenant-level provider)', {
            providerId: provider.id
          });
          continue;
        }

        // Only sync to providers where the provider's user is assigned to the entry
        if (!assignedUserIds.includes(provider.user_id)) {
          logger.debug('[CalendarSyncSubscriber] Skipping provider - user not assigned to entry', {
            providerId: provider.id,
            providerUserId: provider.user_id,
            entryAssignees: assignedUserIds
          });
          continue;
        }

        if (provider.sync_direction !== 'to_external' && provider.sync_direction !== 'bidirectional') {
          continue;
        }

        try {
          const result = await syncService.syncScheduleEntryToExternal(entryId, provider.id);

          if (result.success) {
            logger.info('[CalendarSyncSubscriber] Synced schedule entry to calendar provider', {
              entryId,
              calendarProviderId: provider.id,
              externalEventId: result.externalEventId
            });
          } else {
            logger.warn('[CalendarSyncSubscriber] Failed to sync schedule entry to calendar provider', {
              entryId,
              calendarProviderId: provider.id,
              error: result.error
            });
          }
        } catch (error: any) {
          logger.error('[CalendarSyncSubscriber] Error syncing schedule entry to calendar provider', {
            entryId,
            calendarProviderId: provider.id,
            error: error.message || error
          });
        }
      }
    });
  } catch (error: any) {
    logger.error('[CalendarSyncSubscriber] Error handling SCHEDULE_ENTRY_CREATED event', {
      entryId,
      tenantId,
      error: error.message || error
    });
  }
}

/**
 * Handle schedule entry updated event
 */
async function handleScheduleEntryUpdated(event: ScheduleEntryUpdatedEvent): Promise<void> {
  const { entryId, tenantId, changes } = event.payload;

  if (!tenantId) {
    logger.warn('[CalendarSyncSubscriber] Received SCHEDULE_ENTRY_UPDATED with missing tenantId', { entryId });
    return;
  }

  try {
    await runWithTenant(tenantId, async () => {
      logger.info('[CalendarSyncSubscriber] Handling SCHEDULE_ENTRY_UPDATED event', {
        entryId,
        tenantId
      });

      // Get assigned user IDs from the updated entry (after state)
      const assignedUserIds = changes?.after?.assignedUserIds || [];

      if (!providerService) {
        providerService = new CalendarProviderService();
      }

      const providers = await providerService.getProviders({
        tenant: tenantId,
        isActive: true
      });

      if (!providers.length) {
        logger.debug('[CalendarSyncSubscriber] No active providers found for tenant', { tenantId });
        return;
      }

      if (!syncService) {
        syncService = new CalendarSyncService();
      }

      for (const provider of providers) {
        if (provider.tenant !== tenantId) {
          logger.warn('[CalendarSyncSubscriber] Skipping provider with mismatched tenant', {
            providerId: provider.id,
            providerTenant: provider.tenant,
            eventTenant: tenantId
          });
          continue;
        }

        // Only sync to providers that have a user_id (user-specific sync)
        // Skip legacy tenant-level providers without a user_id
        if (!provider.user_id) {
          logger.debug('[CalendarSyncSubscriber] Skipping provider - no user_id (legacy tenant-level provider)', {
            providerId: provider.id
          });
          continue;
        }

        // Only sync to providers where the provider's user is assigned to the entry
        // For updates, we also need to handle the case where user was unassigned (delete from their calendar)
        const userIsAssigned = assignedUserIds.includes(provider.user_id);
        const userWasAssigned = (changes?.before?.assignedUserIds || []).includes(provider.user_id);

        if (!userIsAssigned && !userWasAssigned) {
          logger.debug('[CalendarSyncSubscriber] Skipping provider - user not assigned to entry', {
            providerId: provider.id,
            providerUserId: provider.user_id,
            entryAssignees: assignedUserIds
          });
          continue;
        }

        if (provider.sync_direction !== 'to_external' && provider.sync_direction !== 'bidirectional') {
          continue;
        }

        try {
          // If user was assigned but no longer is, delete from their calendar
          if (userWasAssigned && !userIsAssigned && provider.user_id) {
            const result = await syncService.deleteScheduleEntry(entryId, provider.id, 'all');
            if (result.success) {
              logger.info('[CalendarSyncSubscriber] Removed entry from calendar after user unassignment', {
                entryId,
                calendarProviderId: provider.id,
                userId: provider.user_id
              });
            }
            continue;
          }

          const result = await syncService.syncScheduleEntryToExternal(entryId, provider.id);

          if (result.success) {
            logger.info('[CalendarSyncSubscriber] Synced schedule entry update to calendar provider', {
              entryId,
              calendarProviderId: provider.id
            });
          } else {
            logger.warn('[CalendarSyncSubscriber] Failed to sync schedule entry update to calendar provider', {
              entryId,
              calendarProviderId: provider.id,
              error: result.error
            });
          }
        } catch (error: any) {
          logger.error('[CalendarSyncSubscriber] Error syncing schedule entry update to calendar provider', {
            entryId,
            calendarProviderId: provider.id,
            error: error.message || error
          });
        }
      }
    });
  } catch (error: any) {
    logger.error('[CalendarSyncSubscriber] Error handling SCHEDULE_ENTRY_UPDATED event', {
      entryId,
      tenantId,
      error: error.message || error
    });
  }
}

/**
 * Handle schedule entry deleted event
 */
async function handleScheduleEntryDeleted(event: ScheduleEntryDeletedEvent): Promise<void> {
  const { entryId, tenantId, changes } = event.payload;

  if (!tenantId) {
    logger.warn('[CalendarSyncSubscriber] Received SCHEDULE_ENTRY_DELETED with missing tenantId', { entryId });
    return;
  }

  try {
    await runWithTenant(tenantId, async () => {
      logger.info('[CalendarSyncSubscriber] Handling SCHEDULE_ENTRY_DELETED event', {
        entryId,
        tenantId
      });

      // Get assigned user IDs from the deleted entry (before state)
      const assignedUserIds = changes?.before?.assignedUserIds || [];

      if (!providerService) {
        providerService = new CalendarProviderService();
      }

      const providers = await providerService.getProviders({
        tenant: tenantId,
        isActive: true
      });

      if (!providers.length) {
        logger.debug('[CalendarSyncSubscriber] No active providers found for tenant', { tenantId });
        return;
      }

      if (!syncService) {
        syncService = new CalendarSyncService();
      }

      for (const provider of providers) {
        if (provider.tenant !== tenantId) {
          logger.warn('[CalendarSyncSubscriber] Skipping provider with mismatched tenant', {
            providerId: provider.id,
            providerTenant: provider.tenant,
            eventTenant: tenantId
          });
          continue;
        }

        // Only sync to providers that have a user_id (user-specific sync)
        // Skip legacy tenant-level providers without a user_id
        if (!provider.user_id) {
          logger.debug('[CalendarSyncSubscriber] Skipping provider - no user_id (legacy tenant-level provider)', {
            providerId: provider.id
          });
          continue;
        }

        // Only delete from providers where the provider's user was assigned to the entry
        if (assignedUserIds.length > 0 && !assignedUserIds.includes(provider.user_id)) {
          logger.debug('[CalendarSyncSubscriber] Skipping provider - user was not assigned to entry', {
            providerId: provider.id,
            providerUserId: provider.user_id,
            entryAssignees: assignedUserIds
          });
          continue;
        }

        if (provider.sync_direction !== 'to_external' && provider.sync_direction !== 'bidirectional') {
          continue;
        }

        try {
          const result = await syncService.deleteScheduleEntry(entryId, provider.id, 'all');

          if (result.success) {
            logger.info('[CalendarSyncSubscriber] Deleted schedule entry from calendar provider', {
              entryId,
              calendarProviderId: provider.id
            });
          } else {
            logger.warn('[CalendarSyncSubscriber] Failed to delete schedule entry from calendar provider', {
              entryId,
              calendarProviderId: provider.id,
              error: result.error
            });
          }
        } catch (error: any) {
          logger.error('[CalendarSyncSubscriber] Error deleting schedule entry from calendar provider', {
            entryId,
            calendarProviderId: provider.id,
            error: error.message || error
          });
        }
      }
    });
  } catch (error: any) {
    logger.error('[CalendarSyncSubscriber] Error handling SCHEDULE_ENTRY_DELETED event', {
      entryId,
      tenantId,
      error: error.message || error
    });
  }
}

/**
 * Handle calendar conflict detected event
 */
async function handleCalendarConflictDetected(event: CalendarConflictDetectedEvent): Promise<void> {
  const {
    mappingId,
    tenantId,
    scheduleEntryId,
    externalEventId,
    calendarProviderId,
    algaLastModified,
    externalLastModified
  } = event.payload;

  if (!tenantId) {
    logger.warn('[CalendarSyncSubscriber] Received CALENDAR_CONFLICT_DETECTED with missing tenantId', {
      mappingId,
      scheduleEntryId,
      externalEventId
    });
    return;
  }

  try {
    await runWithTenant(tenantId, async () => {
      logger.info('[CalendarSyncSubscriber] Handling CALENDAR_CONFLICT_DETECTED event', {
        mappingId,
        tenantId,
        scheduleEntryId,
        externalEventId,
        calendarProviderId
      });

      const { knex } = await createTenantKnex();

      const mapping = await knex('calendar_event_mappings')
        .where('id', mappingId)
        .andWhere('tenant', tenantId)
        .first();

      if (!mapping) {
        logger.warn('[CalendarSyncSubscriber] Conflict mapping not found', {
          mappingId,
          tenantId
        });
        return;
      }

      if (mapping.sync_error_message && mapping.sync_error_message.includes('notification sent')) {
        logger.info('[CalendarSyncSubscriber] Conflict notification already sent for mapping', {
          mappingId
        });
        return;
      }

      if (!providerService) {
        providerService = new CalendarProviderService();
      }

      const provider = await providerService.getProvider(calendarProviderId, tenantId, {
        includeSecrets: false
      });

      const scheduleEntry = await knex('schedule_entries')
        .where('entry_id', scheduleEntryId)
        .andWhere('tenant', tenantId)
        .first();

      const assignees = await knex('schedule_entry_assignees')
        .where('entry_id', scheduleEntryId)
        .andWhere('tenant', tenantId)
        .select('user_id');

      const assigneeIds = assignees.map((row) => row.user_id).filter(Boolean);

      if (assigneeIds.length === 0) {
        logger.warn('[CalendarSyncSubscriber] Schedule entry conflict with no assigned users', {
          mappingId,
          scheduleEntryId
        });
        return;
      }

      const users = await knex('users')
        .whereIn('user_id', assigneeIds)
        .andWhere('tenant', tenantId)
        .andWhere('is_inactive', false)
        .select('user_id', 'email', 'first_name', 'last_name');

      const recipients = Array.from(
        new Set(
          users
            .map((user) => user.email)
            .filter((email): email is string => isValidEmail(email))
        )
      );

      if (recipients.length === 0) {
        logger.warn('[CalendarSyncSubscriber] No reachable recipients for calendar conflict notification', {
          mappingId,
          scheduleEntryId
        });
        return;
      }

      const subject = buildConflictEmailSubject(scheduleEntry?.title, provider?.name);
      const htmlBody = buildConflictEmailHtml({
        scheduleEntry,
        provider,
        externalEventId,
        algaLastModified,
        externalLastModified
      });
      const textBody = buildConflictEmailText({
        scheduleEntry,
        provider,
        externalEventId,
        algaLastModified,
        externalLastModified
      });

      const processor = new StaticTemplateProcessor(subject, htmlBody, textBody);
      const notifiedAt = new Date().toISOString();

      for (const recipient of recipients) {
        try {
          await TenantEmailService.sendEmail({
            tenantId,
            to: recipient,
            templateProcessor: processor
          });
          logger.info('[CalendarSyncSubscriber] Sent conflict notification email', {
            mappingId,
            recipient
          });
        } catch (emailError: any) {
          logger.error('[CalendarSyncSubscriber] Failed to send conflict notification email', {
            mappingId,
            recipient,
            error: emailError?.message || emailError
          });
        }
      }

      const baseMessage =
        mapping.sync_error_message ||
        'Conflict detected: both calendars have been modified';
      const updatedMessage = `${baseMessage} (notification sent ${notifiedAt})`;

      await knex('calendar_event_mappings')
        .where('id', mappingId)
        .andWhere('tenant', tenantId)
        .update({
          sync_error_message: updatedMessage,
          updated_at: new Date().toISOString()
        });
    });
  } catch (error: any) {
    logger.error('[CalendarSyncSubscriber] Error handling CALENDAR_CONFLICT_DETECTED event', {
      mappingId,
      tenantId,
      scheduleEntryId,
      error: error.message || error
    });
  }
}

function buildConflictEmailSubject(title?: string | null, providerName?: string | null): string {
  const safeTitle = title && title.trim().length > 0 ? title.trim() : 'schedule entry';
  const providerSuffix = providerName && providerName.trim().length > 0 ? ` (${providerName.trim()})` : '';
  return `Calendar sync conflict detected for ${safeTitle}${providerSuffix}`;
}

function buildConflictEmailHtml(params: {
  scheduleEntry?: Partial<IScheduleEntry> | null;
  provider?: CalendarProviderConfig | null;
  externalEventId: string;
  algaLastModified?: string;
  externalLastModified?: string;
}): string {
  const { scheduleEntry, provider, externalEventId, algaLastModified, externalLastModified } = params;
  const title = scheduleEntry?.title || 'Schedule entry';
  const providerName = provider?.name || provider?.provider_type || 'calendar provider';

  return `
    <p>Hello,</p>
    <p>A calendar sync conflict was detected while syncing <strong>${escapeHtml(title)}</strong> with <strong>${escapeHtml(providerName)}</strong>.</p>
    <ul>
      <li><strong>Scheduled start:</strong> ${escapeHtml(formatDateTime(scheduleEntry?.scheduled_start))}</li>
      <li><strong>Scheduled end:</strong> ${escapeHtml(formatDateTime(scheduleEntry?.scheduled_end))}</li>
      <li><strong>External event ID:</strong> ${escapeHtml(externalEventId)}</li>
      <li><strong>Alga last modified:</strong> ${escapeHtml(formatDateTime(algaLastModified))}</li>
      <li><strong>External last modified:</strong> ${escapeHtml(formatDateTime(externalLastModified))}</li>
    </ul>
    <p>Please open <strong>Settings → Calendar Integrations</strong> in Alga PSA to review and resolve this conflict.</p>
    <p>If you no longer need this sync, you can disable the provider to suppress further notifications.</p>
    <p>— Alga PSA Calendar Sync</p>
  `;
}

function buildConflictEmailText(params: {
  scheduleEntry?: Partial<IScheduleEntry> | null;
  provider?: CalendarProviderConfig | null;
  externalEventId: string;
  algaLastModified?: string;
  externalLastModified?: string;
}): string {
  const { scheduleEntry, provider, externalEventId, algaLastModified, externalLastModified } = params;
  const title = scheduleEntry?.title || 'Schedule entry';
  const providerName = provider?.name || provider?.provider_type || 'calendar provider';

  return [
    'Hello,',
    '',
    `A calendar sync conflict was detected while syncing "${title}" with ${providerName}.`,
    '',
    `Scheduled start: ${formatDateTime(scheduleEntry?.scheduled_start)}`,
    `Scheduled end: ${formatDateTime(scheduleEntry?.scheduled_end)}`,
    `External event ID: ${externalEventId}`,
    `Alga last modified: ${formatDateTime(algaLastModified)}`,
    `External last modified: ${formatDateTime(externalLastModified)}`,
    '',
    'Open Settings → Calendar Integrations in Alga PSA to review and resolve this conflict.',
    'You can disable the provider if you no longer want to sync this calendar.',
    '',
    '— Alga PSA Calendar Sync'
  ].join('\n');
}

function formatDateTime(value: unknown): string {
  if (!value) {
    return '—';
  }

  const date = value instanceof Date ? value : new Date(value as string);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toISOString();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Register calendar sync subscriber
 */
export async function registerCalendarSyncSubscriber(): Promise<void> {
  try {
    logger.info('[CalendarSyncSubscriber] Starting registration');

    const eventBus = getEventBus();

    // Subscribe to schedule entry events
    // @ts-ignore - Calendar events are extensions to the core EventType
    await eventBus.subscribe('SCHEDULE_ENTRY_CREATED', handleScheduleEntryCreated);
    // @ts-ignore - Calendar events are extensions to the core EventType
    await eventBus.subscribe('SCHEDULE_ENTRY_UPDATED', handleScheduleEntryUpdated);
    // @ts-ignore - Calendar events are extensions to the core EventType
    await eventBus.subscribe('SCHEDULE_ENTRY_DELETED', handleScheduleEntryDeleted);
    // @ts-ignore - Calendar events are extensions to the core EventType
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
