/**
 * Cursor-bounded collection of Huntress incident reports.
 *
 * The Huntress API cannot filter by "updated since"; callers fetch pages
 * sorted by updated_at DESC and this walker stops once rows fall behind the
 * boundary (cursor minus a small overlap, or the backfill window on first
 * run). Reprocessing inside the overlap is harmless — the processor dedups
 * on external_alert_id.
 */

import type { HuntressIncidentReport } from '../../../../interfaces/huntress.interfaces';

export interface CursorWalkPage {
  incidents: HuntressIncidentReport[];
  nextPageToken?: string;
}

export type FetchIncidentsPage = (pageToken?: string) => Promise<CursorWalkPage>;

export interface CursorWalkOptions {
  /** Last fully processed updated_at (ISO-8601), or null on first run. */
  cursorIso: string | null;
  backfillDays: number;
  /** Injection point for tests; defaults to the current time. */
  now?: Date;
  overlapMs?: number;
  maxPages?: number;
}

const DEFAULT_OVERLAP_MS = 60_000;
const DEFAULT_MAX_PAGES = 20;

export async function collectIncidentsSince(
  fetchPage: FetchIncidentsPage,
  options: CursorWalkOptions
): Promise<HuntressIncidentReport[]> {
  const now = options.now ?? new Date();
  const overlapMs = options.overlapMs ?? DEFAULT_OVERLAP_MS;
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;

  const boundaryMs = options.cursorIso
    ? Date.parse(options.cursorIso) - overlapMs
    : now.getTime() - options.backfillDays * 24 * 60 * 60 * 1000;

  const collected: HuntressIncidentReport[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const result = await fetchPage(pageToken);
    let hitBoundary = false;

    for (const item of result.incidents) {
      const updatedMs = Date.parse(item.updated_at);
      if (Number.isFinite(updatedMs) && updatedMs >= boundaryMs) {
        collected.push(item);
      } else {
        hitBoundary = true;
        break;
      }
    }

    if (hitBoundary || !result.nextPageToken) break;
    pageToken = result.nextPageToken;
  }

  return collected.sort((a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at));
}
