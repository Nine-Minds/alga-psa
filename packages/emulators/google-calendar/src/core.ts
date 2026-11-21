import * as rrulePkg from 'rrule';
import type { EmulatorCore, HostEnv } from '@alga-psa/emulator-host';

// `rrule` ships a webpack UMD bundle with no `exports` map, so plain Node ESM
// (this package runs unbundled inside the algasim container) cannot
// statically detect its named exports and only exposes `default`. Resolve
// either shape, matching shared/utils/recurrenceUtils.ts.
type RRuleStrFn = typeof import('rrule').rrulestr;

function resolveRrulestr(): RRuleStrFn {
  const rruleExports = rrulePkg as unknown as { rrulestr?: RRuleStrFn; default?: { rrulestr?: RRuleStrFn } };
  const resolved = rruleExports.rrulestr ?? rruleExports.default?.rrulestr;
  if (!resolved) {
    throw new Error('Unable to resolve rrulestr export from rrule package');
  }
  return resolved;
}

const rrulestr = resolveRrulestr();

/** An error carrying the status and body the Google Calendar API would return. */
export class GoogleCalendarApiError extends Error {
  constructor(public readonly status: number, public readonly body: unknown) {
    super(typeof body === 'object' && body && 'error' in body ? String((body as any).error?.message ?? status) : String(status));
    this.name = 'GoogleCalendarApiError';
  }
}

function apiError(status: number, reason: string, message: string): GoogleCalendarApiError {
  return new GoogleCalendarApiError(status, {
    error: { errors: [{ domain: 'calendar', reason, message }], code: status, message, status: STATUS_NAMES[status] },
  });
}

const STATUS_NAMES: Record<number, string> = {
  400: 'INVALID_ARGUMENT', 401: 'UNAUTHENTICATED', 404: 'NOT_FOUND', 409: 'ALREADY_EXISTS', 410: 'GONE',
};

export interface GoogleEventDate {
  dateTime?: string;
  date?: string;
  timeZone?: string;
}

export interface GoogleCalendarEvent {
  id: string;
  status: 'confirmed' | 'tentative' | 'cancelled';
  summary?: string;
  description?: string;
  location?: string;
  start: GoogleEventDate;
  end: GoogleEventDate;
  /** RRULE/EXDATE/RDATE lines; present on a series master only. */
  recurrence?: string[];
  /** Set on an instance (expanded occurrence or stored exception). */
  recurringEventId?: string;
  originalStartTime?: GoogleEventDate;
  attendees?: Array<{ email: string; displayName?: string; responseStatus?: string }>;
  organizer?: { email: string; displayName?: string };
  extendedProperties?: { private?: Record<string, string>; shared?: Record<string, string> };
  visibility?: string;
  iCalUID?: string;
  htmlLink?: string;
  created: string;
  updated: string;
}

export interface ListEventsInput {
  calendarId: string;
  singleEvents?: boolean;
  showDeleted?: boolean;
  timeMin?: string;
  timeMax?: string;
  maxResults?: number;
  pageToken?: string;
  syncToken?: string;
  orderBy?: string;
}

export interface ListEventsResult {
  items: GoogleCalendarEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

interface ListPage {
  items: GoogleCalendarEvent[];
  offset: number;
  maxResults: number;
  syncToken: string;
  fingerprints: Map<string, string>;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * Google answers an unbounded series with a large but finite set of instances:
 * the production case produced 730 monthly occurrences, out to 2087. The
 * emulator mirrors "cap by count" with the same default.
 */
const DEFAULT_EXPANSION_CAP = 730;

export class GoogleCalendarCore implements EmulatorCore {
  readonly env: HostEnv;
  /** Stored events: masters, standalone events and stored instance overrides. */
  readonly events = new Map<string, GoogleCalendarEvent>();
  readonly calendars = new Map<string, { id: string; summary: string; primary?: boolean; timeZone: string }>();
  /** masterId -> cancelled occurrence slots, keyed by the slot's ISO instant. */
  private readonly cancellations = new Map<string, Set<string>>();
  /**
   * `${masterId}|${slot}` -> when that one occurrence last changed. Editing a
   * single occurrence leaves the other instances' `updated` alone, so an
   * incremental round reports only the occurrence that moved.
   */
  private readonly slotUpdates = new Map<string, string>();
  private readonly syncTokens = new Map<string, Map<string, string>>();
  private readonly pages = new Map<string, ListPage>();
  readonly channels = new Map<string, { id: string; resourceId: string; address: string; token?: string; expiration: number }>();
  private refreshTokens = new Map<string, string>();
  private accessTokens = new Set<string>();
  private sequence = 0;
  expansionCap = DEFAULT_EXPANSION_CAP;

