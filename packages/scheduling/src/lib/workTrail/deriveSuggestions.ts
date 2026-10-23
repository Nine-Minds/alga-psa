import { computeWorkDateFields } from '@alga-psa/db';

/**
 * Work trail -> suggested time entries (plan sections D14 / 8). Pure: no I/O.
 *
 * A "touch" is one ticket_audit_logs row authored by the user. Touches are grouped by
 * (ticket, local work date in the user's timezone) using the same date conversion that stamps
 * time_entries.work_date (computeWorkDateFields), so a suggestion's date always matches the date a
 * resulting time entry would get.
 */

export interface WorkTrailTouch {
  ticket_id: string;
  occurred_at: string | Date;
  event_type: string;
  ticket_number?: string | null;
  title?: string | null;
  client_name?: string | null;
}

export interface TimeEntrySuggestion {
  ticket_id: string;
  ticket_number: string;
  title: string;
  client_name: string | null;
  /** Local work date (YYYY-MM-DD) in the user's timezone. */
  work_date: string;
  /** IANA zone the work date (and display times) are in: the subject user's. */
  time_zone: string;
  /** ISO instants. */
  first_touch: string;
  last_touch: string;
  event_count: number;
  /** Distinct audit event types, in order of first occurrence. */
  event_kinds: string[];
}

export interface DeriveSuggestionsInput {
  touches: WorkTrailTouch[];
  timeZone: string | null | undefined;
  /** (ticket_id, work_date) pairs that already have a time entry for the user. */
  loggedPairs: Array<{ ticket_id: string; work_date: string }>;
  /** Ticket ids with an open (running/paused) stopwatch session. */
  openSessionTicketIds: Iterable<string>;
  /** (ticket_id, work_date) pairs the user dismissed. */
  dismissals: Array<{ ticket_id: string; work_date: string }>;
}

const pairKey = (ticketId: string, workDate: string) => `${ticketId}|${workDate}`;

/** Normalise a work_date coming from pg (Date or string) to YYYY-MM-DD. */
export function toWorkDateString(value: string | Date): string {
  if (typeof value === 'string') return value.slice(0, 10);
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function deriveSuggestions(input: DeriveSuggestionsInput): TimeEntrySuggestion[] {
  const logged = new Set(input.loggedPairs.map((p) => pairKey(p.ticket_id, toWorkDateString(p.work_date))));
  const dismissed = new Set(input.dismissals.map((p) => pairKey(p.ticket_id, toWorkDateString(p.work_date))));
  const open = new Set(input.openSessionTicketIds);

  const groups = new Map<string, { suggestion: TimeEntrySuggestion; firstMs: number; lastMs: number }>();

  for (const touch of input.touches) {
    if (open.has(touch.ticket_id)) continue;
    const occurredMs = new Date(touch.occurred_at).getTime();
    if (Number.isNaN(occurredMs)) continue;
    const iso = new Date(occurredMs).toISOString();
    const { work_date, work_timezone } = computeWorkDateFields(iso, input.timeZone);
    const key = pairKey(touch.ticket_id, work_date);
    if (logged.has(key) || dismissed.has(key)) continue;

    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        firstMs: occurredMs,
        lastMs: occurredMs,
        suggestion: {
          ticket_id: touch.ticket_id,
          ticket_number: touch.ticket_number ?? '',
          title: touch.title ?? '',
          client_name: touch.client_name ?? null,
          work_date,
          time_zone: work_timezone,
          first_touch: iso,
          last_touch: iso,
          event_count: 1,
          event_kinds: [touch.event_type],
        },
      });
      continue;
    }
    existing.suggestion.event_count += 1;
    if (!existing.suggestion.event_kinds.includes(touch.event_type)) {
      existing.suggestion.event_kinds.push(touch.event_type);
    }
    if (occurredMs < existing.firstMs) {
      existing.firstMs = occurredMs;
      existing.suggestion.first_touch = iso;
    }
    if (occurredMs > existing.lastMs) {
      existing.lastMs = occurredMs;
      existing.suggestion.last_touch = iso;
    }
  }

  return [...groups.values()]
    .sort((a, b) => {
      if (a.suggestion.work_date !== b.suggestion.work_date) {
        return a.suggestion.work_date < b.suggestion.work_date ? -1 : 1;
      }
      return a.firstMs - b.firstMs;
    })
    .map((g) => g.suggestion);
}
