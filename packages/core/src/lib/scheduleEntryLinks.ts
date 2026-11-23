/**
 * Pure, isomorphic builders and parser for the schedule entry deep link:
 *   /msp/schedule?entryId={id}[&occurrence={iso}]
 * No 'use server', Node, DB or React imports: SchedulePage (client) reads the parameter names from
 * here, and the work-item descriptor, the search indexer and every other producer build links with
 * the same code.
 */

/** MSP schedule page. */
export const SCHEDULE_ENTRY_PATH = '/msp/schedule';

/** Query parameter SchedulePage reads to open one schedule entry. */
export const SCHEDULE_ENTRY_ID_PARAM = 'entryId';

/** Optional query parameter: ISO start of one occurrence of a recurring entry. */
export const SCHEDULE_ENTRY_OCCURRENCE_PARAM = 'occurrence';

function toIso(occurrence: Date | string): string {
  const date = occurrence instanceof Date ? occurrence : new Date(occurrence);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError('occurrence must be a valid date to build a schedule entry link');
  }
  return date.toISOString();
}

/** App-relative deep link that opens the schedule at an entry (or one occurrence of a series). */
export function buildScheduleEntryLink(entryId: string, occurrence?: Date | string | null): string {
  if (typeof entryId !== 'string' || entryId.trim() === '') {
    throw new TypeError('entryId is required to build a schedule entry link');
  }
  const base = `${SCHEDULE_ENTRY_PATH}?${SCHEDULE_ENTRY_ID_PARAM}=${encodeURIComponent(entryId)}`;
  if (occurrence === undefined || occurrence === null || occurrence === '') return base;
  return `${base}&${SCHEDULE_ENTRY_OCCURRENCE_PARAM}=${encodeURIComponent(toIso(occurrence))}`;
}

export interface ScheduleEntryDeepLink {
  entryId: string;
  /** Present only when the `occurrence` parameter parsed as a valid date. */
  occurrence?: Date;
}

/** Inverse of `buildScheduleEntryLink` for a query reader; null when there is no usable `entryId`. */
export function parseScheduleEntryDeepLink(
  params: { get(name: string): string | null } | null | undefined,
): ScheduleEntryDeepLink | null {
  const entryId = params?.get(SCHEDULE_ENTRY_ID_PARAM)?.trim();
  if (!entryId) return null;
  const rawOccurrence = params?.get(SCHEDULE_ENTRY_OCCURRENCE_PARAM);
  if (rawOccurrence) {
    const occurrence = new Date(rawOccurrence);
    if (!Number.isNaN(occurrence.getTime())) return { entryId, occurrence };
  }
  return { entryId };
}
