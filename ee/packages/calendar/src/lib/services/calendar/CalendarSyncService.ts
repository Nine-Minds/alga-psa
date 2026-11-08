/**
 * Calendar Sync Service
 * Handles bidirectional synchronization between Alga schedule entries and external calendars
 */

import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import type {
  CalendarProviderConfig,
  CalendarEventMapping,
  CalendarSyncResult,
  ExternalCalendarEvent,
  IRecurrencePattern,
  IScheduleEntry,
} from '@alga-psa/types';
import { IEditScope } from '@alga-psa/types';
import { CalendarProviderService } from './CalendarProviderService';
import { GoogleCalendarAdapter } from './providers/GoogleCalendarAdapter';
import { MicrosoftCalendarAdapter } from './providers/MicrosoftCalendarAdapter';
import { BaseCalendarAdapter } from './providers/base/BaseCalendarAdapter';
import {
  mapScheduleEntryToExternalEvent,
  mapExternalEventToScheduleEntry,
  externalEventNotes,
} from '../../utils/calendar/eventMapping';
import {
  convertRecurrenceLinesToPattern,
  isUnsupportedRecurrence,
} from '../../utils/calendar/recurrenceConverter';
import ScheduleEntry from '@alga-psa/shared/models/scheduleEntry';
import { v4 as uuidv4 } from 'uuid';
import { publishEvent } from '../../eventBus/publishers';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { buildScheduleEntryUpdatedPayload } from '@alga-psa/workflow-streams';
import { hasPermission } from '@alga-psa/auth';
import { evaluateEntryAccess, resolveCalendarAccess } from '@alga-psa/scheduling/lib/calendarAccess';

/**
 * True when a provider call failed because the event no longer exists there.
 * Google answers 404 (410 for an already-deleted event); Microsoft answers 404
 * with code ErrorItemNotFound.
 */
function isProviderEventGone(error: any): boolean {
  return error?.status === 404 || error?.status === 410
    || error?.code === 404 || error?.code === 410
    || error?.code === 'ErrorItemNotFound';
}

/**
 * Providers round-trip notes differently (Outlook returns HTML bodies), so
 * compare notes as whitespace-collapsed text.
 */
