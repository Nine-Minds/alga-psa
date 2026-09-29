/**
 * Event mapping utilities for converting between IScheduleEntry and ExternalCalendarEvent
 */

import type { IScheduleEntry, IRecurrencePattern, WorkItemType, ExternalCalendarEvent } from '@alga-psa/types';
import { convertRecurrencePatternToRRULE } from './recurrenceConverter';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { parseCalendarDateTime } from '@alga-psa/core';

/**
 * Map IScheduleEntry to ExternalCalendarEvent format
 */
export async function mapScheduleEntryToExternalEvent(
  entry: IScheduleEntry,
  provider: 'google' | 'microsoft',
  userEmails?: Map<string, string>, // Map of user_id -> email
  owningCalendarName?: string
): Promise<ExternalCalendarEvent> {
  // Fetch user emails if not provided
  if (!userEmails && entry.assigned_user_ids.length > 0 && entry.tenant) {
    userEmails = await fetchUserEmails(entry.assigned_user_ids, entry.tenant);
  }

  // Convert dates to ISO strings
  const startDate = entry.scheduled_start instanceof Date 
    ? entry.scheduled_start 
    : new Date(entry.scheduled_start);
  const endDate = entry.scheduled_end instanceof Date 
    ? entry.scheduled_end 
    : new Date(entry.scheduled_end);

  // Midnight instants alone do not identify an all-day event: a timed
  // maintenance window can have exactly the same boundaries.
  const isAllDay = entry.is_all_day === true;

  // Build attendees list from assigned user IDs
  const attendees = entry.assigned_user_ids
    .map(userId => {
      const email = userEmails?.get(userId);
      if (!email) return null;
      return {
        email,
        name: undefined, // Could be enhanced to fetch user names
        responseStatus: 'accepted' as const
      };
    })
    .filter((a): a is NonNullable<typeof a> => a !== null);

  // Convert recurrence pattern to RRULE if present
  let recurrence: string[] | undefined;
  if (entry.recurrence_pattern && entry.is_recurring) {
    try {
      const rrule = convertRecurrencePatternToRRULE(entry.recurrence_pattern);
      if (rrule) {
        recurrence = [rrule];
      }
    } catch (error) {
      console.error('Failed to convert recurrence pattern to RRULE:', error);
    }
  }

  // Build extended properties for tracking
  const extendedProperties = {
    private: {
      'alga-entry-id': entry.entry_id,
      'alga-assigned-user-ids': entry.assigned_user_ids.join(','),
      ...(entry.tenant ? { 'alga-tenant': entry.tenant } : {}),
      ...(entry.work_item_id ? { 'alga-work-item-id': entry.work_item_id } : {}),
      ...(entry.work_item_type ? { 'alga-work-item-type': String(entry.work_item_type) } : {})
    } as Record<string, string>
  };

  // Map status
  const status = entry.status === 'cancelled' ? 'cancelled' as const :
                 entry.status === 'tentative' ? 'tentative' as const :
                 'confirmed' as const;
  const notes = await buildScheduleEntryDescription(entry);
  const description = appendCalendarMarker(notes, owningCalendarName, provider);
  if (owningCalendarName) {
    extendedProperties.private[CALENDAR_MARKER_NAME_PROPERTY] = owningCalendarName;
    extendedProperties.private[CALENDAR_MARKER_NOTE_COUNT_PROPERTY] = String(Math.max(0, countCalendarMarkerLines(description, owningCalendarName) - 1));
    extendedProperties.private[CALENDAR_MARKER_NOTES_FORMAT_PROPERTY] = /<(?:p|div|br|html|body)\b/i.test(notes) ? 'html' : 'text';
  }

  // Build event object
  const event: ExternalCalendarEvent = {
    id: '', // Will be set by external calendar
    provider,
    title: entry.title,
    description,
    categories: provider === 'microsoft' && owningCalendarName ? [`Alga calendar: ${owningCalendarName}`] : undefined,
    start: isAllDay ? {
      date: formatDateOnly(startDate),
      timeZone: 'UTC'
    } : {
      dateTime: startDate.toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
    },
    end: isAllDay ? {
      date: formatDateOnly(endDate),
      timeZone: 'UTC'
    } : {
      dateTime: endDate.toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
    },
    status,
    visibility: entry.is_private ? 'private' as const : 'default' as const,
    attendees: attendees.length > 0 ? attendees : undefined,
    recurrence,
    extendedProperties
  };

  return event;
}

