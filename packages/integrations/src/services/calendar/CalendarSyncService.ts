// @ts-nocheck
// TODO: This file needs refactoring - ScheduleEntry model method signatures have changed
/**
 * Calendar Sync Service
 * Handles bidirectional synchronization between Alga schedule entries and external calendars
 */

import { createTenantKnex } from '@alga-psa/db';
import { withTransaction } from '@alga-psa/db';
import type { CalendarProviderConfig, CalendarEventMapping, CalendarSyncResult, ExternalCalendarEvent, IScheduleEntry } from '@alga-psa/types';
import { CalendarProviderService } from './CalendarProviderService';
import { GoogleCalendarAdapter } from './providers/GoogleCalendarAdapter';
import { MicrosoftCalendarAdapter } from './providers/MicrosoftCalendarAdapter';
import { BaseCalendarAdapter } from './providers/base/BaseCalendarAdapter';
import { mapScheduleEntryToExternalEvent, mapExternalEventToScheduleEntry } from '../../utils/calendar/eventMapping';
import ScheduleEntry from '@alga-psa/scheduling/models/scheduleEntry';
import { v4 as uuidv4 } from 'uuid';
import { publishEvent } from '@alga-psa/event-bus/publishers';

export class CalendarSyncService {
  private providerService: CalendarProviderService;

  constructor() {
    this.providerService = new CalendarProviderService();
  }

