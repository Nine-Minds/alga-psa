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
  const description = appendCalendarMarker(await buildScheduleEntryDescription(entry), owningCalendarName);

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

function appendCalendarMarker(notes: string, calendarName?: string): string {
  if (!calendarName) return notes;
  const base = notes;
  const marker = `[Alga calendar: ${calendarName}]`;
  if (/<(?:p|div|br|html|body)\b/i.test(base)) {
    const escaped = marker.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const content = base;
    const paragraph = `<p>${escaped}</p>`;
    if (/<\/body>/i.test(content)) return content.replace(/<\/body>/i, `\n${paragraph}</body>`);
    if (/<\/html>/i.test(content)) return content.replace(/<\/html>/i, `\n${paragraph}</html>`);
    return `${content}${content ? '\n' : ''}${paragraph}`;
  }
  return `${base}${base ? '\n' : ''}${marker}`;
}

function stripCalendarMarker(notes?: string, calendarName?: string, trustedGroupEntry = false): string | undefined {
  if (notes === undefined || !trustedGroupEntry) return notes;
  const markerText = (value: string) => {
    const decoded = value.replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").trim();
    const match = decoded.match(/^\[Alga calendar: (.+)\]$/);
    return match ? { text: decoded, name: match[1] } : null;
  };
  const isPreferred = (value: string) => {
    const parsed = markerText(value);
    return !!parsed && !!calendarName && parsed.name === calendarName;
  };

  // Outlook commonly normalizes line breaks to paragraphs. Inspect each simple
  // paragraph independently so matching cannot span user-content elements.
  const paragraphPattern = /<p(?:\s[^>]*)?>([^<>]*)<\/p>/gi;
  const paragraphs = [...notes.matchAll(paragraphPattern)];
  const validParagraphs = paragraphs.filter(match => markerText(match[1]));
  const selectedParagraph = validParagraphs.findLast(match => isPreferred(match[1]))
    ?? validParagraphs.at(-1);
  if (selectedParagraph && selectedParagraph.index !== undefined) {
    const start = selectedParagraph.index;
    const end = start + selectedParagraph[0].length;
    let removeStart = start;
    let removeEnd = end;
    if (notes.slice(0, start).endsWith('\n')) removeStart--;
    else if (notes.slice(end).startsWith('\n')) removeEnd++;
    const remaining = notes.slice(0, removeStart) + notes.slice(removeEnd);
    return /^\s*(?:<html(?:\s[^>]*)?>\s*)?(?:<body(?:\s[^>]*)?>\s*)?(?:<\/body>\s*)?(?:<\/html>\s*)?$/i.test(remaining) ? '' : remaining;
  }

  const lines = [...notes.matchAll(/(^|\r?\n)([^\r\n]*)/g)];
  const candidates = lines.filter(match => markerText(match[2]));
  const selectedLine = candidates.findLast(match => isPreferred(match[2])) ?? candidates.at(-1);
  if (!selectedLine || selectedLine.index === undefined) return notes;
  const lineStart = selectedLine.index + selectedLine[1].length;
  const lineEnd = lineStart + selectedLine[2].length;
  let removeStart = lineStart;
  let removeEnd = lineEnd;
  // The newline immediately before a generated marker is the injected
  // separator. Removing that one preserves any whitespace already in notes.
  if (selectedLine[1]) removeStart = selectedLine.index;
  else if (notes.slice(lineEnd).startsWith('\r\n')) removeEnd += 2;
  else if (notes.slice(lineEnd).startsWith('\n')) removeEnd++;
  const remaining = notes.slice(0, removeStart) + notes.slice(removeEnd);
  return remaining || '';
}

/**
 * Map ExternalCalendarEvent to IScheduleEntry format
 */
export async function mapExternalEventToScheduleEntry(
  event: ExternalCalendarEvent,
  tenant: string,
  provider: 'google' | 'microsoft',
  userEmails?: Map<string, string>, // Map of email -> user_id
  owningCalendarName?: string,
  trustedGroupEntry = false
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
    notes: stripCalendarMarker(event.description, owningCalendarName, trustedGroupEntry),
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
