/**
 * Calendar Sync Service
 * Handles bidirectional synchronization between Alga schedule entries and external calendars
 */

import { createTenantKnex, withTransaction } from '@shared/db';
import { CalendarProviderConfig, CalendarEventMapping, CalendarSyncResult } from '../../interfaces/calendar.interfaces';
import { IScheduleEntry } from '../../interfaces/schedule.interfaces';
import { CalendarProviderService } from '../CalendarProviderService';
import { GoogleCalendarAdapter } from './providers/GoogleCalendarAdapter';
import { MicrosoftCalendarAdapter } from './providers/MicrosoftCalendarAdapter';
import { BaseCalendarAdapter } from './providers/base/BaseCalendarAdapter';
import { mapScheduleEntryToExternalEvent, mapExternalEventToScheduleEntry } from '../../utils/calendar/eventMapping';
import ScheduleEntry from '../../lib/models/scheduleEntry';
import { v4 as uuidv4 } from 'uuid';

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
    force: boolean = false
  ): Promise<CalendarSyncResult> {
    try {
      const { knex, tenant } = await createTenantKnex();
      
      // Get the schedule entry
      const entry = await ScheduleEntry.get(knex, entryId);
      if (!entry) {
        return {
          success: false,
          error: `Schedule entry ${entryId} not found`
        };
      }

      // Get the calendar provider
      const provider = await this.providerService.getProvider(calendarProviderId);
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

      return await withTransaction(knex, async (trx) => {
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

          return {
            success: true,
            mapping: {
              ...existingMapping,
              sync_status: 'synced',
              last_synced_at: new Date().toISOString(),
              alga_last_modified: entry.updated_at instanceof Date ? entry.updated_at.toISOString() : new Date(entry.updated_at).toISOString(),
              external_last_modified: updatedEvent.updated
            },
            externalEventId: updatedEvent.id
          };
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

          return {
            success: true,
            mapping: this.mapDbRowToMapping(mapping),
            externalEventId: createdEvent.id
          };
        }
      });
    } catch (error: any) {
      console.error(`Failed to sync schedule entry ${entryId} to external calendar:`, error);
      
      // Update mapping status to error if it exists
      try {
        const { knex, tenant } = await createTenantKnex();
        const mapping = await this.getMappingByScheduleEntry(entryId, calendarProviderId, tenant);
        if (mapping) {
          await knex('calendar_event_mappings')
            .where('id', mapping.id)
            .andWhere('tenant', tenant)
            .update({
              sync_status: 'error',
              sync_error_message: error.message,
              updated_at: new Date().toISOString()
            });
        }
      } catch (updateError) {
        console.error('Failed to update mapping error status:', updateError);
      }

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
    force: boolean = false
  ): Promise<CalendarSyncResult> {
    try {
      const { knex, tenant } = await createTenantKnex();
      
      // Get the calendar provider
      const provider = await this.providerService.getProvider(calendarProviderId);
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
      const externalEvent = await adapter.getEvent(externalEventId);

      // Check for existing mapping
      const existingMapping = await this.getMappingByExternalEvent(externalEventId, calendarProviderId, tenant);

      return await withTransaction(knex, async (trx) => {
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
          
          // Merge with existing entry
          const mergedEntry = {
            ...existingEntry,
            ...entryData,
            entry_id: existingEntry.entry_id // Preserve entry ID
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

          return {
            success: true,
            mapping: {
              ...existingMapping,
              sync_status: 'synced',
              last_synced_at: new Date().toISOString(),
              alga_last_modified: updatedEntry.updated_at instanceof Date 
                ? updatedEntry.updated_at.toISOString() 
                : new Date(updatedEntry.updated_at).toISOString(),
              external_last_modified: externalEvent.updated
            },
            externalEventId: externalEvent.id
          };
        } else {
          // Create new schedule entry
          const entryData = await mapExternalEventToScheduleEntry(externalEvent, tenant, provider.provider_type);
          
          // Create schedule entry
          const createdEntry = await ScheduleEntry.create(
            trx,
            {
              ...entryData,
              tenant
            } as any,
            {
              assignedUserIds: entryData.assigned_user_ids || []
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

          return {
            success: true,
            mapping: this.mapDbRowToMapping(mapping),
            externalEventId: externalEvent.id
          };
        }
      });
    } catch (error: any) {
      console.error(`Failed to sync external event ${externalEventId} to schedule entry:`, error);
      
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
    mergeData?: Partial<IScheduleEntry>
  ): Promise<CalendarSyncResult> {
    try {
      const { knex, tenant } = await createTenantKnex();
      
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
      const provider = await this.providerService.getProvider(mapping.calendar_provider_id);
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

      return await withTransaction(knex, async (trx) => {
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
   */
  async deleteScheduleEntry(
    entryId: string,
    calendarProviderId: string,
    deleteType: 'single' | 'future' | 'all' = 'all'
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { knex, tenant } = await createTenantKnex();
      
      // Get mapping
      const mapping = await this.getMappingByScheduleEntry(entryId, calendarProviderId, tenant);
      if (!mapping) {
        // No mapping exists, just delete the entry
        await ScheduleEntry.delete(entryId, deleteType as any);
        return { success: true };
      }

      // Get provider
      const provider = await this.providerService.getProvider(calendarProviderId);
      if (!provider) {
        return {
          success: false,
          error: 'Calendar provider not found'
        };
      }

      const adapter = await this.createAdapter(provider);
      await adapter.connect();

      return await withTransaction(knex, async (trx) => {
        // Delete from external calendar
        try {
          await adapter.deleteEvent(mapping.external_event_id);
        } catch (error: any) {
          console.warn(`Failed to delete external event ${mapping.external_event_id}:`, error.message);
          // Continue with local deletion even if external deletion fails
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
    const { knex } = await createTenantKnex();
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
    const { knex } = await createTenantKnex();
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
    const { knex } = await createTenantKnex();
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
}