const CALENDAR_MARKER_NAME_PROPERTY = 'alga-calendar-marker-name';
const CALENDAR_MARKER_NOTE_COUNT_PROPERTY = 'alga-calendar-marker-note-count';
const CALENDAR_MARKER_NOTES_FORMAT_PROPERTY = 'alga-calendar-marker-notes-format';

function escapeHtmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function decodeHtmlText(value: string): string {
  // Decode once: &amp;lt; is literal &lt;, not a second encoded '<'.
  const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code: string) => {
    if (!code.startsWith('#')) return entities[code.toLowerCase()] ?? entity;
    const point = code[1].toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
      ? String.fromCodePoint(point) : entity;
  });
}

function findCalendarMarkerCandidates(notes: string, calendarName: string): Array<{ start: number; end: number }> {
  const marker = `[Alga calendar: ${calendarName}]`;
  const candidates: Array<{ start: number; end: number }> = [];
  // Google appends a literal line even when existing notes contain HTML. Do
  // not decode plain text or skip the first line after an empty line.
  for (const line of notes.matchAll(/[^\r\n]+/g)) {
    if (line[0].trim() === marker) {
      const start = line.index! + line[0].indexOf(marker);
      candidates.push({ start, end: start + marker.length });
    }
  }
  const blocks = [...notes.matchAll(/<(p|div)(?:\s[^>]*)?>([^<>]*)<\/\1>/gi)];
  for (const block of blocks) {
    if (decodeHtmlText(block[2]).trim() === marker) {
      candidates.push({ start: block.index!, end: block.index! + block[0].length });
    }
  }
  // Only inspect text nodes, never tag names/attributes, and do not match
  // across elements containing user text. Blocks above own their contents.
  for (const token of notes.matchAll(/<[^>]*>|[^<]+/g)) {
    if (token[0].startsWith('<') || blocks.some(block => token.index! >= block.index! && token.index! < block.index! + block[0].length)) continue;
    for (const line of token[0].matchAll(/[^\r\n]+/g)) {
      if (decodeHtmlText(line[0]).trim() !== marker) continue;
      const start = token.index! + line.index!;
      const end = start + line[0].length;
      if (!candidates.some(candidate => candidate.start >= start && candidate.end <= end)) candidates.push({ start, end });
    }
  }
  return candidates.sort((left, right) => left.start - right.start);
}

function countCalendarMarkerLines(notes: string, calendarName: string): number {
  return findCalendarMarkerCandidates(notes, calendarName).length;
}

function appendCalendarMarker(notes: string, calendarName: string | undefined, provider: 'google' | 'microsoft'): string {
  if (!calendarName) return notes;
  const marker = `[Alga calendar: ${calendarName}]`;
  if (provider !== 'microsoft') return `${notes}${notes ? '\n' : ''}${marker}`;

  const paragraph = `<p>${escapeHtmlText(marker)}</p>`;
  if (/<(?:p|div|br|html|body)\b/i.test(notes)) {
    if (/<\/body>/i.test(notes)) return notes.replace(/<\/body>/i, `\n${paragraph}</body>`);
    if (/<\/html>/i.test(notes)) return notes.replace(/<\/html>/i, `\n${paragraph}</html>`);
    return `${notes}${notes ? '\n' : ''}${paragraph}`;
  }
  const safeNotes = escapeHtmlText(notes).replace(/\r\n|\r|\n/g, '<br>');
  return `${safeNotes}${safeNotes ? '\n' : ''}${paragraph}`;
}

function stripCalendarMarker(notes: string | undefined, markerName?: string, originalMarkerCount?: number): string | undefined {
  if (notes === undefined || markerName === undefined || typeof originalMarkerCount !== 'number' || !Number.isInteger(originalMarkerCount) || originalMarkerCount < 0) return notes;
  const candidates = findCalendarMarkerCandidates(notes, markerName);
  // Private event metadata records matching complete lines in the user's notes
  // before injection. If the injected line was removed externally, don't strip
  // one of those remaining user-authored lines.
  if (candidates.length <= originalMarkerCount) return notes;
  const injected = candidates[candidates.length - 1];
  let removeStart = injected.start;
  let removeEnd = injected.end;
  if (notes.slice(0, injected.start).endsWith('\n')) removeStart--;
  else if (notes.slice(injected.end).startsWith('\r\n')) removeEnd += 2;
  else if (notes.slice(injected.end).startsWith('\n')) removeEnd++;
  const remaining = notes.slice(0, removeStart) + notes.slice(removeEnd);
  return /<\/?(?:html|body)\b/i.test(remaining) && /^\s*(?:<html(?:\s[^>]*)?>\s*)?(?:<body(?:\s[^>]*)?>\s*)?(?:<\/body>\s*)?(?:<\/html>\s*)?$/i.test(remaining) ? '' : remaining || '';
}