  /**
   * Sync a schedule entry to an external calendar
   */
  async syncScheduleEntryToExternal(
    entryId: string,
    calendarProviderId: string,
    force: boolean = false,
    tenantContext?: string
  ): Promise<CalendarSyncResult> {
    try {
      const { knex, tenant } = await createTenantKnex(tenantContext);
      if (!tenant) {
        throw new Error('Tenant context is required for calendar synchronization');
      }
      
      // Get the schedule entry
      const entry = await ScheduleEntry.get(knex, entryId);
      if (!entry) {
        return {
          success: false,
          error: `Schedule entry ${entryId} not found`
        };
      }

      // Get the calendar provider
      const provider = await this.providerService.getProvider(calendarProviderId, tenant);
      if (!provider) {
        return {
          success: false,
          error: `Calendar provider ${calendarProviderId} not found`
        };
      }

      // Check sync direction
      if (provider.sync_direction === 'from_external') {
        return {
          success: false,
          error: 'Provider is configured for one-way sync from external calendar only'
        };
      }

      // Get or create adapter
      const adapter = await this.createAdapter(provider);
      await adapter.connect();

      // Check for existing mapping
      const existingMapping = await this.getMappingByScheduleEntry(entryId, calendarProviderId, tenant);

      const result = await withTransaction(knex, async (trx) => {
        if (existingMapping) {
          // Update existing event
          const externalEvent = await mapScheduleEntryToExternalEvent(entry, provider.provider_type);
          
          // Update event in external calendar
          const updatedEvent = await adapter.updateEvent(existingMapping.external_event_id, externalEvent);
          
          // Update mapping
          await trx('calendar_event_mappings')
            .where('id', existingMapping.id)
            .andWhere('tenant', tenant)
            .update({
              sync_status: 'synced',
              last_synced_at: new Date().toISOString(),
              alga_last_modified: entry.updated_at instanceof Date ? entry.updated_at.toISOString() : new Date(entry.updated_at).toISOString(),
              external_last_modified: updatedEvent.updated,
              sync_error_message: null,
              updated_at: new Date().toISOString()
            });

          const syncResult = {
            success: true,
            mapping: {
              ...existingMapping,
              sync_status: 'synced' as const,
              last_synced_at: new Date().toISOString(),
              alga_last_modified: entry.updated_at instanceof Date ? entry.updated_at.toISOString() : new Date(entry.updated_at).toISOString(),
              external_last_modified: updatedEvent.updated
            },
            externalEventId: updatedEvent.id
          };

          await this.markProviderConnected(provider.id);
          return syncResult;
        } else {
          // Create new event
          const externalEvent = await mapScheduleEntryToExternalEvent(entry, provider.provider_type);
          
          // Create event in external calendar
          const createdEvent = await adapter.createEvent(externalEvent);
          
          // Create mapping
          const [mapping] = await trx('calendar_event_mappings')
            .insert({
              id: uuidv4(),
              tenant,
              calendar_provider_id: calendarProviderId,
              schedule_entry_id: entryId,
              external_event_id: createdEvent.id,
              sync_status: 'synced',
              last_synced_at: new Date().toISOString(),
              sync_direction: 'to_external',
              alga_last_modified: entry.updated_at instanceof Date ? entry.updated_at.toISOString() : new Date(entry.updated_at).toISOString(),
              external_last_modified: createdEvent.updated,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .returning('*');

          const syncResult = {
            success: true,
            mapping: this.mapDbRowToMapping(mapping),
            externalEventId: createdEvent.id
          };

          await this.markProviderConnected(provider.id);
          return syncResult;
        }
      });
      return result;
    } catch (error: any) {
      console.error(`Failed to sync schedule entry ${entryId} to external calendar:`, error);
      
      // Update mapping status to error if it exists
      try {
        const { knex: errorKnex, tenant: errorTenant } = await createTenantKnex(tenantContext);
        if (errorTenant) {
          const mapping = await this.getMappingByScheduleEntry(entryId, calendarProviderId, errorTenant);
          if (mapping) {
            await errorKnex('calendar_event_mappings')
              .where('id', mapping.id)
              .andWhere('tenant', errorTenant)
              .update({
                sync_status: 'error',
                sync_error_message: error.message,
                updated_at: new Date().toISOString()
              });
          }
        }
      } catch (updateError) {
        console.error('Failed to update mapping error status:', updateError);
      }

      await this.markProviderError(calendarProviderId, error.message);

      return {
        success: false,
        error: error.message || 'Failed to sync schedule entry'
      };
    }
  }

  /**
   * Sync an external calendar event to Alga schedule entry
   */
  async syncExternalEventToSchedule(
    externalEventId: string,
    calendarProviderId: string,
    force: boolean = false,
    tenantContext?: string
  ): Promise<CalendarSyncResult> {
    try {
      const { knex, tenant } = await createTenantKnex(tenantContext);
      if (!tenant) {
        throw new Error('Tenant context is required for calendar synchronization');
      }
      
      // Get the calendar provider
      const provider = await this.providerService.getProvider(calendarProviderId, tenant);
      if (!provider) {
        return {
          success: false,
          error: `Calendar provider ${calendarProviderId} not found`
        };
      }

      // Check sync direction
      if (provider.sync_direction === 'to_external') {
        return {
          success: false,
          error: 'Provider is configured for one-way sync to external calendar only'
        };
      }

      // Get or create adapter
      const adapter = await this.createAdapter(provider);
      await adapter.connect();

      // Get event from external calendar
      let externalEvent: ExternalCalendarEvent;
      try {
        externalEvent = await adapter.getEvent(externalEventId);
      } catch (error: any) {
        // If event returns 404, it was deleted - handle as deletion
        // Google returns status: 404, code: 404 (numeric)
        // Microsoft returns status: 404, code: 'ErrorItemNotFound' (string)
        const isNotFound = error.status === 404 || error.code === 404 || error.code === 'ErrorItemNotFound';
        if (isNotFound) {
          console.log('[CalendarSyncService] External event not found (likely deleted)', {
            externalEventId,
            calendarProviderId
          });

          // Check if we have a mapping to clean up
          const existingMapping = await this.getMappingByExternalEvent(externalEventId, calendarProviderId, tenant);
          if (existingMapping) {
            // Delete the corresponding schedule entry (skip external delete since it's already gone)
            const deleteResult = await this.deleteScheduleEntry(
              existingMapping.schedule_entry_id,
              calendarProviderId,
              'all',
              true // skipExternalDelete - event already deleted in external calendar
            );
            if (deleteResult.success) {
              return {
                success: true,
                deleted: true,
                reason: 'External event was deleted'
              };
            } else {
              return {
                success: false,
                error: `Failed to delete schedule entry after external event deletion: ${deleteResult.error}`
              };
            }
          }

          // No mapping exists, nothing to clean up
          return {
            success: true,
            skipped: true,
            reason: 'External event not found and no mapping exists'
          };
        }
        // Re-throw other errors
        throw error;
      }

      // Check for existing mapping
      const existingMapping = await this.getMappingByExternalEvent(externalEventId, calendarProviderId, tenant);

      const result = await withTransaction(knex, async (trx) => {
        if (existingMapping) {
          // Update existing schedule entry
          const existingEntry = await ScheduleEntry.get(trx, existingMapping.schedule_entry_id);
          if (!existingEntry) {
            return {
              success: false,
              error: 'Schedule entry not found for existing mapping'
            };
          }

          // Check for conflicts
          const conflict = await this.detectConflict(existingEntry, externalEvent, existingMapping);
          if (conflict && !force) {
            // Update mapping to conflict status
            await trx('calendar_event_mappings')
              .where('id', existingMapping.id)
              .andWhere('tenant', tenant)
              .update({
                sync_status: 'conflict',
                sync_error_message: 'Both Alga and external calendar have been modified',
                updated_at: new Date().toISOString()
              });

            const algaModified = existingEntry.updated_at instanceof Date
              ? existingEntry.updated_at.toISOString()
              : new Date(existingEntry.updated_at).toISOString();
            const externalModified = externalEvent.updated || '';
            await this.publishConflictEvent({
              tenant,
              providerId: provider.id,
              mappingId: existingMapping.id,
              scheduleEntryId: existingMapping.schedule_entry_id,
              externalEventId: existingMapping.external_event_id,
              algaLastModified: algaModified,
              externalLastModified: externalModified
            });

            return {
              success: false,
              error: 'Conflict detected: both calendars have been modified',
              conflict: {
                algaModified: existingEntry.updated_at instanceof Date 
                  ? existingEntry.updated_at.toISOString() 
                  : new Date(existingEntry.updated_at).toISOString(),
                externalModified: externalEvent.updated || ''
              }
            };
          }

          // Convert external event to schedule entry format
          const entryData = await mapExternalEventToScheduleEntry(externalEvent, tenant, provider.provider_type);

          // Merge with existing entry, but preserve assigned_user_ids from Alga
          // External calendars often don't include the correct attendees, so we keep
          // the original assignment unless the external event explicitly has attendees
          // that map to valid Alga users
          const shouldPreserveAssignees =
            existingEntry.assigned_user_ids.length > 0 &&
            (entryData.assigned_user_ids?.length === 0 ||
             !externalEvent.attendees ||
             externalEvent.attendees.length === 0);

          console.log('[CalendarSyncService] Merging external event with existing entry', {
            entryId: existingEntry.entry_id,
            existingAssignees: existingEntry.assigned_user_ids,
            externalAttendees: externalEvent.attendees?.map(a => a.email) || [],
            mappedAssignees: entryData.assigned_user_ids,
            shouldPreserveAssignees
          });

          const mergedEntry = {
            ...existingEntry,
            ...entryData,
            entry_id: existingEntry.entry_id, // Preserve entry ID
            // Preserve existing assignees if external event doesn't have valid attendees
            assigned_user_ids: shouldPreserveAssignees
              ? existingEntry.assigned_user_ids
              : ((entryData.assigned_user_ids?.length ?? 0) > 0 ? entryData.assigned_user_ids! : existingEntry.assigned_user_ids)
          };

          // Update schedule entry
          const updatedEntry = await ScheduleEntry.update(
            trx,
            existingEntry.entry_id,
            mergedEntry,
            'all' as any // Default to updating all occurrences
          );

          if (!updatedEntry) {
            return {
              success: false,
              error: 'Failed to update schedule entry'
            };
          }

          // Update mapping
          await trx('calendar_event_mappings')
            .where('id', existingMapping.id)
            .andWhere('tenant', tenant)
            .update({
              sync_status: 'synced',
              last_synced_at: new Date().toISOString(),
              alga_last_modified: updatedEntry.updated_at instanceof Date 
                ? updatedEntry.updated_at.toISOString() 
                : new Date(updatedEntry.updated_at).toISOString(),
              external_last_modified: externalEvent.updated,
              sync_error_message: null,
              updated_at: new Date().toISOString()
            });

          const syncResult = {
            success: true,
            mapping: {
              ...existingMapping,
              sync_status: 'synced' as const,
              last_synced_at: new Date().toISOString(),
              alga_last_modified: updatedEntry.updated_at instanceof Date
                ? updatedEntry.updated_at.toISOString()
                : new Date(updatedEntry.updated_at).toISOString(),
              external_last_modified: externalEvent.updated
            },
            externalEventId: externalEvent.id
          };

          await this.markProviderConnected(provider.id);
          return syncResult;
        } else {
          // Check if this event was originally created by Alga (has alga-entry-id)
          // This handles the race condition where webhook arrives before mapping is saved
          const algaEntryId = externalEvent.extendedProperties?.private?.['alga-entry-id'];

          if (algaEntryId) {
            // Check if the entry already exists
            const existingEntry = await ScheduleEntry.get(trx, algaEntryId);
            if (existingEntry) {
              // Entry exists but mapping doesn't - create mapping and skip creating duplicate
              const [mapping] = await trx('calendar_event_mappings')
                .insert({
                  id: uuidv4(),
                  tenant,
                  calendar_provider_id: calendarProviderId,
                  schedule_entry_id: algaEntryId,
                  external_event_id: externalEventId,
                  sync_status: 'synced',
                  last_synced_at: new Date().toISOString(),
                  sync_direction: 'to_external', // Original direction was to_external
                  alga_last_modified: existingEntry.updated_at instanceof Date
                    ? existingEntry.updated_at.toISOString()
                    : new Date(existingEntry.updated_at).toISOString(),
                  external_last_modified: externalEvent.updated,
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString()
                })
                .returning('*');

              console.log(`[CalendarSyncService] Created missing mapping for existing entry ${algaEntryId} (race condition recovery)`);

              const syncResult = {
                success: true,
                mapping: this.mapDbRowToMapping(mapping),
                externalEventId: externalEvent.id
              };

              await this.markProviderConnected(provider.id);
              return syncResult;
            }
            // Entry doesn't exist (may have been deleted) - fall through to create new entry
            // but don't use the orphaned algaEntryId
          }

          // Check if this external event should be imported into Alga
          // By default, we don't import external events - Alga is the source of truth for work schedule
          // Users can opt-in by adding "@alga" to the event title or description
          const hasAlgaMarker =
            externalEvent.title?.toLowerCase().includes('@alga') ||
            externalEvent.description?.toLowerCase().includes('@alga');

          if (!algaEntryId && !hasAlgaMarker) {
            // This is a purely external event without the @alga marker - skip import
            console.log('[CalendarSyncService] Skipping external event import (no @alga marker)', {
              eventId: externalEventId,
              title: externalEvent.title
            });
            return {
              success: true,
              skipped: true,
              reason: 'External event without @alga marker - not importing'
            };
          }

          // Create new schedule entry
          const entryData = await mapExternalEventToScheduleEntry(externalEvent, tenant, provider.provider_type);

          // Strip entry_id if it was from an orphaned alga-entry-id to avoid conflicts
          if (algaEntryId && entryData.entry_id === algaEntryId) {
            delete entryData.entry_id;
          }

          // For user-specific calendar sync, assign the entry to the provider's user
          // This ensures entries from a user's calendar are assigned to that user
          const assignedUserIds = provider.user_id
            ? [provider.user_id]
            : (entryData.assigned_user_ids || []);

          console.log('[CalendarSyncService] Creating entry from external event', {
            providerUserId: provider.user_id,
            mappedAssignees: entryData.assigned_user_ids,
            finalAssignees: assignedUserIds
          });

          // Create schedule entry
          const createdEntry = await ScheduleEntry.create(
            trx,
            {
              ...entryData,
              tenant
            } as any,
            {
              assignedUserIds
            }
          );

          // Create mapping
          const [mapping] = await trx('calendar_event_mappings')
            .insert({
              id: uuidv4(),
              tenant,
              calendar_provider_id: calendarProviderId,
              schedule_entry_id: createdEntry.entry_id,
              external_event_id: externalEventId,
              sync_status: 'synced',
              last_synced_at: new Date().toISOString(),
              sync_direction: 'from_external',
              alga_last_modified: createdEntry.updated_at instanceof Date
                ? createdEntry.updated_at.toISOString()
                : new Date(createdEntry.updated_at).toISOString(),
              external_last_modified: externalEvent.updated,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .returning('*');

          const syncResult = {
            success: true,
            mapping: this.mapDbRowToMapping(mapping),
            externalEventId: externalEvent.id
          };

          await this.markProviderConnected(provider.id);
          return syncResult;
        }
      });
      return result;
    } catch (error: any) {
      console.error(`Failed to sync external event ${externalEventId} to schedule entry:`, error);

      await this.markProviderError(calendarProviderId, error.message);

      return {
        success: false,
        error: error.message || 'Failed to sync external event'
      };
    }
  }

  /**
   * Resolve a sync conflict
   */
  async resolveConflict(
    mappingId: string,
    resolution: 'alga' | 'external' | 'merge',
    mergeData?: Partial<IScheduleEntry>,
    tenantContext?: string
  ): Promise<CalendarSyncResult> {
    try {
      const { knex, tenant } = await createTenantKnex(tenantContext);
      if (!tenant) {
        throw new Error('Tenant context is required for calendar synchronization');
      }
      
      // Get mapping
      const mapping = await this.getMappingById(mappingId, tenant);
      if (!mapping) {
        return {
          success: false,
          error: 'Mapping not found'
        };
      }

      if (mapping.sync_status !== 'conflict') {
        return {
          success: false,
          error: 'Mapping is not in conflict state'
        };
      }

      // Get provider and entry
      const provider = await this.providerService.getProvider(mapping.calendar_provider_id, tenant);
      if (!provider) {
        return {
          success: false,
          error: 'Calendar provider not found'
        };
      }

      const entry = await ScheduleEntry.get(knex, mapping.schedule_entry_id);
      if (!entry) {
        return {
          success: false,
          error: 'Schedule entry not found'
        };
      }

      const adapter = await this.createAdapter(provider);
      await adapter.connect();

      const result = await withTransaction(knex, async (trx) => {
        if (resolution === 'alga') {
          // Use Alga's version - sync to external
          return await this.syncScheduleEntryToExternal(entry.entry_id, mapping.calendar_provider_id, true);
        } else if (resolution === 'external') {
          // Use external version - sync from external
          return await this.syncExternalEventToSchedule(mapping.external_event_id, mapping.calendar_provider_id, true);
        } else {
          // Merge - use merge data if provided, otherwise use external version
          const mergedEntry = {
            ...entry,
            ...mergeData,
            entry_id: entry.entry_id
          };

          const updatedEntry = await ScheduleEntry.update(
            trx,
            entry.entry_id,
            mergedEntry,
            'all' as any
          );

          if (!updatedEntry) {
            return {
              success: false,
              error: 'Failed to merge schedule entry'
            };
          }

          // Sync merged version to external
          const syncResult = await this.syncScheduleEntryToExternal(entry.entry_id, mapping.calendar_provider_id, true);

          return syncResult;
        }
      });
      if (result.success) {
        await this.markProviderConnected(provider.id);
      }
      return result;
    } catch (error: any) {
      console.error(`Failed to resolve conflict for mapping ${mappingId}:`, error);
      return {
        success: false,
        error: error.message || 'Failed to resolve conflict'
      };
    }
  }

  /**
   * Delete a schedule entry and its external calendar event
   * @param skipExternalDelete - If true, skip deleting from external calendar (use when external already deleted)
   */
  async deleteScheduleEntry(
    entryId: string,
    calendarProviderId: string,
    deleteType: 'single' | 'future' | 'all' = 'all',
    skipExternalDelete: boolean = false,
    tenantContext?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { knex, tenant } = await createTenantKnex(tenantContext);
      if (!tenant) {
        throw new Error('Tenant context is required for calendar synchronization');
      }
      
      // Get mapping
      const mapping = await this.getMappingByScheduleEntry(entryId, calendarProviderId, tenant);
      if (!mapping) {
        // No mapping exists, just delete the entry
        await ScheduleEntry.delete(entryId, deleteType as any);
        return { success: true };
      }

      // Get provider
      const provider = await this.providerService.getProvider(calendarProviderId, tenant);
      if (!provider) {
        return {
          success: false,
          error: 'Calendar provider not found'
        };
      }

      const result = await withTransaction(knex, async (trx) => {
        // Delete from external calendar (unless already deleted externally)
        if (!skipExternalDelete) {
          try {
            const adapter = await this.createAdapter(provider);
            await adapter.connect();
            await adapter.deleteEvent(mapping.external_event_id);
          } catch (error: any) {
            console.warn(`Failed to delete external event ${mapping.external_event_id}:`, error.message);
            // Continue with local deletion even if external deletion fails
          }
        }

        // Delete schedule entry
        await ScheduleEntry.delete(entryId, deleteType as any);

        // Delete mapping
        await trx('calendar_event_mappings')
          .where('id', mapping.id)
          .andWhere('tenant', tenant)
          .del();

        return { success: true };
      });
      if (result.success) {
        await this.markProviderConnected(provider.id);
      }
      return result;
    } catch (error: any) {
      console.error(`Failed to delete schedule entry ${entryId}:`, error);
      return {
        success: false,
        error: error.message || 'Failed to delete schedule entry'
      };
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
   * Get mapping by schedule entry ID
   */
  private async getMappingByScheduleEntry(
    entryId: string,
    calendarProviderId: string,
    tenant: string
  ): Promise<CalendarEventMapping | null> {
    const { knex } = await createTenantKnex(tenant);
    const mapping = await knex('calendar_event_mappings')
      .where('schedule_entry_id', entryId)
      .andWhere('calendar_provider_id', calendarProviderId)
      .andWhere('tenant', tenant)
      .first();

    return mapping ? this.mapDbRowToMapping(mapping) : null;
  }

  /**
   * Get mapping by external event ID
   */
  private async getMappingByExternalEvent(
    externalEventId: string,
    calendarProviderId: string,
    tenant: string
  ): Promise<CalendarEventMapping | null> {
    const { knex } = await createTenantKnex(tenant);
    const mapping = await knex('calendar_event_mappings')
      .where('external_event_id', externalEventId)
      .andWhere('calendar_provider_id', calendarProviderId)
      .andWhere('tenant', tenant)
      .first();

    return mapping ? this.mapDbRowToMapping(mapping) : null;
  }

  /**
   * Get mapping by ID
   */
  private async getMappingById(mappingId: string, tenant: string): Promise<CalendarEventMapping | null> {
    const { knex } = await createTenantKnex(tenant);
    const mapping = await knex('calendar_event_mappings')
      .where('id', mappingId)
      .andWhere('tenant', tenant)
      .first();

    return mapping ? this.mapDbRowToMapping(mapping) : null;
  }

  /**
   * Detect conflict between Alga entry and external event
   */
  private async detectConflict(
    entry: IScheduleEntry,
    externalEvent: any,
    mapping: CalendarEventMapping
  ): Promise<boolean> {
    // Check if both have been modified since last sync
    const entryModified = entry.updated_at instanceof Date 
      ? entry.updated_at.getTime() 
      : new Date(entry.updated_at).getTime();
    
    const externalModified = externalEvent.updated 
      ? new Date(externalEvent.updated).getTime() 
      : 0;

    const lastSync = mapping.last_synced_at 
      ? new Date(mapping.last_synced_at).getTime() 
      : 0;

    // Conflict if both modified after last sync
    return entryModified > lastSync && externalModified > lastSync;
  }

  /**
   * Map database row to CalendarEventMapping interface
   */
  private mapDbRowToMapping(row: any): CalendarEventMapping {
    return {
      id: row.id,
      tenant: row.tenant,
      calendar_provider_id: row.calendar_provider_id,
      schedule_entry_id: row.schedule_entry_id,
      external_event_id: row.external_event_id,
      sync_status: row.sync_status,
      last_synced_at: row.last_synced_at,
      sync_error_message: row.sync_error_message,
      sync_direction: row.sync_direction,
      alga_last_modified: row.alga_last_modified,
      external_last_modified: row.external_last_modified,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  private async markProviderConnected(providerId: string): Promise<void> {
    try {
      await this.providerService.updateProviderStatus(providerId, {
        status: 'connected',
        lastSyncAt: new Date().toISOString(),
        errorMessage: null
      });
    } catch (statusError) {
      console.warn('[CalendarSyncService] Failed to update provider status to connected', {
        providerId,
        error: statusError instanceof Error ? statusError.message : statusError
      });
    }
  }

  private async markProviderError(providerId: string, errorMessage?: string): Promise<void> {
    try {
      await this.providerService.updateProviderStatus(providerId, {
        status: 'error',
        errorMessage: errorMessage || 'Calendar synchronization error'
      });
    } catch (statusError) {
      console.warn('[CalendarSyncService] Failed to update provider status to error', {
        providerId,
        error: statusError instanceof Error ? statusError.message : statusError
      });
    }
  }

  private async publishConflictEvent(params: {
    tenant: string;
    providerId: string;
    mappingId: string;
    scheduleEntryId: string;
    externalEventId: string;
    algaLastModified: string;
    externalLastModified: string;
  }): Promise<void> {
    try {
      await publishEvent({
        eventType: 'CALENDAR_CONFLICT_DETECTED',
        payload: {
          tenantId: params.tenant,
          calendarProviderId: params.providerId,
          mappingId: params.mappingId,
          scheduleEntryId: params.scheduleEntryId,
          externalEventId: params.externalEventId,
          algaLastModified: params.algaLastModified,
          externalLastModified: params.externalLastModified,
        }
      });
    } catch (error) {
      console.warn('[CalendarSyncService] Failed to publish conflict event', {
        providerId: params.providerId,
        mappingId: params.mappingId,
        error: error instanceof Error ? error.message : error
      });
    }
  }
}