  constructor(env: HostEnv) {
    this.env = env;
    this.reset();
  }

  reset(): void {
    this.events.clear();
    this.calendars.clear();
    this.cancellations.clear();
    this.slotUpdates.clear();
    this.syncTokens.clear();
    this.pages.clear();
    this.channels.clear();
    this.refreshTokens = new Map([['emulated-refresh-token', 'primary']]);
    this.accessTokens = new Set(['emulated-access-token']);
    this.sequence = 0;
    this.expansionCap = DEFAULT_EXPANSION_CAP;
    this.calendars.set('primary', { id: 'primary', summary: 'Emulated calendar', primary: true, timeZone: 'America/New_York' });
  }

  private newId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}${this.sequence.toString(36)}${Math.floor(this.env.rng() * 1e6).toString(36)}`;
  }

  // ---------------------------------------------------------------- OAuth

  seedClient(input: { refreshToken?: string; accessToken?: string } = {}): { refreshToken: string; accessToken: string } {
    const refreshToken = input.refreshToken ?? 'emulated-refresh-token';
    const accessToken = input.accessToken ?? 'emulated-access-token';
    this.refreshTokens.set(refreshToken, 'primary');
    this.accessTokens.add(accessToken);
    return { refreshToken, accessToken };
  }

  refreshAccessToken(refreshToken: string): { access_token: string; expires_in: number; token_type: 'Bearer'; scope: string } {
    if (!this.refreshTokens.has(refreshToken)) {
      throw new GoogleCalendarApiError(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
    }
    const accessToken = this.newId('access-');
    this.accessTokens.add(accessToken);
    return {
      access_token: accessToken,
      expires_in: 3600,
      token_type: 'Bearer',
      scope: 'https://www.googleapis.com/auth/calendar',
    };
  }

  authorize(header: string | undefined): void {
    const token = /^Bearer\s+(.+)$/i.exec(header ?? '')?.[1];
    if (!token || !this.accessTokens.has(token)) {
      throw apiError(401, 'authError', 'Invalid Credentials');
    }
  }

  // ------------------------------------------------------------- Calendars

  getCalendar(calendarId: string): { id: string; summary: string; primary?: boolean; timeZone: string } {
    const calendar = this.calendars.get(calendarId);
    if (!calendar) throw apiError(404, 'notFound', 'Not Found');
    return calendar;
  }

  // ---------------------------------------------------------------- Events

  /** Insert a stored event. A `recurrence` array makes it a series master. */
  insertEvent(calendarId: string, body: Record<string, any>): GoogleCalendarEvent {
    this.getCalendar(calendarId);
    const now = this.env.clock.now().toISOString();
    const id = typeof body.id === 'string' && body.id ? body.id : this.newId('event');
    if (this.events.has(id)) throw apiError(409, 'duplicate', 'The requested identifier already exists.');
    const event: GoogleCalendarEvent = {
      id,
      status: (body.status as GoogleCalendarEvent['status']) ?? 'confirmed',
      summary: body.summary ?? '',
      description: body.description ?? '',
      location: body.location ?? '',
      start: normalizeDate(body.start, 'start'),
      end: normalizeDate(body.end, 'end'),
      ...(Array.isArray(body.recurrence) && body.recurrence.length > 0 ? { recurrence: body.recurrence.map(String) } : {}),
      ...(body.recurringEventId ? { recurringEventId: String(body.recurringEventId) } : {}),
      ...(body.originalStartTime ? { originalStartTime: normalizeDate(body.originalStartTime, 'originalStartTime') } : {}),
      ...(Array.isArray(body.attendees) ? { attendees: body.attendees } : {}),
      ...(body.organizer ? { organizer: body.organizer } : {}),
      ...(body.extendedProperties ? { extendedProperties: body.extendedProperties } : {}),
      ...(body.visibility ? { visibility: String(body.visibility) } : {}),
      iCalUID: `${id}@google.com`,
      htmlLink: `https://calendar.google.com/calendar/event?eid=${id}`,
      created: now,
      updated: now,
    };
    this.events.set(event.id, event);
    return event;
  }

  getEvent(calendarId: string, eventId: string): GoogleCalendarEvent {
    this.getCalendar(calendarId);
    const stored = this.events.get(eventId);
    if (stored) return stored;
    // An expanded instance is addressable even though only its master is stored.
    const instance = this.resolveInstanceId(eventId);
    if (instance) return instance;
    throw apiError(404, 'notFound', 'Not Found');
  }

  updateEvent(calendarId: string, eventId: string, body: Record<string, any>, merge: boolean): GoogleCalendarEvent {
    const existing = this.getEvent(calendarId, eventId);
    const stored = this.events.get(eventId);
    const next: GoogleCalendarEvent = {
      ...(merge ? existing : { ...existing, summary: '', description: '', location: '' }),
      ...('summary' in body ? { summary: body.summary ?? '' } : {}),
      ...('description' in body ? { description: body.description ?? '' } : {}),
      ...('location' in body ? { location: body.location ?? '' } : {}),
      ...('status' in body ? { status: body.status } : {}),
      ...('start' in body ? { start: normalizeDate(body.start, 'start') } : {}),
      ...('end' in body ? { end: normalizeDate(body.end, 'end') } : {}),
      ...('recurrence' in body ? { recurrence: Array.isArray(body.recurrence) && body.recurrence.length ? body.recurrence.map(String) : undefined } : {}),
      ...('attendees' in body ? { attendees: body.attendees } : {}),
      ...('extendedProperties' in body ? { extendedProperties: body.extendedProperties } : {}),
      ...('visibility' in body ? { visibility: body.visibility } : {}),
      updated: this.env.clock.now().toISOString(),
    };
    // Editing an expanded instance materializes it as a stored exception, the
    // way Google does for "this event only".
    this.events.set(next.id, next);
    if (!stored && next.recurringEventId && next.originalStartTime) {
      this.slotUpdates.set(`${next.recurringEventId}|${slotOf(next.originalStartTime)}`, next.updated);
    }
    return next;
  }

  deleteEvent(calendarId: string, eventId: string): void {
    const event = this.getEvent(calendarId, eventId);
    if (this.events.has(eventId)) {
      this.events.delete(eventId);
      if (event.recurringEventId) this.cancelOccurrence(event.recurringEventId, slotOf(event.originalStartTime ?? event.start));
      else this.cancellations.delete(eventId);
      return;
    }
    // Deleting an expanded instance cancels that occurrence of the master.
    this.cancelOccurrence(event.recurringEventId!, slotOf(event.originalStartTime ?? event.start));
  }

  /** Cancel one occurrence: it then lists as a cancelled instance (showDeleted). */
  cancelOccurrence(masterId: string, slot: string): void {
    const master = this.events.get(masterId);
    if (!master?.recurrence) throw apiError(404, 'notFound', 'Not Found');
    const slots = this.cancellations.get(masterId) ?? new Set<string>();
    slots.add(slot);
    this.cancellations.set(masterId, slots);
    this.slotUpdates.set(`${masterId}|${slot}`, this.env.clock.now().toISOString());
  }

  /**
   * Expanded instances of every series master, plus stored events. Only ever
   * called for singleEvents=true; a master is never returned in that mode.
   */
  expandedEvents(input: { timeMin?: number; timeMax?: number; showDeleted?: boolean }): GoogleCalendarEvent[] {
    const items: GoogleCalendarEvent[] = [];
    for (const event of this.events.values()) {
      if (event.recurrence) {
        items.push(...this.expandSeries(event, input));
        continue;
      }
      if (!withinWindow(event, input.timeMin, input.timeMax)) continue;
      items.push(event);
    }
    return items.sort(byStart);
  }

  /** Stored events as Google returns them for singleEvents=false. */
  storedEvents(input: { timeMin?: number; timeMax?: number }): GoogleCalendarEvent[] {
    return [...this.events.values()]
      .filter((event) => Boolean(event.recurrence) || withinWindow(event, input.timeMin, input.timeMax))
      .sort(byStart);
  }

  /** The instances of one series, as events.instances returns them. */
  expandSeries(
    master: GoogleCalendarEvent,
    input: { timeMin?: number; timeMax?: number; showDeleted?: boolean } = {}
  ): GoogleCalendarEvent[] {
    const lines = master.recurrence ?? [];
    const rruleLine = lines.find((line) => /^(RRULE:)?FREQ=/i.test(line.trim()));
    if (!rruleLine) return [];
    const allDay = Boolean(master.start.date);
    const zone = master.start.timeZone ?? this.calendars.get('primary')?.timeZone ?? 'UTC';
    const masterStart = instantOf(master.start, zone);
    const masterEnd = instantOf(master.end, zone);
    const duration = masterEnd - masterStart;
    const excluded = new Set(
      lines
        .filter((line) => /^EXDATE/i.test(line))
        .flatMap((line) => line.slice(line.indexOf(':') + 1).split(','))
        .map((value) => dayKey(parseCompact(value.trim())))
    );
    const cancelled = this.cancellations.get(master.id) ?? new Set<string>();
    const overrides = new Map(
      [...this.events.values()]
        .filter((event) => event.recurringEventId === master.id && event.originalStartTime)
        .map((event) => [slotOf(event.originalStartTime!), event] as const)
    );

    const local = zoneParts(new Date(masterStart), zone);
    const dtstart = new Date(Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second));
    const rule = rrulestr(rruleLine.replace(/^RRULE:/i, 'RRULE:').startsWith('RRULE:') ? rruleLine : `RRULE:${rruleLine}`, { dtstart });

    // Google answers an unbounded series with a capped instance count; a
    // window narrows it further.
    const slots = rule.all((_date, index) => index < this.expansionCap);
    const items: GoogleCalendarEvent[] = [];
    for (const floating of slots) {
      const slotInstant = allDay
        ? Date.UTC(floating.getUTCFullYear(), floating.getUTCMonth(), floating.getUTCDate())
        : instantFromZoneParts(
            {
              year: floating.getUTCFullYear(),
              month: floating.getUTCMonth() + 1,
              day: floating.getUTCDate(),
              hour: local.hour,
              minute: local.minute,
              second: local.second,
            },
            zone
          ).getTime();
      const slot = new Date(slotInstant).toISOString();
      if (excluded.has(dayKey(new Date(slotInstant)))) continue;

      const override = overrides.get(slot);
      if (override) {
        if (withinWindow(override, input.timeMin, input.timeMax)) items.push(override);
        continue;
      }

      const instanceId = `${master.id}_${allDay ? compactDay(slotInstant) : compactInstant(slotInstant)}`;
      const isCancelled = cancelled.has(slot);
      if (isCancelled && !input.showDeleted) continue;

      const instance: GoogleCalendarEvent = {
        ...master,
        id: instanceId,
        updated: this.slotUpdates.get(`${master.id}|${slot}`) ?? master.updated,
        status: isCancelled ? 'cancelled' : master.status,
        recurrence: undefined,
        recurringEventId: master.id,
        originalStartTime: allDay
          ? { date: dayKey(new Date(slotInstant)) }
          : { dateTime: slot, timeZone: zone },
        start: allDay
          ? { date: dayKey(new Date(slotInstant)) }
          : { dateTime: slot, timeZone: zone },
        end: allDay
          ? { date: dayKey(new Date(slotInstant + Math.max(duration, DAY_MS))) }
          : { dateTime: new Date(slotInstant + duration).toISOString(), timeZone: zone },
      };
      // A cancelled instance is a tombstone: only id/status/recurringEventId
      // and the original slot are meaningful.
      if (!withinWindow(instance, input.timeMin, input.timeMax)) continue;
      items.push(instance);
    }
    return items.sort(byStart);
  }

  private resolveInstanceId(eventId: string): GoogleCalendarEvent | null {
    for (const master of this.events.values()) {
      if (!master.recurrence || !eventId.startsWith(`${master.id}_`)) continue;
      const instance = this.expandSeries(master, { showDeleted: true }).find((candidate) => candidate.id === eventId);
      if (instance) return instance;
    }
    return null;
  }

  // ------------------------------------------------------------------ List

  listEvents(input: ListEventsInput): ListEventsResult {
    this.getCalendar(input.calendarId);
    const maxResults = input.maxResults && input.maxResults > 0 ? Math.min(input.maxResults, 2500) : 250;

    if (input.pageToken) {
      const page = this.pages.get(input.pageToken);
      if (!page) throw apiError(400, 'invalid', 'Invalid page token');
      return this.page(page);
    }

    const previous = input.syncToken ? this.syncTokens.get(input.syncToken) : undefined;
    if (input.syncToken && !previous) {
      throw apiError(410, 'fullSyncRequired', 'Sync token is no longer valid, a full sync is required.');
    }

    const timeMin = input.timeMin ? Date.parse(input.timeMin) : undefined;
    const timeMax = input.timeMax ? Date.parse(input.timeMax) : undefined;
    // An incremental round ignores the original window the way Google does:
    // the token carries it.
    const showDeleted = input.showDeleted ?? Boolean(input.syncToken);
    const all = input.singleEvents
      ? this.expandedEvents({ timeMin, timeMax, showDeleted })
      : this.storedEvents({ timeMin, timeMax });

    const fingerprints = new Map(all.map((event) => [event.id, JSON.stringify(event)] as const));
    let items = all;
    if (previous) {
      items = all.filter((event) => previous.get(event.id) !== fingerprints.get(event.id));
      for (const [id] of previous) {
        if (fingerprints.has(id)) continue;
        // Google reports a vanished event as a cancelled tombstone.
        items.push({ id, status: 'cancelled', start: {}, end: {}, created: '', updated: this.env.clock.now().toISOString() });
      }
    }

    const syncToken = this.newId('sync-');
    this.syncTokens.set(syncToken, fingerprints);
    return this.page({ items, offset: 0, maxResults, syncToken, fingerprints });
  }

  private page(state: ListPage): ListEventsResult {
    const items = state.items.slice(state.offset, state.offset + state.maxResults).map((event) => ({ ...event }));
    const offset = state.offset + state.maxResults;
    if (offset < state.items.length) {
      const pageToken = this.newId('page-');
      this.pages.set(pageToken, { ...state, offset });
      return { items, nextPageToken: pageToken };
    }
    return { items, nextSyncToken: state.syncToken };
  }

  /** Invalidate every issued sync token, as a long gap or a reset does. */
  expireSyncTokens(): number {
    const count = this.syncTokens.size;
    this.syncTokens.clear();
    this.pages.clear();
    return count;
  }

  // -------------------------------------------------------------- Channels

  watch(calendarId: string, body: Record<string, any>): { kind: string; id: string; resourceId: string; expiration: string } {
    this.getCalendar(calendarId);
    const id = String(body.id ?? this.newId('channel-'));
    const resourceId = this.newId('resource-');
    const ttl = Number(body.params?.ttl ?? 7 * 24 * 60 * 60);
    const expiration = this.env.clock.now().getTime() + ttl * 1000;
    this.channels.set(id, { id, resourceId, address: String(body.address ?? ''), token: body.token ? String(body.token) : undefined, expiration });
    return { kind: 'api#channel', id, resourceId, expiration: String(expiration) };
  }

  stopChannel(id: string, resourceId: string): void {
    const channel = this.channels.get(id);
    if (!channel || channel.resourceId !== resourceId) throw apiError(404, 'notFound', 'Channel not found');
    this.channels.delete(id);
  }
}