function restoreCalendarNotes(notes: string | undefined, provider: 'google' | 'microsoft', format?: string): string | undefined {
  if (notes === undefined || provider !== 'microsoft' || format !== 'text') return notes;
  const hadParagraphBoundary = /<\/(?:p|div)\s*>/i.test(notes);
  let text = notes
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(?:p|div)\s*>/gi, '\n')
    .replace(/<(?:p|div)(?:\s[^>]*)?>/gi, '')
    .replace(/<\/?(?:html|body)(?:\s[^>]*)?>/gi, '')
    .replace(/<[^>]*>/g, '');
  if (hadParagraphBoundary && text.endsWith('\n')) text = text.slice(0, -1);
  return decodeHtmlText(text);
}

export async function mapExternalEventToScheduleEntry(
  event: ExternalCalendarEvent,
  tenant: string,
  provider: 'google' | 'microsoft',
  userEmails?: Map<string, string>, // Map of email -> user_id
): Promise<Partial<IScheduleEntry>> {
  // Fetch user IDs if not provided
  if (!userEmails && event.attendees && event.attendees.length > 0) {
    const emails = event.attendees.map(a => a.email);
    userEmails = await fetchUserIdsByEmail(emails, tenant);
    console.log('[eventMapping] Fetched user IDs by email:', {
      emails,
      mappedResults: Array.from(userEmails?.entries() || [])
    });
  }

  // Parse dates
  const startDate = event.start.dateTime 
    ? parseCalendarDateTime(event.start.dateTime, event.start.timeZone)
    : event.start.date 
      ? new Date(event.start.date + 'T00:00:00Z')
      : new Date();
  
  const endDate = event.end.dateTime 
    ? parseCalendarDateTime(event.end.dateTime, event.end.timeZone)
    : event.end.date 
      ? new Date(event.end.date + 'T00:00:00Z')
      : new Date();

  // Extract Alga entry ID from extended properties if present
  const algaEntryId = event.extendedProperties?.private?.['alga-entry-id'];
  const workItemId = event.extendedProperties?.private?.['alga-work-item-id'];
  const storedAssignedUserIds = event.extendedProperties?.private?.['alga-assigned-user-ids'];
  
  let workItemType = event.extendedProperties?.private?.['alga-work-item-type'] as WorkItemType | undefined;
  if (typeof workItemType === 'string') {
    workItemType = workItemType.toLowerCase() as WorkItemType;
  }

  // Initialize assigned user IDs
  let assignedUserIds: string[] = [];

  // 1. Try to use stored Alga user IDs first (most reliable)
  if (storedAssignedUserIds) {
    assignedUserIds = storedAssignedUserIds.split(',').filter(id => id.trim().length > 0);
    console.log('[eventMapping] Used stored assigned user IDs:', assignedUserIds);
  } 
  
  // 2. If no stored IDs, map from attendees
  if (assignedUserIds.length === 0) {
    assignedUserIds = event.attendees
      ?.map(attendee => {
        const normalizedEmail = attendee.email?.toLowerCase?.() ?? attendee.email;
        const userId = normalizedEmail ? userEmails?.get(normalizedEmail) : undefined;
        console.log('[eventMapping] Mapping attendee:', {
          email: attendee.email,
          normalizedEmail,
          mappedUserId: userId
        });
        return userId;
      })
      .filter((id): id is string => id !== undefined) || [];

    console.log('[eventMapping] Final assigned user IDs from attendees:', {
      attendeeCount: event.attendees?.length || 0,
      mappedCount: assignedUserIds.length,
      assignedUserIds
    });

    // If no assignees detected, fallback to organizer
    if (assignedUserIds.length === 0 && event.organizer?.email) {
      const organizerEmail = event.organizer.email.toLowerCase?.() ?? event.organizer.email;
      if (organizerEmail) {
        if (!userEmails || !userEmails.has(organizerEmail)) {
          const organizerMap = await fetchUserIdsByEmail([organizerEmail], tenant);
          userEmails = userEmails ? new Map([...userEmails, ...organizerMap]) : organizerMap;
        }
        const organizerUserId = userEmails?.get(organizerEmail);
        if (organizerUserId) {
          assignedUserIds.push(organizerUserId);
        }
      }
    }
  }

  // Map status
  const status = event.status === 'cancelled' ? 'cancelled' :
                 event.status === 'tentative' ? 'tentative' :
                 'scheduled';

  // Map recurrence if present
  let recurrencePattern: IRecurrencePattern | null = null;
  if (event.recurrence && event.recurrence.length > 0) {
    try {
      const { convertRRULEToRecurrencePattern } = await import('./recurrenceConverter');
      recurrencePattern = convertRRULEToRecurrencePattern(event.recurrence[0], startDate);
    } catch (error) {
      console.error('Failed to convert RRULE to recurrence pattern:', error);
    }
  }

  const entry: Partial<IScheduleEntry> = {
    ...(algaEntryId ? { entry_id: algaEntryId } : {}),
    tenant,
    title: event.title,
    notes: restoreCalendarNotes(
      stripCalendarMarker(
        event.description,
        event.extendedProperties?.private?.[CALENDAR_MARKER_NAME_PROPERTY],
        Number.parseInt(event.extendedProperties?.private?.[CALENDAR_MARKER_NOTE_COUNT_PROPERTY] ?? '', 10)
      ),
      provider,
      event.extendedProperties?.private?.[CALENDAR_MARKER_NOTES_FORMAT_PROPERTY]
    ),
    scheduled_start: startDate,
    scheduled_end: endDate,
    is_all_day: !!event.start.date && !event.start.dateTime && !!event.end.date && !event.end.dateTime,
    status,
    assigned_user_ids: assignedUserIds,
    recurrence_pattern: recurrencePattern,
    is_recurring: !!recurrencePattern,
    is_private: event.visibility === 'private',
    ...(workItemId ? { work_item_id: workItemId } : {}),
    work_item_type: (workItemType ?? 'ad_hoc') as WorkItemType
  };

  return entry;
}

