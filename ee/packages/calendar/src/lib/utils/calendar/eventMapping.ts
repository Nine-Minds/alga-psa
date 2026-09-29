/**
 * Event mapping utilities for converting between IScheduleEntry and ExternalCalendarEvent.
 */

import type {
  ExternalCalendarEvent,
  IRecurrencePattern,
  IScheduleEntry,
  WorkItemType,
} from '@alga-psa/types';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { parseCalendarDateTime } from '@alga-psa/core';
import { convertRecurrencePatternToRRULE } from './recurrenceConverter';

export async function mapScheduleEntryToExternalEvent(
  entry: IScheduleEntry,
  provider: 'google' | 'microsoft',
  userEmails?: Map<string, string>,
  owningCalendarName?: string
): Promise<ExternalCalendarEvent> {
  if (!userEmails && entry.assigned_user_ids.length > 0 && entry.tenant) {
    userEmails = await fetchUserEmails(entry.assigned_user_ids, entry.tenant);
  }

  const startDate =
    entry.scheduled_start instanceof Date ? entry.scheduled_start : new Date(entry.scheduled_start);
  const endDate =
    entry.scheduled_end instanceof Date ? entry.scheduled_end : new Date(entry.scheduled_end);

  const isAllDay = entry.is_all_day === true;

  const attendees = entry.assigned_user_ids
    .map((userId) => {
      const email = userEmails?.get(userId);
      if (!email) return null;
      return {
        email,
        name: undefined,
        responseStatus: 'accepted' as const,
      };
    })
    .filter((attendee): attendee is NonNullable<typeof attendee> => attendee !== null);

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

  const extendedProperties = {
    private: {
      'alga-entry-id': entry.entry_id,
      'alga-assigned-user-ids': entry.assigned_user_ids.join(','),
      ...(entry.tenant ? { 'alga-tenant': entry.tenant } : {}),
      ...(entry.work_item_id ? { 'alga-work-item-id': entry.work_item_id } : {}),
      ...(entry.work_item_type ? { 'alga-work-item-type': String(entry.work_item_type) } : {}),
    } as Record<string, string>,
  };

  const status =
    entry.status === 'cancelled'
      ? ('cancelled' as const)
      : entry.status === 'tentative'
        ? ('tentative' as const)
        : ('confirmed' as const);

  return {
    id: '',
    provider,
    title: entry.title,
    description: appendCalendarMarker(entry.notes || '', owningCalendarName),
    categories: provider === 'microsoft' && owningCalendarName ? [`Alga calendar: ${owningCalendarName}`] : undefined,
    start: isAllDay
      ? { date: formatDateOnly(startDate), timeZone: 'UTC' }
      : {
          dateTime: startDate.toISOString(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
    end: isAllDay
      ? { date: formatDateOnly(endDate), timeZone: 'UTC' }
      : {
          dateTime: endDate.toISOString(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
    status,
    visibility: entry.is_private ? ('private' as const) : ('default' as const),
    attendees: attendees.length > 0 ? attendees : undefined,
    recurrence,
    extendedProperties,
  };
}

const calendarMarker = (name: string) => `[Alga calendar: ${name}]`;

function appendCalendarMarker(notes: string, calendarName?: string): string {
  if (!calendarName) return notes;
  const marker = calendarMarker(calendarName);
  // Idempotence also protects callers that pass previously mapped notes.
  return providerBody(notes, marker);
}

function providerBody(notes: string, marker: string): string {
  // Microsoft Graph body content is HTML; keep user HTML intact and append a
  // standalone paragraph. Google event descriptions are plain text.
  if (/<(?:p|div|br|html|body)\b/i.test(notes)) {
    const content = notes;
    const paragraph = `<p>${escapeHtml(marker)}</p>`;
    if (/<\/body>/i.test(content)) return content.replace(/<\/body>/i, `\n${paragraph}</body>`);
    if (/<\/html>/i.test(content)) return content.replace(/<\/html>/i, `\n${paragraph}</html>`);
    return `${content}${content ? '\n' : ''}${paragraph}`;
  }
  return `${notes}${notes ? '\n' : ''}${marker}`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

export async function mapExternalEventToScheduleEntry(
  event: ExternalCalendarEvent,
  tenant: string,
  provider: 'google' | 'microsoft',
  userEmails?: Map<string, string>,
  owningCalendarName?: string,
  trustedGroupEntry = false
): Promise<Partial<IScheduleEntry>> {
  if (!userEmails && event.attendees && event.attendees.length > 0) {
    const emails = event.attendees.map((attendee) => attendee.email);
    userEmails = await fetchUserIdsByEmail(emails, tenant);
    console.log('[eventMapping] Fetched user IDs by email:', {
      emails,
      mappedResults: Array.from(userEmails?.entries() || []),
    });
  }

  const startDate = event.start.dateTime
    ? parseCalendarDateTime(event.start.dateTime, event.start.timeZone)
    : event.start.date
      ? new Date(`${event.start.date}T00:00:00Z`)
      : new Date();

  const endDate = event.end.dateTime
    ? parseCalendarDateTime(event.end.dateTime, event.end.timeZone)
    : event.end.date
      ? new Date(`${event.end.date}T00:00:00Z`)
      : new Date();

  const algaEntryId = event.extendedProperties?.private?.['alga-entry-id'];
  const workItemId = event.extendedProperties?.private?.['alga-work-item-id'];
  const storedAssignedUserIds = event.extendedProperties?.private?.['alga-assigned-user-ids'];

  let workItemType = event.extendedProperties?.private?.[
    'alga-work-item-type'
  ] as WorkItemType | undefined;
  if (typeof workItemType === 'string') {
    workItemType = workItemType.toLowerCase() as WorkItemType;
  }

  let assignedUserIds: string[] = [];

  if (storedAssignedUserIds) {
    assignedUserIds = storedAssignedUserIds.split(',').filter((id) => id.trim().length > 0);
    console.log('[eventMapping] Used stored assigned user IDs:', assignedUserIds);
  }

  if (assignedUserIds.length === 0) {
    assignedUserIds =
      event.attendees
        ?.map((attendee) => {
          const normalizedEmail = attendee.email?.toLowerCase?.() ?? attendee.email;
          const userId = normalizedEmail ? userEmails?.get(normalizedEmail) : undefined;
          console.log('[eventMapping] Mapping attendee:', {
            email: attendee.email,
            normalizedEmail,
            mappedUserId: userId,
          });
          return userId;
        })
        .filter((id): id is string => id !== undefined) || [];

    console.log('[eventMapping] Final assigned user IDs from attendees:', {
      attendeeCount: event.attendees?.length || 0,
      mappedCount: assignedUserIds.length,
      assignedUserIds,
    });

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

  const status =
    event.status === 'cancelled'
      ? 'cancelled'
      : event.status === 'tentative'
        ? 'tentative'
        : 'scheduled';

  let recurrencePattern: IRecurrencePattern | null = null;
  if (event.recurrence && event.recurrence.length > 0) {
    try {
      const { convertRRULEToRecurrencePattern } = await import('./recurrenceConverter');
      recurrencePattern = convertRRULEToRecurrencePattern(event.recurrence[0], startDate);
    } catch (error) {
      console.error('Failed to convert RRULE to recurrence pattern:', error);
    }
  }

  return {
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
    work_item_type: (workItemType ?? 'ad_hoc') as WorkItemType,
  };
}

function formatDateOnly(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function fetchUserEmails(userIds: string[], tenant: string): Promise<Map<string, string>> {
  const emailMap = new Map<string, string>();
  if (userIds.length === 0) {
    return emailMap;
  }

  const { knex } = await createTenantKnex(tenant);
  const users = await tenantDb(knex, tenant).table('users')
    .whereIn('user_id', userIds)
    .select('user_id', 'email');

  for (const user of users) {
    if (user.user_id && user.email) {
      emailMap.set(user.user_id, user.email);
    }
  }

  return emailMap;
}

async function fetchUserIdsByEmail(emails: string[], tenant: string): Promise<Map<string, string>> {
  const userMap = new Map<string, string>();
  if (emails.length === 0) {
    return userMap;
  }

  const normalizedEmails = Array.from(
    new Set(
      emails
        .map((email) => email?.trim().toLowerCase())
        .filter((email): email is string => Boolean(email))
    )
  );

  const { knex } = await createTenantKnex(tenant);
  const users = await tenantDb(knex, tenant).table('users')
    .whereRaw(
      `LOWER(email) IN (${normalizedEmails.map(() => '?').join(', ')})`,
      normalizedEmails
    )
    .select('user_id', 'email');

  for (const user of users) {
    if (user.user_id && user.email) {
      userMap.set(String(user.email).trim().toLowerCase(), user.user_id);
    }
  }

  return userMap;
}