// --------------------------------------------------------------- helpers

function normalizeDate(value: unknown, field: string): GoogleEventDate {
  const date = value as GoogleEventDate | undefined;
  if (!date || (!date.dateTime && !date.date)) {
    throw apiError(400, 'required', `Missing ${field} time`);
  }
  if (date.dateTime && date.date) {
    throw apiError(400, 'invalid', `${field} must be a date or a dateTime, not both`);
  }
  return {
    ...(date.dateTime ? { dateTime: date.dateTime } : {}),
    ...(date.date ? { date: date.date } : {}),
    ...(date.timeZone ? { timeZone: date.timeZone } : {}),
  };
}

function instantOf(date: GoogleEventDate, zone: string): number {
  if (date.dateTime) {
    const explicit = /(?:Z|[+-]\d{2}:\d{2})$/i.test(date.dateTime);
    if (explicit) return Date.parse(date.dateTime);
    const [datePart, timePart = '00:00:00'] = date.dateTime.split('T');
    const [year, month, day] = datePart.split('-').map(Number);
    const [hour, minute, second] = timePart.split(':').map(Number);
    return instantFromZoneParts({ year, month, day, hour, minute, second: second || 0 }, zone).getTime();
  }
  return Date.parse(`${date.date}T00:00:00Z`);
}

