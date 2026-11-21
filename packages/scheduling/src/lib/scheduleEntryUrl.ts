export type ScheduleEntryUrlSelection = {
  entryId: string;
  occurrenceStart?: string;
  date: string;
  view: 'day' | 'week' | 'month';
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function parseScheduleEntryUrl(params: URLSearchParams): ScheduleEntryUrlSelection | null {
  const entryId = params.get('entryId');
  if (!entryId || !UUID.test(entryId)) return null;
  const occurrenceStart = params.get('occurrenceStart') ?? undefined;
  if (occurrenceStart && (!ISO_INSTANT.test(occurrenceStart) || !Number.isFinite(Date.parse(occurrenceStart)) || new Date(occurrenceStart).toISOString() !== occurrenceStart)) return null;

  const rawDate = params.get('scheduleDate') ?? occurrenceStart?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
  if (!ISO_DATE.test(rawDate) || Number.isNaN(Date.parse(`${rawDate}T00:00:00.000Z`)) || new Date(`${rawDate}T00:00:00.000Z`).toISOString().slice(0, 10) !== rawDate) return null;
  const rawView = params.get('scheduleView');
  if (rawView !== null && rawView !== 'day' && rawView !== 'week' && rawView !== 'month') return null;
  const view = rawView ?? 'day';
  return { entryId, ...(occurrenceStart ? { occurrenceStart } : {}), date: rawDate, view };
}

export function writeScheduleEntryUrl(params: URLSearchParams, selection: ScheduleEntryUrlSelection | null): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const key of ['entryId', 'occurrenceStart', 'scheduleDate', 'scheduleView']) next.delete(key);
  if (selection) {
    next.set('entryId', selection.entryId);
    if (selection.occurrenceStart) next.set('occurrenceStart', selection.occurrenceStart);
    next.set('scheduleDate', selection.date);
    next.set('scheduleView', selection.view);
  }
  return next;
}