/**
 * Format date as YYYY-MM-DD for all-day events
 */
function formatDateOnly(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function buildScheduleEntryDescription(entry: IScheduleEntry): Promise<string> {
  const baseDescription = entry.notes || '';
  if (!entry.tenant || !entry.entry_id) {
    return baseDescription;
  }

  try {
    const { knex } = await createTenantKnex(entry.tenant);
    const meeting = await tenantDb(knex, entry.tenant).table('online_meetings')
      .where({
        schedule_entry_id: entry.entry_id,
      })
      .first('join_url');

    const joinUrl = meeting?.join_url;
    if (!joinUrl || baseDescription.includes(joinUrl)) {
      return baseDescription;
    }

    const joinLine = `Join Teams Meeting: ${joinUrl}`;
    return baseDescription ? `${baseDescription}\n\n${joinLine}` : joinLine;
  } catch (error) {
    console.error('Failed to append online meeting join URL to calendar event description:', error);
    return baseDescription;
  }
}

/**
 * Fetch user emails for given user IDs
 */
async function fetchUserEmails(userIds: string[], tenant: string): Promise<Map<string, string>> {
  const emailMap = new Map<string, string>();
  
  if (userIds.length === 0) {
    return emailMap;
  }

  try {
    const { knex } = await createTenantKnex(tenant);
    const users = await tenantDb(knex, tenant).table('users')
      .whereIn('user_id', userIds)
      .select('user_id', 'email');

    for (const user of users) {
      if (user.email) {
        emailMap.set(user.user_id, user.email);
      }
    }
  } catch (error) {
    console.error('Failed to fetch user emails:', error);
  }

  return emailMap;
}

/**
 * Fetch user IDs for given email addresses
 */
async function fetchUserIdsByEmail(emails: string[], tenant: string): Promise<Map<string, string>> {
  const idMap = new Map<string, string>();
  
  if (emails.length === 0) {
    return idMap;
  }

  try {
    const { knex } = await createTenantKnex(tenant);
    const normalizedEmails = emails
      .filter((email): email is string => typeof email === 'string' && email.trim().length > 0)
      .map(email => email.toLowerCase());

    if (normalizedEmails.length === 0) {
      return idMap;
    }

    const users = await tenantDb(knex, tenant).table('users')
      .whereRaw('LOWER(email) IN (?)', [normalizedEmails])
      .select('user_id', 'email');

    for (const user of users) {
      if (user.email) {
        idMap.set(user.email.toLowerCase(), user.user_id);
      }
    }
  } catch (error) {
    console.error('Failed to fetch user IDs by email:', error);
  }

  return idMap;
}

async function fetchFallbackUserId(tenant: string): Promise<string | null> {
  try {
    const { knex } = await createTenantKnex(tenant);
    const fallbackUser = await tenantDb(knex, tenant).table('users')
      .orderBy('created_at', 'asc')
      .first('user_id');
    return fallbackUser?.user_id ?? null;
  } catch (error) {
    console.error('Failed to fetch fallback user for calendar entry:', error);
    return null;
  }
}