function withinWindow(event: GoogleCalendarEvent, timeMin?: number, timeMax?: number): boolean {
  if (timeMin === undefined && timeMax === undefined) return true;
  const zone = event.start.timeZone ?? 'UTC';
  const start = event.start.dateTime || event.start.date ? instantOf(event.start, zone) : NaN;
  const end = event.end.dateTime || event.end.date ? instantOf(event.end, zone) : NaN;
  if (!Number.isFinite(start)) return true;
  if (timeMax !== undefined && start >= timeMax) return false;
  if (timeMin !== undefined && Number.isFinite(end) && end <= timeMin) return false;
  return true;
}

function byStart(left: GoogleCalendarEvent, right: GoogleCalendarEvent): number {
  const key = (event: GoogleCalendarEvent) => event.start.dateTime ?? event.start.date ?? '';
  return key(left).localeCompare(key(right));
}

function slotOf(date: GoogleEventDate): string {
  return new Date(instantOf(date, date.timeZone ?? 'UTC')).toISOString();
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function compactInstant(instant: number): string {
  return new Date(instant).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function compactDay(instant: number): string {
  return dayKey(new Date(instant)).replace(/-/g, '');
}

function parseCompact(value: string): Date {
  const basic = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(value);
  if (!basic) return new Date(value);
  return new Date(Date.UTC(
    Number(basic[1]), Number(basic[2]) - 1, Number(basic[3]),
    basic[4] ? Number(basic[4]) : 0, basic[5] ? Number(basic[5]) : 0, basic[6] ? Number(basic[6]) : 0,
  ));
}

interface ZoneParts { year: number; month: number; day: number; hour: number; minute: number; second: number }

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let found = formatters.get(timeZone);
  if (!found) {
    found = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    formatters.set(timeZone, found);
  }
  return found;
}

function zoneParts(date: Date, timeZone: string): ZoneParts {
  const parts = formatter(timeZone).formatToParts(date);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? '0');
  return {
    year: read('year'), month: read('month'), day: read('day'),
    hour: read('hour') % 24, minute: read('minute'), second: read('second'),
  };
}

/** The instant whose wall clock in `timeZone` is exactly these fields. */
function instantFromZoneParts(parts: ZoneParts, timeZone: string): Date {
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const offsetAt = (at: number) => {
    const local = zoneParts(new Date(at), timeZone);
    return Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second) - at;
  };
  let instant = asUtc - offsetAt(asUtc);
  instant = asUtc - offsetAt(instant);
  return new Date(instant);
}