function comparableNotes(notes: string | null | undefined): string {
  return (notes ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const timeOf = (value: Date | string | null | undefined): number | null =>
  value ? new Date(value).getTime() : null;

/** Length between two instants, or null when either end is missing/unparseable. */
const durationMs = (start: number | null, end: number | null): number | null =>
  start !== null && end !== null && Number.isFinite(start) && Number.isFinite(end) ? end - start : null;

/**
 * True when an inbound provider edit changed something that syncs to other
 * assignees' copies. Echoes of Alga's own pushes compare equal, which keeps
 * fan-out from bouncing between assignees' calendars.
 */
function changesSyncedFields(before: IScheduleEntry, after: IScheduleEntry): boolean {
  const sortedIds = (ids: string[] | undefined) => [...(ids ?? [])].sort().join(',');
  return before.title !== after.title
    || comparableNotes(before.notes) !== comparableNotes(after.notes)
    || timeOf(before.scheduled_start) !== timeOf(after.scheduled_start)
    || timeOf(before.scheduled_end) !== timeOf(after.scheduled_end)
    || !!before.is_all_day !== !!after.is_all_day
    || (before.status ?? null) !== (after.status ?? null)
    || !!before.is_private !== !!after.is_private
    || sortedIds(before.assigned_user_ids) !== sortedIds(after.assigned_user_ids)
    || JSON.stringify(before.recurrence_pattern ?? null) !== JSON.stringify(after.recurrence_pattern ?? null);
}

/**
 * An expanded instance id as providers emit it: Google
 * `<masterId>_20261105T151500Z` (date-only for all-day series). Only ever used
 * as a last-resort hint after the exact id proved to have no mapping of its own,
 * because a split series master is legitimately named `<base>_R<timestamp>`.
 */
const INSTANCE_ID_SUFFIX = /^(.+)_(\d{8}T\d{6}Z|\d{8})$/;

function instanceIdMasterCandidate(externalEventId: string): string | null {
  const match = INSTANCE_ID_SUFFIX.exec(externalEventId);
  return match ? match[1] : null;
}

function instanceIdOccurrenceStart(externalEventId: string): Date | null {
  const match = INSTANCE_ID_SUFFIX.exec(externalEventId);
  if (!match) return null;
  const token = match[2];
  const year = Number(token.slice(0, 4));
  const month = Number(token.slice(4, 6)) - 1;
  const day = Number(token.slice(6, 8));
  const date = token.length > 8
    ? new Date(Date.UTC(year, month, day, Number(token.slice(9, 11)), Number(token.slice(11, 13)), Number(token.slice(13, 15))))
    : new Date(Date.UTC(year, month, day));
  return isNaN(date.getTime()) ? null : date;
}

/** Escape a provider id for use as a LIKE prefix (ids may contain _ and %). */
function likePrefix(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function utcMidnight(value: Date): Date {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

/** `calendar_event_mappings.occurrence_index`, however the driver hands it over. */
function parseOccurrenceIndex(value: unknown): Record<string, string> {
  const parsed = typeof value === 'string' ? safeJsonParse(value) : value;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return Object.fromEntries(
    Object.entries(parsed as Record<string, unknown>)
      .filter(([, slot]) => typeof slot === 'string')
      .map(([id, slot]) => [id, slot as string])
  );
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * Keep the exception dates Alga holds for a series when its master is re-read.
 *
 * A provider's `recurrence[]` does not list the occurrences the user cancelled
 * one at a time — Google tracks those as cancelled instances and Graph as
 * `@removed` items, never as EXDATE — so taking the incoming pattern verbatim
 * would resurrect every occurrence the series had already excepted out.
 */
function mergeSeriesExceptions(
  existing: unknown,
  incoming: IRecurrencePattern | null | undefined
): IRecurrencePattern | null | undefined {
  if (!incoming) return incoming;
  const previous = ScheduleEntry.parseRecurrencePattern((existing ?? null) as any);
  if (!previous?.exceptions?.length) return incoming;

  const byDay = new Map<number, Date>();
  for (const value of [...(incoming.exceptions ?? []), ...previous.exceptions]) {
    const date = utcMidnight(new Date(value));
    if (!isNaN(date.getTime())) byDay.set(date.getTime(), date);
  }
  return {
    ...incoming,
    exceptions: [...byDay.values()].sort((left, right) => left.getTime() - right.getTime()),
  };
}

export class CalendarSyncService {
  private providerService: CalendarProviderService;
  /**
   * Series masters fetched during one processor run. A delta batch can carry
   * hundreds of instances of the same series; the master must be fetched once.
   */
  private masterEventCache = new Map<string, { event: ExternalCalendarEvent | null; fetchedAt: number }>();
  private static readonly MASTER_CACHE_TTL_MS = 2 * 60 * 1000;
  /**
   * Newest instance `updated` already used to re-read a series master, per
   * master. Series-level edits only ever reach Alga as instance changes (see
   * refreshSeriesMasterIfStale), and this keeps a batch of instances carrying
   * the same edit from re-reading the master once each.
   */
  private seriesMasterRefreshes = new Map<string, { updated: number; at: number }>();
  /** `calendar_event_mappings.occurrence_index` read once per master per run. */
  private occurrenceIndexCache = new Map<string, { index: Record<string, string>; at: number }>();
  /** Mirrors the Microsoft delta window; never materialize a series unbounded. */
  private static readonly FALLBACK_WINDOW_PAST_MS = 90 * 24 * 60 * 60 * 1000;
  private static readonly FALLBACK_WINDOW_FUTURE_MS = 365 * 24 * 60 * 60 * 1000;
  /** Occurrence ids kept per series master for delete resolution (see below). */
  private static readonly OCCURRENCE_INDEX_LIMIT = 600;

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
      if (!tenant) {
        throw new Error('Tenant context is required for calendar synchronization');
      }
      
      // Get the schedule entry
      const entry = await ScheduleEntry.get(knex, tenant!, entryId);
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

      const authError = this.providerAuthorizationError(provider);
      if (authError) {
        return { success: false, error: authError };
      }

      // Get or create adapter
      const adapter = await this.createAdapter(provider);
      await adapter.connect();

      // Check for existing mapping
      const existingMapping = await this.getMappingByScheduleEntry(entryId, calendarProviderId, tenant);

      // Provider status is written on its own connection, so it must not report
      // "connected" until this transaction's writes are visible to readers.
      let wroteSync = false;
      const result = await withTransaction(knex, async (trx) => {
        if (entry.calendar_id) {
          const archivedCalendar = await tenantDb(trx, tenant).table('calendars')
            .where({ calendar_id: entry.calendar_id, calendar_type: 'group', is_archived: true }).first();
          if (archivedCalendar) return { success: true, skipped: true, reason: 'Calendar is archived' };
        }

        // Provider credentials define the visibility principal for every export.
        // Re-resolve inside the write transaction so a mapping (or the user who
        // initiated Sync Now) can never stand in for current provider-owner access.
        const providerAccess = await this.resolveProviderUserAccess(trx, tenant, provider.user_id);
        if (!providerAccess) {
          return { success: false, skipped: true, error: 'Provider owner access could not be resolved' };
        }
        const accessDecision = evaluateEntryAccess(entry, providerAccess);
        if (accessDecision.access !== 'full') {
          return {
            success: true,
            skipped: true,
            reason: accessDecision.access === 'busy'
              ? 'Provider owner has busy-only access; no safe outbound representation exists'
              : 'Provider owner cannot view this schedule entry',
          };
        }

        const groupCalendar = entry.calendar_id
          ? await tenantDb(trx, tenant).table('calendars').where({ calendar_id: entry.calendar_id, calendar_type: 'group' }).first()
          : null;
        const externalEvent = await mapScheduleEntryToExternalEvent(entry, provider.provider_type, undefined, groupCalendar?.name);

        if (existingMapping) {
          const updatedEvent = await this.updateProviderEventIfPresent(adapter, existingMapping.external_event_id, externalEvent);
          if (updatedEvent) {
            await tenantDb(trx, tenant).table('calendar_event_mappings')
              .where('id', existingMapping.id)
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

            wroteSync = true;
            return syncResult;
          }

          // The provider copy was removed without Alga processing the change (a missed
          // notification, or a delete while its calendar was archived). Drop the stale
          // mapping and create a fresh copy instead of failing the sync.
          await tenantDb(trx, tenant).table('calendar_event_mappings')
            .where('id', existingMapping.id)
            .del();
        }

        // Create event in external calendar
        const createdEvent = await adapter.createEvent(externalEvent);

        // Create mapping
        const [mapping] = await tenantDb(trx, tenant).table('calendar_event_mappings')
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

        wroteSync = true;
        return syncResult;
      });
      if (wroteSync) {
        await this.markProviderConnected(provider.id, adapter);
      }
      return result;
    } catch (error: any) {
      console.error(`Failed to sync schedule entry ${entryId} to external calendar:`, error);
      
      // Update mapping status to error if it exists
      try {
        const { knex, tenant } = await createTenantKnex();
        if (tenant) {
          const mapping = await this.getMappingByScheduleEntry(entryId, calendarProviderId, tenant);
          if (mapping) {
            await tenantDb(knex, tenant).table('calendar_event_mappings')
              .where('id', mapping.id)
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
    prefetchedEvent?: ExternalCalendarEvent
  ): Promise<CalendarSyncResult> {
    try {
      const { knex, tenant } = await createTenantKnex();
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

      const authError = this.providerAuthorizationError(provider);
      if (authError) {
        return { success: false, error: authError };
      }

      // Get or create adapter
      const adapter = await this.createAdapter(provider);
      await adapter.connect();

      // Get event from external calendar
      let externalEvent: ExternalCalendarEvent;
      try {
        externalEvent = prefetchedEvent ?? await adapter.getEvent(externalEventId);
      } catch (error: any) {
        // If event returns 404, it was deleted - handle as deletion
        // Google returns status: 404, code: 404 (numeric)
        // Microsoft returns status: 404, code: 'ErrorItemNotFound' (string)
        const isNotFound = isProviderEventGone(error);
        if (isNotFound) {
          console.log('[CalendarSyncService] External event not found (likely deleted)', {
            externalEventId,
            calendarProviderId
          });

          // Check if we have a mapping to clean up
          const existingMapping = await this.getMappingByExternalEvent(externalEventId, calendarProviderId, tenant);
          if (existingMapping) {
            // Delete the corresponding schedule entry (skip external delete since it's already gone)
            const deleteResult = await this.handleInboundProviderDelete(existingMapping.schedule_entry_id, calendarProviderId);
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

      // An expanded occurrence belongs to a series: resolve it to its master and
      // import the series once, instead of creating one entry per occurrence.
      let unsupportedSeriesReason: string | null = null;
      if (externalEvent.recurringEventId && externalEvent.recurringEventId !== externalEvent.id) {
        const outcome = await this.syncSeriesInstance({
          instance: externalEvent,
          adapter,
          provider,
          tenant,
          knex,
          force,
        });
        if (outcome.handled === true) {
          if (outcome.result.success) {
            await this.markProviderConnected(provider.id, adapter);
          }
          return outcome.result;
        }
        // Alga cannot express this rule: fall back to a bounded per-instance
        // import so the user still sees their meetings, and surface why.
        unsupportedSeriesReason = outcome.reason;
        if (!this.isWithinFallbackWindow(externalEvent)) {
          return {
            success: true,
            skipped: true,
            reason: `Unsupported recurrence rule (${outcome.reason}); occurrence outside the 12-month fallback window`,
          };
        }
      }
      // Carried onto the mapping on create AND on update, so a re-synced
      // occurrence of an inexpressible series keeps saying why it is one row.
      const seriesFallbackMessage = unsupportedSeriesReason
        ? this.unsupportedSeriesMessage(unsupportedSeriesReason)
        : null;

      // Check for existing mapping
      const existingMapping = await this.getMappingByExternalEvent(externalEventId, calendarProviderId, tenant);

      // Ignore a provider version already acknowledged by this mapping. This
      // makes stale webhook redelivery idempotent after an Alga-authoritative push.
      const incomingModifiedAt = externalEvent.updated ? new Date(externalEvent.updated).getTime() : NaN;
      const mappedModifiedAt = existingMapping?.external_last_modified
        ? new Date(existingMapping.external_last_modified).getTime()
        : NaN;
      if (Number.isFinite(incomingModifiedAt) && incomingModifiedAt === mappedModifiedAt) {
        return { success: true, skipped: true, reason: 'External version already synchronized' };
      }

      // Archived group calendars are frozen: provider events cannot change Alga.
      if (existingMapping) {
        const mappedEntry = await ScheduleEntry.get(knex, tenant, existingMapping.schedule_entry_id);
        if (mappedEntry?.calendar_id) {
          const archived = await tenantDb(knex, tenant).table('calendars')
            .where({ calendar_id: mappedEntry.calendar_id, calendar_type: 'group', is_archived: true })
            .first();
          if (archived) return { success: true, skipped: true, reason: 'Calendar is archived' };
        }
      }

      let rePushEntryId: string | null = null;
      // Assigned inside the transaction callback; the cast keeps TS from narrowing it to null.
      let acceptedEdit = null as { before: IScheduleEntry; after: IScheduleEntry } | null;
      // Mark the provider connected only after commit (see syncScheduleEntryToExternal).
      let wroteSync = false;
      const result = await withTransaction(knex, async (trx) => {
        if (existingMapping) {
          // Update existing schedule entry
          const existingEntry = await ScheduleEntry.get(trx, tenant!, existingMapping.schedule_entry_id);
          if (!existingEntry) {
            return {
              success: false,
              error: 'Schedule entry not found for existing mapping'
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
            // A re-read master must not resurrect the occurrences the series has
            // already excepted out (see mergeSeriesExceptions).
            recurrence_pattern: mergeSeriesExceptions(
              existingEntry.recurrence_pattern,
              entryData.recurrence_pattern
            ) as IScheduleEntry['recurrence_pattern'],
            // Preserve existing assignees if external event doesn't have valid attendees
            assigned_user_ids: shouldPreserveAssignees
              ? existingEntry.assigned_user_ids
              : ((entryData.assigned_user_ids?.length ?? 0) > 0 ? entryData.assigned_user_ids! : existingEntry.assigned_user_ids)
          };

          const providerAccess = await this.resolveProviderUserAccess(trx, tenant, provider.user_id);
          if (!providerAccess) return { success: true, skipped: true, reason: 'Provider has no user' };
          const canEdit = evaluateEntryAccess(existingEntry, providerAccess).canEdit;
          if (!changesSyncedFields(existingEntry, mergedEntry)) {
            await tenantDb(trx, tenant).table('calendar_event_mappings').where('id', existingMapping.id).update({
              sync_status: 'synced', last_synced_at: new Date().toISOString(),
              external_last_modified: externalEvent.updated,
              sync_error_message: seriesFallbackMessage, updated_at: new Date().toISOString()
            });
            if (!canEdit) return { success: true, skipped: true, reason: 'Only Alga calendar metadata changed' };
            return { success: true, skipped: true, reason: 'No synced fields changed' };
          }
          // Check for conflicts
          const conflict = await this.detectConflict(existingEntry, externalEvent, existingMapping);
          if (conflict && !force) {
            // Update mapping to conflict status
            await tenantDb(trx, tenant).table('calendar_event_mappings')
              .where('id', existingMapping.id)
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

          if (!canEdit) {
            rePushEntryId = existingEntry.entry_id;
            return { success: true, skipped: true, reason: 'Provider user cannot edit this entry' };
          }

          // Update schedule entry
          const updatedEntry = await ScheduleEntry.update(
            trx,
            tenant!,
            existingEntry.entry_id,
            mergedEntry
          );

          if (!updatedEntry) {
            return {
              success: false,
              error: 'Failed to update schedule entry'
            };
          }
          if (changesSyncedFields(existingEntry, updatedEntry)) {
            acceptedEdit = { before: existingEntry, after: updatedEntry };
          }

          // Update mapping
          await tenantDb(trx, tenant).table('calendar_event_mappings')
            .where('id', existingMapping.id)
            .update({
              sync_status: 'synced',
              last_synced_at: new Date().toISOString(),
              alga_last_modified: updatedEntry.updated_at instanceof Date 
                ? updatedEntry.updated_at.toISOString() 
                : new Date(updatedEntry.updated_at).toISOString(),
              external_last_modified: externalEvent.updated,
              sync_error_message: seriesFallbackMessage,
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

          wroteSync = true;
          return syncResult;
        } else {
          // Check if this event was originally created by Alga (has alga-entry-id)
          // This handles the race condition where webhook arrives before mapping is saved
          const algaEntryId = externalEvent.extendedProperties?.private?.['alga-entry-id'];

          if (algaEntryId) {
            // Check if the entry already exists
            const existingEntry = await ScheduleEntry.get(trx, tenant!, algaEntryId);
            if (existingEntry) {
              if (existingEntry.calendar_id && await tenantDb(trx, tenant).table('calendars')
                .where({ calendar_id: existingEntry.calendar_id, calendar_type: 'group', is_archived: true }).first()) {
                return { success: true, skipped: true, reason: 'Calendar is archived' };
              }
              // Entry exists but mapping doesn't - create mapping and skip creating duplicate
              const [mapping] = await tenantDb(trx, tenant).table('calendar_event_mappings')
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

              wroteSync = true;
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
            tenant!,
            entryData as any,
            {
              assignedUserIds
            }
          );

          // Create mapping
          const [mapping] = await tenantDb(trx, tenant).table('calendar_event_mappings')
            .insert({
              id: uuidv4(),
              tenant,
              calendar_provider_id: calendarProviderId,
              schedule_entry_id: createdEntry.entry_id,
              external_event_id: externalEventId,
              sync_status: 'synced',
              last_synced_at: new Date().toISOString(),
              sync_direction: 'from_external',
              ...(seriesFallbackMessage ? { sync_error_message: seriesFallbackMessage } : {}),
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

          wroteSync = true;
          return syncResult;
        }
      });
      if (wroteSync) {
        await this.markProviderConnected(provider.id, adapter);
      }
      // Also on the no-change path: the series stays inexpressible whether or
      // not this particular occurrence had anything new in it.
      if (unsupportedSeriesReason && (result as any)?.success) {
        await this.noteProviderSeriesFallback(provider.id, unsupportedSeriesReason);
      }
      if (rePushEntryId) {
        const pushed = await this.syncScheduleEntryToExternal(rePushEntryId, provider.id, true);
        if (!pushed.success) return pushed;
      }
      if (acceptedEdit) {
        await this.publishInboundEdit(tenant, provider, acceptedEdit.before, acceptedEdit.after);
      }
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
   * Apply one expanded occurrence of a provider series.
   *
   * The series master is the only thing Alga stores: a plain occurrence is a
   * no-op, a moved/renamed one becomes the existing single-occurrence override
   * (exception date on the master plus a standalone entry), and a cancelled one
   * becomes an exception date only. `handled: false` means Alga cannot express
   * the master's rule and the caller should use the bounded fallback.
   */
  private async syncSeriesInstance(params: {
    instance: ExternalCalendarEvent;
    adapter: BaseCalendarAdapter;
    provider: CalendarProviderConfig;
    tenant: string;
    knex: any;
    force: boolean;
  }): Promise<{ handled: true; result: CalendarSyncResult } | { handled: false; reason: string }> {
    const { instance, adapter, provider, tenant, knex, force } = params;
    const masterExternalId = instance.recurringEventId!;

    let masterMapping = await this.getMappingByExternalEvent(masterExternalId, provider.id, tenant);

    if (!masterMapping) {
      const master = await this.fetchSeriesMaster(adapter, provider.id, masterExternalId);
      if (!master) {
        // The master is gone on the provider side; never create an entry for an
        // orphaned occurrence, and clean up anything we already hold for it.
        const instanceMapping = await this.getMappingByExternalEvent(instance.id, provider.id, tenant);
        if (instanceMapping) {
          const deleted = await this.handleInboundProviderDelete(instanceMapping.schedule_entry_id, provider.id);
          return {
            handled: true,
            result: deleted.success
              ? { success: true, deleted: true, reason: 'Series master no longer exists' }
              : { success: false, error: deleted.error },
          };
        }
        return { handled: true, result: { success: true, skipped: true, reason: 'Series master no longer exists' } };
      }

      if (!this.isImportableEvent(master)) {
        return {
          handled: true,
          result: {
            success: true,
            skipped: true,
            reason: 'Series master without @alga marker - not importing',
          },
        };
      }

      const conversion = convertRecurrenceLinesToPattern(master.recurrence, new Date());
      if (isUnsupportedRecurrence(conversion)) {
        return { handled: false, reason: conversion.reason };
      }

      // Import the master itself, reusing the payload already fetched above so a
      // batch of occurrences costs exactly one master read.
      const imported = await this.syncExternalEventToSchedule(masterExternalId, provider.id, force, master);
      if (!imported.success) {
        return { handled: true, result: imported };
      }
      masterMapping = await this.getMappingByExternalEvent(masterExternalId, provider.id, tenant);
      if (!masterMapping) {
        return {
          handled: true,
          result: { success: true, skipped: true, reason: imported.reason ?? 'Series master was not imported' },
        };
      }
    }

    let masterEntry = await ScheduleEntry.get(knex, tenant, masterMapping.schedule_entry_id);
    if (!masterEntry) {
      // Mapping outlived its entry: drop it so the next notification re-imports.
      await tenantDb(knex, tenant).table('calendar_event_mappings').where('id', masterMapping.id).del();
      return { handled: true, result: { success: true, skipped: true, reason: 'Series master entry no longer exists' } };
    }

    // The mapped entry is not a series yet (a single Alga event the user turned
    // into a recurring one on the provider side). Pull the master first, so an
    // instance can never overwrite it as if it were a standalone event.
    if (!masterEntry.recurrence_pattern) {
      const refreshed = await this.syncExternalEventToSchedule(masterMapping.external_event_id, provider.id, force);
      masterEntry = await ScheduleEntry.get(knex, tenant, masterMapping.schedule_entry_id);
      // Re-read the mapping too: its external_last_modified is what the staleness
      // check below compares against.
      masterMapping = (await this.getMappingByExternalEvent(masterMapping.external_event_id, provider.id, tenant))
        ?? masterMapping;
      // KNOWN GAP: a series edited into an inexpressible rule (RDATE, several
      // RRULEs, FREQ=HOURLY) after it was already imported lands here — the
      // refresh above drops the pattern and the series shows as one event with
      // no health note, because the bounded fallback only arms when no master
      // mapping exists yet. Neither provider's UI can author those rules.
      if (!masterEntry?.recurrence_pattern) {
        return {
          handled: true,
          result: refreshed.success
            ? { success: true, skipped: true, reason: 'Series master is not recurring in Alga' }
            : refreshed,
        };
      }
    }

    // The series itself may have changed; the master has to be re-read before
    // this instance is judged against it (see refreshSeriesMasterIfStale).
    const refreshed = await this.refreshSeriesMasterIfStale({
      instance, adapter, provider, tenant, knex, force, masterMapping,
    });
    if (refreshed) {
      masterMapping = refreshed.mapping;
      masterEntry = refreshed.entry;
    }

    const occurrenceStart = this.occurrenceStartOf(instance);
    const instanceMapping = await this.getMappingByExternalEvent(instance.id, provider.id, tenant);

    // Google marks a cancelled instance with status 'cancelled'; Graph reports
    // it as an @removed delta item, which lands in handleInboundExternalDelete.
    if (instance.status === 'cancelled' && instance.provider === 'google') {
      const result = await this.cancelSeriesOccurrence({
        tenant,
        knex,
        provider,
        masterEntry,
        occurrenceStart,
        instanceMapping,
      });
      return { handled: true, result };
    }

    const isException = instance.instanceType === 'exception'
      || this.instanceDiffersFromMaster(instance, masterEntry);

    if (!isException) {
      // No schedule entry for a plain occurrence — but its id is recorded, so a
      // later provider delete of just that occurrence can be applied to this
      // master instead of being dropped as an unknown id.
      if (instance.provider === 'microsoft') {
        await this.recordSeriesOccurrenceId(knex, tenant, masterMapping, instance.id, occurrenceStart);
      }
      return {
        handled: true,
        result: {
          success: true,
          skipped: true,
          reason: 'Occurrence of an already-synced recurring series',
        },
      };
    }

    const result = await this.applySeriesException({
      instance,
      provider,
      tenant,
      knex,
      masterMapping,
      masterEntry,
      occurrenceStart,
      instanceMapping,
    });
    return { handled: true, result };
  }

  /** Fetch (and memoise) a series master; null when the provider no longer has it. */
  private async fetchSeriesMaster(
    adapter: BaseCalendarAdapter,
    providerId: string,
    masterExternalId: string
  ): Promise<ExternalCalendarEvent | null> {
    const key = `${providerId}:${masterExternalId}`;
    const cached = this.masterEventCache.get(key);
    if (cached && Date.now() - cached.fetchedAt < CalendarSyncService.MASTER_CACHE_TTL_MS) {
      return cached.event;
    }

    let event: ExternalCalendarEvent | null = null;
    try {
      event = await adapter.getEvent(masterExternalId);
    } catch (error: any) {
      if (!isProviderEventGone(error)) throw error;
      event = null;
    }
    this.pruneSeriesCaches();
    this.masterEventCache.set(key, { event, fetchedAt: Date.now() });
    return event;
  }

  /** Drop expired per-run memos so a long-lived service never grows unbounded. */
  private pruneSeriesCaches(): void {
    const cutoff = Date.now() - CalendarSyncService.MASTER_CACHE_TTL_MS;
    for (const [key, entry] of this.masterEventCache) {
      if (entry.fetchedAt < cutoff) this.masterEventCache.delete(key);
    }
    for (const [key, entry] of this.seriesMasterRefreshes) {
      if (entry.at < cutoff) this.seriesMasterRefreshes.delete(key);
    }
    for (const [key, entry] of this.occurrenceIndexCache) {
      if (entry.at < cutoff) this.occurrenceIndexCache.delete(key);
    }
  }

  /**
   * Re-read a series master when an instance proves it moved on.
   *
   * Neither a Google `singleEvents` list nor Graph's `calendarView/delta` ever
   * returns the master, so retiming or re-ruling a whole series arrives as
   * instance changes only — and without this the master would keep its old
   * pattern forever while the tombstones for the old slots were recorded as
   * exceptions on it, excepting the series away a slot at a time.
   *
   * The trigger is the instance's `updated` outrunning the version this
   * mapping acknowledged. Bounded by the memoised master fetch plus a per-master
   * high-water mark, so a 730-instance batch carrying one edit re-reads once.
   */
  private async refreshSeriesMasterIfStale(params: {
    instance: ExternalCalendarEvent;
    adapter: BaseCalendarAdapter;
    provider: CalendarProviderConfig;
    tenant: string;
    knex: any;
    force: boolean;
    masterMapping: CalendarEventMapping;
  }): Promise<{ mapping: CalendarEventMapping; entry: IScheduleEntry } | null> {
    const { instance, adapter, provider, tenant, knex, force, masterMapping } = params;
    const masterExternalId = masterMapping.external_event_id;

    const instanceUpdated = instance.updated ? new Date(instance.updated).getTime() : NaN;
    if (!Number.isFinite(instanceUpdated)) return null;
    const acknowledged = masterMapping.external_last_modified
      ? new Date(masterMapping.external_last_modified).getTime()
      : NaN;
    if (Number.isFinite(acknowledged) && instanceUpdated <= acknowledged) return null;

    const key = `${provider.id}:${masterExternalId}`;
    const seen = this.seriesMasterRefreshes.get(key);
    if (seen && instanceUpdated <= seen.updated) return null;
    this.seriesMasterRefreshes.set(key, { updated: instanceUpdated, at: Date.now() });

    // The memo holds the version this run already read; the whole point here is
    // that the provider's copy moved past it.
    this.masterEventCache.delete(key);
    const master = await this.fetchSeriesMaster(adapter, provider.id, masterExternalId);
    // Gone on the provider side: the delete path confirms and removes a series,
    // never an update path working from a single instance.
    if (!master) return null;

    await this.syncExternalEventToSchedule(masterExternalId, provider.id, force, master);

    const mapping = await this.getMappingByExternalEvent(masterExternalId, provider.id, tenant);
    const entry = mapping ? await ScheduleEntry.get(knex, tenant, mapping.schedule_entry_id) : null;
    return mapping && entry ? { mapping, entry } : null;
  }

  /** The occurrence slot an instance was generated for, before any move. */
  private occurrenceStartOf(instance: ExternalCalendarEvent): Date {
    return this.resolvedOccurrenceStart(instance) ?? new Date();
  }

  /**
   * Same slot, but null when nothing in the payload resolves one. A delete must
   * never guess: excepting out "now" would hide an occurrence the user kept.
   */
  private resolvedOccurrenceStart(instance: ExternalCalendarEvent): Date | null {
    const original = instance.originalStartTime?.dateTime
      || instance.originalStartTime?.date
      || instance.start?.dateTime
      || instance.start?.date;
    const parsed = original ? new Date(original) : null;
    if (parsed && !isNaN(parsed.getTime())) return parsed;
    return instanceIdOccurrenceStart(instance.id);
  }

  /**
   * Record `occurrence id -> slot` on the series master's mapping row.
   *
   * Two jobs, both of which need the link to exist before the occurrence does
   * not. Microsoft reports a cancelled occurrence as an `@removed` item holding
   * nothing but an opaque id that then 404s on GET, so a plain occurrence is
   * indexed as it is seen (Google needs no index for this — events.get still
   * serves a cancelled instance with its `recurringEventId`). And for either
   * provider it is how deleting a whole series finds its single-occurrence
   * override children: Graph's instance ids are opaque and bear no textual
   * relation to the master's.
   *
   * The index lives on the master's row rather than as one row per occurrence,
   * which the (tenant, schedule_entry_id, calendar_provider_id) unique index
   * forbids, so deleting the master takes its index with it.
   */
  private async recordSeriesOccurrenceId(
    knex: any,
    tenant: string,
    masterMapping: CalendarEventMapping,
    occurrenceId: string,
    occurrenceStart: Date
  ): Promise<void> {
    if (!occurrenceId || !occurrenceStart || isNaN(occurrenceStart.getTime())) return;

    const index = await this.loadOccurrenceIndex(knex, tenant, masterMapping.id);
    if (!index) return;

    const slot = occurrenceStart.toISOString();
    if (index[occurrenceId] === slot) return;

    index[occurrenceId] = slot;
    // Bounded: Graph's delta window is 90 days back / 365 forward, so the newest
    // slots are the only ones a delete can still arrive for.
    const entries = Object.entries(index)
      .sort(([, left], [, right]) => new Date(right).getTime() - new Date(left).getTime())
      .slice(0, CalendarSyncService.OCCURRENCE_INDEX_LIMIT);
    const bounded = Object.fromEntries(entries);
    this.occurrenceIndexCache.set(masterMapping.id, { index: { ...bounded }, at: Date.now() });

    await tenantDb(knex, tenant).table('calendar_event_mappings')
      .where('id', masterMapping.id)
      .update({
        occurrence_index: bounded,
        updated_at: new Date().toISOString(),
      });
  }

  /**
   * The master's occurrence index, read from the row once per run. Null when the
   * mapping row is gone.
   */
  private async loadOccurrenceIndex(
    knex: any,
    tenant: string,
    mappingId: string
  ): Promise<Record<string, string> | null> {
    const cached = this.occurrenceIndexCache.get(mappingId);
    if (cached && Date.now() - cached.at < CalendarSyncService.MASTER_CACHE_TTL_MS) {
      return cached.index;
    }

    const row = await tenantDb(knex, tenant).table('calendar_event_mappings')
      .where('id', mappingId)
      .first();
    if (!row) return null;

    const index = parseOccurrenceIndex(row.occurrence_index);
    this.occurrenceIndexCache.set(mappingId, { index, at: Date.now() });
    return index;
  }

  /** Find the series master that recorded this occurrence id, if any. */
  private async findIndexedOccurrence(
    knex: any,
    tenant: string,
    providerId: string,
    occurrenceId: string
  ): Promise<{ masterExternalId: string; occurrenceStart: Date } | null> {
    const rows = await tenantDb(knex, tenant).table('calendar_event_mappings')
      .where('calendar_provider_id', providerId)
      .whereNotNull('occurrence_index')
      .select('external_event_id', 'occurrence_index');

    for (const row of rows) {
      const slot = parseOccurrenceIndex(row.occurrence_index)[occurrenceId];
      if (!slot) continue;
      const occurrenceStart = new Date(slot);
      if (isNaN(occurrenceStart.getTime())) continue;
      return { masterExternalId: row.external_event_id, occurrenceStart };
    }
    return null;
  }

  /**
   * Ask the provider what a deleted id was. Google still serves a cancelled
   * instance, complete with `recurringEventId` and `originalStartTime`, which is
   * how an unmapped Google occurrence delete reaches its master. Null means
   * "nothing to do": the id is gone (404) or is not part of a series.
   */
  private async probeDeletedOccurrence(
    externalEventId: string,
    adapter: BaseCalendarAdapter
  ): Promise<
    | { kind: 'instance'; masterExternalId: string; occurrenceStart: Date | null }
    | { kind: 'standalone' }
    | { kind: 'gone' }
  > {
    let event: ExternalCalendarEvent;
    try {
      event = await adapter.getEvent(externalEventId);
    } catch (error: any) {
      if (isProviderEventGone(error)) return { kind: 'gone' };
      throw error;
    }

    if (!event.recurringEventId || event.recurringEventId === event.id) return { kind: 'standalone' };
    return {
      kind: 'instance',
      masterExternalId: event.recurringEventId,
      occurrenceStart: this.resolvedOccurrenceStart(event),
    };
  }

  /** The webhook's own connected adapter where there is one, else a fresh one. */
  private async adapterFor(
    tenant: string,
    providerId: string,
    supplied?: BaseCalendarAdapter
  ): Promise<BaseCalendarAdapter | null> {
    if (supplied) return supplied;
    const provider = await this.providerService.getProvider(providerId, tenant);
    if (!provider || this.providerAuthorizationError(provider)) return null;
    const adapter = await this.createAdapter(provider);
    await adapter.connect();
    return adapter;
  }

  /**
   * A Google series master never appears in an expanded (`singleEvents`) list,
   * so deleting the whole series arrives as a tombstone per instance and never
   * under the master's own id. When one of those tombstones is gone on the
   * provider side, ask whether its series master is gone too — confirmed with
   * the provider, never inferred from the id alone.
   */
  private async deletedSeriesMasterOf(
    knex: any,
    tenant: string,
    providerId: string,
    instanceExternalId: string,
    adapter: BaseCalendarAdapter
  ): Promise<string | null> {
    const candidate = instanceIdMasterCandidate(instanceExternalId);
    if (!candidate) return null;
    const mapping = await this.getMappingByExternalEvent(candidate, providerId, tenant);
    if (!mapping) return null;
    const entry = await ScheduleEntry.get(knex, tenant, mapping.schedule_entry_id);
    if (!entry?.is_recurring) return null;
    const master = await this.fetchSeriesMaster(adapter, providerId, candidate);
    return master ? null : candidate;
  }

  /** An event Alga is allowed to import: opted in with @alga, or Alga's own. */
  private isImportableEvent(event: ExternalCalendarEvent): boolean {
    if (event.extendedProperties?.private?.['alga-entry-id']) return true;
    return Boolean(
      event.title?.toLowerCase().includes('@alga') ||
      event.description?.toLowerCase().includes('@alga')
    );
  }

  /**
   * A renamed, re-described or re-timed occurrence is an exception even when it
   * still starts in its original slot (a moved one is already flagged by the
   * adapter). Notes are compared through the inbound mapper, never against the
   * raw description: a group-calendar master carries an `[Alga calendar: …]`
   * line outbound that is stripped again on the way in, and every expanded
   * occurrence inherits it, so a raw comparison calls every plain occurrence an
   * exception and materialises the series slot by slot.
   */
  private instanceDiffersFromMaster(instance: ExternalCalendarEvent, masterEntry: IScheduleEntry): boolean {
    if ((instance.title ?? '') !== (masterEntry.title ?? '')) return true;
    if (comparableNotes(externalEventNotes(instance, instance.provider)) !== comparableNotes(masterEntry.notes)) {
      return true;
    }
    // A single occurrence whose end moved keeps its slot, so only its length
    // separates it from the master. Comparing lengths rather than instants is
    // DST-safe: a zoned series keeps the same duration either side of a shift.
    const instanceLength = this.instanceDurationMs(instance);
    const masterLength = durationMs(timeOf(masterEntry.scheduled_start), timeOf(masterEntry.scheduled_end));
    return instanceLength !== null && masterLength !== null && instanceLength !== masterLength;
  }

  /** An occurrence's length in ms, or null when the payload does not give both ends. */
  private instanceDurationMs(instance: ExternalCalendarEvent): number | null {
    return durationMs(
      timeOf(instance.start?.dateTime ?? instance.start?.date),
      timeOf(instance.end?.dateTime ?? instance.end?.date),
    );
  }

  /** Add an exception date to a master's pattern, idempotently. */
  private async addMasterException(
    knex: any,
    tenant: string,
    masterEntry: IScheduleEntry,
    occurrenceStart: Date
  ): Promise<boolean> {
    const pattern = ScheduleEntry.parseRecurrencePattern(masterEntry.recurrence_pattern ?? null);
    if (!pattern) return false;

    const exceptionDate = utcMidnight(occurrenceStart);
    const existing = (pattern.exceptions ?? []).map((value) => utcMidnight(new Date(value)).getTime());
    if (existing.includes(exceptionDate.getTime())) return false;

    await ScheduleEntry.update(knex, tenant, masterEntry.entry_id, {
      ...masterEntry,
      recurrence_pattern: { ...pattern, exceptions: [...(pattern.exceptions ?? []), exceptionDate] },
    });
    return true;
  }

  /**
   * A single cancelled occurrence: exception on the master and the override
   * entry (if any) removed. The master itself must survive.
   */
  private async cancelSeriesOccurrence(params: {
    tenant: string;
    knex: any;
    provider: CalendarProviderConfig;
    masterEntry: IScheduleEntry;
    occurrenceStart: Date;
    instanceMapping: CalendarEventMapping | null;
  }): Promise<CalendarSyncResult> {
    const { tenant, knex, provider, masterEntry, occurrenceStart, instanceMapping } = params;

    await this.addMasterException(knex, tenant, masterEntry, occurrenceStart);

    if (instanceMapping) {
      await ScheduleEntry.delete(knex, tenant, instanceMapping.schedule_entry_id);
      await tenantDb(knex, tenant).table('calendar_event_mappings').where('id', instanceMapping.id).del();
    }

    return {
      success: true,
      deleted: Boolean(instanceMapping),
      reason: 'Cancelled occurrence recorded as a series exception',
    };
  }

  /**
   * A moved/renamed occurrence: the existing single-occurrence mechanism, i.e.
   * an exception date on the master plus a standalone entry carrying the
   * instance's own title and times.
   */
  private async applySeriesException(params: {
    instance: ExternalCalendarEvent;
    provider: CalendarProviderConfig;
    tenant: string;
    knex: any;
    masterMapping: CalendarEventMapping;
    masterEntry: IScheduleEntry;
    occurrenceStart: Date;
    instanceMapping: CalendarEventMapping | null;
  }): Promise<CalendarSyncResult> {
    const { instance, provider, tenant, knex, masterMapping, masterEntry, occurrenceStart, instanceMapping } = params;

    const entryData = await mapExternalEventToScheduleEntry(instance, tenant, provider.provider_type);
    const assignedUserIds = provider.user_id
      ? [provider.user_id]
      : (entryData.assigned_user_ids?.length ? entryData.assigned_user_ids : masterEntry.assigned_user_ids);

    const { entry_id: _ignoredEntryId, ...instanceFields } = entryData;
    const overrideFields = {
      ...instanceFields,
      recurrence_pattern: null,
      is_recurring: false,
      assigned_user_ids: assignedUserIds,
      calendar_id: masterEntry.calendar_id ?? null,
    };

    if (instanceMapping) {
      const updated = await ScheduleEntry.update(knex, tenant, instanceMapping.schedule_entry_id, overrideFields);
      if (!updated) {
        return { success: false, error: 'Failed to update series exception entry' };
      }
      await tenantDb(knex, tenant).table('calendar_event_mappings')
        .where('id', instanceMapping.id)
        .update({
          sync_status: 'synced',
          last_synced_at: new Date().toISOString(),
          external_last_modified: instance.updated,
          sync_error_message: null,
          updated_at: new Date().toISOString(),
        });
      await this.recordSeriesOccurrenceId(knex, tenant, masterMapping, instance.id, occurrenceStart);
      return { success: true, externalEventId: instance.id };
    }

    // The virtual id tells the model which occurrence to except out of the
    // master before the standalone override is written.
    const virtualId = `${masterEntry.entry_id}_${utcMidnight(occurrenceStart).getTime()}`;
    const override = await ScheduleEntry.update(knex, tenant, virtualId, overrideFields, IEditScope.SINGLE);
    if (!override) {
      return { success: false, error: 'Failed to create series exception entry' };
    }

    const [mapping] = await tenantDb(knex, tenant).table('calendar_event_mappings')
      .insert({
        id: uuidv4(),
        tenant,
        calendar_provider_id: provider.id,
        schedule_entry_id: override.entry_id,
        external_event_id: instance.id,
        sync_status: 'synced',
        last_synced_at: new Date().toISOString(),
        sync_direction: 'from_external',
        alga_last_modified: override.updated_at instanceof Date
          ? override.updated_at.toISOString()
          : new Date(override.updated_at ?? Date.now()).toISOString(),
        external_last_modified: instance.updated,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .returning('*');

    // The override's provider id goes on the master's index: deleting the whole
    // series has no other way to find this child, since Graph instance ids share
    // nothing with the master's.
    await this.recordSeriesOccurrenceId(knex, tenant, masterMapping, instance.id, occurrenceStart);

    return {
      success: true,
      mapping: mapping ? this.mapDbRowToMapping(mapping) : undefined,
      externalEventId: instance.id,
    };
  }

  /**
   * Apply a provider delete by external id. A deleted occurrence of a synced
   * series becomes an exception on the master; deleting the master takes its
   * single-occurrence overrides with it. Never calls back out to the provider.
   */
  async handleInboundExternalDelete(
    externalEventId: string,
    providerId: string,
    hints?: { recurringEventId?: string; originalStart?: string; adapter?: BaseCalendarAdapter }
  ): Promise<{ success: boolean; error?: string; skipped?: boolean; reason?: string }> {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) return { success: false, error: 'Tenant context is required' };

    const mapping = await this.getMappingByExternalEvent(externalEventId, providerId, tenant);
    if (mapping) {
      const entry = await ScheduleEntry.get(knex, tenant, mapping.schedule_entry_id);
      // Read the master's occurrence index first: the delete below takes the
      // mapping row, and with it the only record of which provider ids belong
      // to this series.
      const indexedIds = entry?.is_recurring
        ? Object.keys((await this.loadOccurrenceIndex(knex, tenant, mapping.id)) ?? {})
        : [];
      const result = await this.handleInboundProviderDelete(mapping.schedule_entry_id, providerId);
      // Single-occurrence overrides only go when the series itself did: a
      // provider user without edit rights keeps the entry (and its overrides).
      if (result.success && entry?.is_recurring
        && !(await ScheduleEntry.get(knex, tenant, mapping.schedule_entry_id))) {
        await this.deleteSeriesOverrides(knex, tenant, providerId, externalEventId, indexedIds);
      }
      this.occurrenceIndexCache.delete(mapping.id);
      return result;
    }

    // No mapping for this exact id: it is an expanded occurrence of a series
    // whose master Alga stores. Resolve the master and the cancelled slot, most
    // specific source first — and never from the `_<timestamp>` id suffix, which
    // a split `<base>_R<timestamp>` master shares with real instances.
    let masterExternalId = hints?.recurringEventId ?? null;
    let occurrenceStart = hints?.originalStart ? new Date(hints.originalStart) : null;

    if (!masterExternalId) {
      // Microsoft: the occurrence index recorded while the occurrence existed.
      const indexed = await this.findIndexedOccurrence(knex, tenant, providerId, externalEventId);
      if (indexed) {
        masterExternalId = indexed.masterExternalId;
        occurrenceStart = occurrenceStart ?? indexed.occurrenceStart;
      }
    }

    if (!masterExternalId) {
      // Google: events.get still answers for a cancelled instance. A 404 here
      // with no mapping is nothing to do — it must never become an exception on
      // a series guessed from the id — except when the provider also confirms
      // the series master itself is gone.
      const adapter = await this.adapterFor(tenant, providerId, hints?.adapter);
      const probed = adapter
        ? await this.probeDeletedOccurrence(externalEventId, adapter)
        : { kind: 'gone' as const };
      if (probed.kind === 'instance') {
        masterExternalId = probed.masterExternalId;
        occurrenceStart = occurrenceStart ?? probed.occurrenceStart;
      } else if (probed.kind === 'gone' && adapter) {
        const deletedMaster = await this.deletedSeriesMasterOf(knex, tenant, providerId, externalEventId, adapter);
        if (deletedMaster) {
          return this.handleInboundExternalDelete(deletedMaster, providerId, { adapter });
        }
      }
    }

    if (!masterExternalId) {
      return { success: true, skipped: true, reason: 'No mapping for deleted external event' };
    }

    const masterMapping = await this.getMappingByExternalEvent(masterExternalId, providerId, tenant);
    if (!masterMapping) {
      return { success: true, skipped: true, reason: 'No mapping for deleted external event' };
    }

    const masterEntry = await ScheduleEntry.get(knex, tenant, masterMapping.schedule_entry_id);
    if (!masterEntry) {
      return { success: true, skipped: true, reason: 'Series master entry no longer exists' };
    }

    if (!occurrenceStart || isNaN(occurrenceStart.getTime())) {
      return { success: true, skipped: true, reason: 'Deleted occurrence has no resolvable date' };
    }

    await this.addMasterException(knex, tenant, masterEntry, occurrenceStart);
    return { success: true, reason: 'Deleted occurrence recorded as a series exception' };
  }

  /**
   * Remove the standalone override entries belonging to a provider series.
   *
   * Primary source is the ids the master's occurrence index recorded, which is
   * the only thing that works for Microsoft: a Graph occurrence id is opaque
   * base64 unrelated to its master's. The id-shape sweep stays as a second pass
   * for Google — it covers overrides recorded before the index existed — and is
   * narrow enough that a split master (`<base>_R<timestamp>`) is never swept up
   * with its predecessor.
   */
  private async deleteSeriesOverrides(
    knex: any,
    tenant: string,
    providerId: string,
    masterExternalId: string,
    indexedOccurrenceIds: string[] = []
  ): Promise<void> {
    const seen = new Set<string>();

    const removeRow = async (row: { id: string; schedule_entry_id: string }) => {
      if (seen.has(row.id)) return;
      seen.add(row.id);
      await ScheduleEntry.delete(knex, tenant, row.schedule_entry_id);
      await tenantDb(knex, tenant).table('calendar_event_mappings').where('id', row.id).del();
    };

    const indexed = indexedOccurrenceIds.filter((id) => id && id !== masterExternalId);
    if (indexed.length > 0) {
      const rows = await tenantDb(knex, tenant).table('calendar_event_mappings')
        .where('calendar_provider_id', providerId)
        .whereIn('external_event_id', indexed)
        .select('id', 'schedule_entry_id');
      for (const row of rows) await removeRow(row);
    }

    const rows = await tenantDb(knex, tenant).table('calendar_event_mappings')
      .where('calendar_provider_id', providerId)
      .andWhere('external_event_id', 'like', `${likePrefix(masterExternalId)}\\_%`)
      .select('id', 'external_event_id', 'schedule_entry_id');

    for (const row of rows) {
      if (instanceIdMasterCandidate(row.external_event_id) !== masterExternalId) continue;
      await removeRow(row);
    }
  }

  /**
   * The bounded fallback for a rule Alga cannot represent. The window is
   * measured from the moment of each sync, so it re-extends: an occurrence that
   * was too far out is imported by a later run once it comes into range, and
   * the series is never materialized unbounded.
   */
  private isWithinFallbackWindow(event: ExternalCalendarEvent): boolean {
    const raw = event.start?.dateTime || event.start?.date;
    const start = raw ? new Date(raw) : null;
    if (!start || isNaN(start.getTime())) return true;
    const now = Date.now();
    return start.getTime() >= now - CalendarSyncService.FALLBACK_WINDOW_PAST_MS
      && start.getTime() <= now + CalendarSyncService.FALLBACK_WINDOW_FUTURE_MS;
  }

  private unsupportedSeriesMessage(reason: string): string {
    return `Recurring series uses a rule Alga cannot represent (${reason}); imported individual occurrences for the next 12 months only.`;
  }

  private async noteProviderSeriesFallback(providerId: string, reason: string): Promise<void> {
    try {
      await this.providerService.updateProviderStatus(providerId, {
        status: 'connected',
        errorMessage: this.unsupportedSeriesMessage(reason),
      });
    } catch (statusError) {
      console.warn('[CalendarSyncService] Failed to record unsupported-recurrence note', {
        providerId,
        error: statusError instanceof Error ? statusError.message : statusError,
      });
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

      const entry = await ScheduleEntry.get(knex, tenant!, mapping.schedule_entry_id);
      if (!entry) {
        return {
          success: false,
          error: 'Schedule entry not found'
        };
      }

      const adapter = await this.createAdapter(provider);
      await adapter.connect();

      // LEVERAGE: pattern calendar-sync-service-triplicate — same CalendarSyncService body in ee/, server/, packages/integrations; fixes must be applied three times
      // The sync callees acquire their own connections/transactions, so they must not run
      // inside an outer transaction here.
      let result: CalendarSyncResult;
      if (resolution === 'alga') {
        // Use Alga's version - sync to external
        result = await this.syncScheduleEntryToExternal(entry.entry_id, mapping.calendar_provider_id, true);
      } else if (resolution === 'external') {
        // Use external version - sync from external
        result = await this.syncExternalEventToSchedule(mapping.external_event_id, mapping.calendar_provider_id, true);
      } else {
        // Merge - use merge data if provided, otherwise use external version
        const mergedEntry = {
          ...entry,
          ...mergeData,
          entry_id: entry.entry_id
        };

        const updatedEntry = await withTransaction(knex, (trx) =>
          ScheduleEntry.update(trx, tenant!, entry.entry_id, mergedEntry)
        );

        if (!updatedEntry) {
          return {
            success: false,
            error: 'Failed to merge schedule entry'
          };
        }

        // Merge is committed; the push reads the merged row on its own connection.
        result = await this.syncScheduleEntryToExternal(entry.entry_id, mapping.calendar_provider_id, true);
      }
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
   * Delete a schedule entry and its external calendar event.
   *
   * WARNING: this deletes the Alga schedule_entries row as well as the provider event.
   * Use it only for a genuine user-initiated delete. To detach one provider's copy
   * (unassignment, archive) while keeping the Alga entry, use removeProviderCopy().
   * @param skipExternalDelete - If true, skip deleting from external calendar (use when external already deleted)
   */
  async deleteScheduleEntry(
    entryId: string,
    calendarProviderId: string,
    deleteType: 'single' | 'future' | 'all' = 'all',
    skipExternalDelete: boolean = false
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { knex, tenant } = await createTenantKnex();
      if (!tenant) {
        throw new Error('Tenant context is required for calendar synchronization');
      }
      
      // Get mapping
      const mapping = await this.getMappingByScheduleEntry(entryId, calendarProviderId, tenant);
      if (!mapping) {
        // No mapping exists, just delete the entry
        await ScheduleEntry.delete(knex, tenant, entryId);
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
        await ScheduleEntry.delete(trx, tenant!, entryId);

        // Delete mapping
        await tenantDb(trx, tenant).table('calendar_event_mappings')
          .where('id', mapping.id)
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

  /** Apply a provider delete under the provider user's shared-calendar rights. */
  async handleInboundProviderDelete(entryId: string, providerId: string): Promise<{ success: boolean; error?: string }> {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) return { success: false, error: 'Tenant context is required' };
    const provider = await this.providerService.getProvider(providerId, tenant);
    if (!provider?.user_id) return { success: false, error: 'Provider user not found' };
    const entry = await ScheduleEntry.get(knex, tenant, entryId);
    if (!entry) return { success: true };
    if (entry.calendar_id) {
      const archived = await tenantDb(knex, tenant).table('calendars')
        .where({ calendar_id: entry.calendar_id, calendar_type: 'group', is_archived: true }).first();
      if (archived) return { success: true };
    }
    const access = await this.resolveProviderUserAccess(knex, tenant, provider.user_id);
    if (!access) return { success: false, error: 'Provider user not found' };
    const decision = evaluateEntryAccess(entry, access);
    if (decision.canEdit && entry.assigned_user_ids.length === 1) {
      return this.deleteScheduleEntry(entryId, providerId, 'all', true);
    }
    if (!entry.assigned_user_ids.includes(provider.user_id)) {
      await tenantDb(knex, tenant).table('calendar_event_mappings')
        .where({ schedule_entry_id: entryId, calendar_provider_id: providerId }).del();
      return { success: true };
    }
    // A read-only sole assignee may be removed, leaving group or personal entries unassigned intentionally.
    const updated = await ScheduleEntry.update(knex, tenant, entryId, {
      ...entry,
      assigned_user_ids: entry.assigned_user_ids.filter((id: string) => id !== provider.user_id),
    });
    if (!updated) return { success: false, error: 'Failed to remove provider user from entry' };
    await tenantDb(knex, tenant).table('calendar_event_mappings')
      .where({ schedule_entry_id: entryId, calendar_provider_id: providerId }).del();
    return { success: true };
  }

  private async resolveProviderUserAccess(
    knex: any,
    tenant: string,
    providerUserId?: string | null
  ) {
    if (!providerUserId) return null;
    const user = await tenantDb(knex, tenant).table('users').where('user_id', providerUserId).first();
    if (!user) return null;
    const viewer = { user_id: user.user_id, user_type: user.user_type, tenant } as any;
    // scheduleActions.ts uses this same user_schedule:update check before resolveCalendarAccess.
    const canViewAll = await hasPermission(viewer, 'user_schedule', 'update', knex);
    return resolveCalendarAccess(knex, tenant, viewer, canViewAll);
  }

  async removeProviderCopy(entryId: string, providerId: string): Promise<void> {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) throw new Error('Tenant context is required for calendar synchronization');
    const mapping = await this.getMappingByScheduleEntry(entryId, providerId, tenant);
    if (!mapping) return;
    const provider = await this.providerService.getProvider(providerId, tenant);
    if (provider) {
      try {
        const adapter = await this.createAdapter(provider);
        await adapter.connect();
        await adapter.deleteEvent(mapping.external_event_id);
      } catch (error: any) {
        // Already gone on the provider side: the copy is removed, so the mapping must go too,
        // or a later restore would try to update an event that no longer exists.
        if (!isProviderEventGone(error)) {
          console.warn(`Failed to delete external event ${mapping.external_event_id}:`, error.message);
          throw error;
        }
      }
    }
    await tenantDb(knex, tenant).table('calendar_event_mappings').where('id', mapping.id).del();
  }

  /**
   * Friendly pre-check used before any adapter work: a provider whose OAuth
   * flow was never completed has no tokens and every sync attempt would fail
   * with a raw adapter error that then gets stamped onto the provider row.
   */
  private providerAuthorizationError(provider: CalendarProviderConfig): string | null {
    const cfg = provider.provider_config;
    if (!cfg?.accessToken || !cfg?.refreshToken) {
      return 'Calendar provider is not authorized yet. Complete OAuth authorization before syncing.';
    }
    return null;
  }

  /**
   * Update a mapped provider event; resolves to null when the event no longer
   * exists on the provider side.
   */
  private async updateProviderEventIfPresent(
    adapter: BaseCalendarAdapter,
    externalEventId: string,
    event: ExternalCalendarEvent
  ): Promise<ExternalCalendarEvent | null> {
    try {
      return await adapter.updateEvent(externalEventId, event);
    } catch (error: any) {
      if (isProviderEventGone(error)) return null;
      throw error;
    }
  }

  /**
   * Create adapter instance for provider
   */
  private async createAdapter(provider: CalendarProviderConfig): Promise<BaseCalendarAdapter> {
    const authError = this.providerAuthorizationError(provider);
    if (authError) {
      throw new Error(authError);
    }
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
    const mapping = await tenantDb(knex, tenant).table('calendar_event_mappings')
      .where('schedule_entry_id', entryId)
      .andWhere('calendar_provider_id', calendarProviderId)
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
    const mapping = await tenantDb(knex, tenant).table('calendar_event_mappings')
      .where('external_event_id', externalEventId)
      .andWhere('calendar_provider_id', calendarProviderId)
      .first();

    return mapping ? this.mapDbRowToMapping(mapping) : null;
  }

  /**
   * Get mapping by ID
   */
  private async getMappingById(mappingId: string, tenant: string): Promise<CalendarEventMapping | null> {
    const { knex } = await createTenantKnex();
    const mapping = await tenantDb(knex, tenant).table('calendar_event_mappings')
      .where('id', mappingId)
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
      occurrence_index: row.occurrence_index ? parseOccurrenceIndex(row.occurrence_index) : null,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  private async markProviderConnected(providerId: string, adapter?: BaseCalendarAdapter): Promise<void> {
    try {
      await this.providerService.updateProviderStatus(providerId, {
        status: 'connected',
        lastSyncAt: new Date().toISOString(),
        errorMessage: adapter instanceof MicrosoftCalendarAdapter ? adapter.getProviderStatusWarning() ?? null : null
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

  /**
   * Announce an accepted provider edit like any other schedule update, so the
   * other assignees' copies (and search, workflows) pick it up. The source
   * provider already holds this version and is skipped by the sync subscriber.
   */
  private async publishInboundEdit(
    tenant: string,
    provider: CalendarProviderConfig,
    before: IScheduleEntry,
    after: IScheduleEntry
  ): Promise<void> {
    try {
      await publishWorkflowEvent({ eventType: 'SCHEDULE_ENTRY_UPDATED', payload: buildScheduleEntryUpdatedPayload({ userId: provider.user_id, entryId: after.entry_id, changes: {
            before: { assignedUserIds: before.assigned_user_ids ?? [] },
            after: { assignedUserIds: after.assigned_user_ids ?? [] },
            sourceCalendarProviderId: provider.id,
          } }), ctx: { tenantId: tenant, actor: { actorType: 'USER', actorUserId: provider.user_id } } });
    } catch (error) {
      console.warn('[CalendarSyncService] Failed to publish inbound edit', {
        providerId: provider.id,
        entryId: after.entry_id,
        error: error instanceof Error ? error.message : error
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
