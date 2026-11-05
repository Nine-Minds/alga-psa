import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmulatorHost } from '@alga-psa/emulator-host';
import googleCalendar from '@alga-psa/emulator-google-calendar';
import type { CalendarProviderConfig, ExternalCalendarEvent } from '@alga-psa/types';

/**
 * The production defect, end to end over HTTP: a monthly "@alga" series with no
 * end date, which Google answers as 730 expanded instances (one per occurrence
 * out to 2087, alternating 14:15Z and 15:15Z across DST). Every layer below the
 * database is real here — the Google Calendar emulator, the EE adapter and the
 * EE sync service — so this covers the wire shape the mocked unit tests cannot:
 * `singleEvents` expansion, sync tokens, 410 fullSyncRequired, and cancelled
 * instance tombstones.
 *
 * The schedule-entry store and the provider row are fixtures (the DB-backed
 * suites cover those); the assertions are about how many entries and mappings
 * one series produces.
 *
 * The matching Activities-feed assertion — that the imported master surfaces
 * only for its in-window occurrences rather than 730 times — needs the real
 * schema, since @alga-psa/db is mocked wholesale here. It lives in
 * src/test/integration/api/userActivities.test.ts ("lists an imported recurring
 * series only for its in-window occurrences").
 */

const db = vi.hoisted(() => ({
  tables: {} as Record<string, any[]>,
  entries: new Map<string, any>(),
  sequence: 0,
}));

const providerState = vi.hoisted(() => ({ provider: null as any }));

function fakeQuery(rows: () => any[], replace: (next: any[]) => void) {
  const predicates: Array<(row: any) => boolean> = [];

  const likeToRegExp = (pattern: string): RegExp => {
    let source = '';
    for (let index = 0; index < pattern.length; index += 1) {
      const character = pattern[index];
      if (character === '\\') {
        index += 1;
        source += pattern[index]?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') ?? '';
      } else if (character === '%') {
        source += '.*';
      } else if (character === '_') {
        source += '.';
      } else {
        source += character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }
    }
    return new RegExp(`^${source}$`);
  };

  const addCondition = (column: any, operatorOrValue?: any, maybeValue?: any) => {
    if (typeof column === 'object' && column !== null) {
      const criteria = column as Record<string, any>;
      predicates.push((row) => Object.entries(criteria).every(([key, value]) => row[key] === value));
      return;
    }
    if (maybeValue !== undefined && String(operatorOrValue).toLowerCase() === 'like') {
      const matcher = likeToRegExp(String(maybeValue));
      predicates.push((row) => matcher.test(String(row[column])));
      return;
    }
    const value = maybeValue !== undefined ? maybeValue : operatorOrValue;
    predicates.push((row) => row[column] === value);
  };

  const matches = () => rows().filter((row) => predicates.every((predicate) => predicate(row)));

  const builder: any = {
    where: (...args: any[]) => { addCondition(...(args as [any, any?, any?])); return builder; },
    andWhere: (...args: any[]) => { addCondition(...(args as [any, any?, any?])); return builder; },
    whereIn: (column: string, values: any[]) => {
      predicates.push((row) => values.includes(row[column]));
      return builder;
    },
    whereNotNull: (column: string) => {
      predicates.push((row) => row[column] !== null && row[column] !== undefined);
      return builder;
    },
    first: async () => {
      const [row] = matches();
      return row ? { ...row } : undefined;
    },
    select: async (..._columns: any[]) => matches().map((row) => ({ ...row })),
    insert: (row: any) => {
      const apply = () => {
        const inserted = (Array.isArray(row) ? row : [row]).map((value) => ({ ...value }));
        replace([...rows(), ...inserted]);
        return inserted;
      };
      return {
        returning: async () => apply(),
        then: (resolve: (value: any) => any, reject: (error: any) => any) =>
          Promise.resolve().then(apply).then(resolve, reject),
      };
    },
    update: async (changes: Record<string, any>) => {
      const targets = matches();
      replace(rows().map((row) => (targets.includes(row) ? { ...row, ...changes } : row)));
      return targets.length;
    },
    del: async () => {
      const targets = matches();
      replace(rows().filter((row) => !targets.includes(row)));
      return targets.length;
    },
  };
  return builder;
}

function table(name: string) {
  db.tables[name] = db.tables[name] ?? [];
  return fakeQuery(() => db.tables[name], (next) => { db.tables[name] = next; });
}

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: (name: string) => table(name), tenant: 'tenant-1' }),
  runWithTenant: async (_tenant: string, callback: () => Promise<any>) => callback(),
  withTransaction: async (knex: any, callback: (trx: any) => Promise<any>) => callback(knex),
  tenantDb: (_conn: any, _tenant: string) => ({ table }),
  isTenantSuspended: async () => false,
  getAdminConnection: async () => ({}),
}));
vi.mock('@alga-psa/db/admin', () => ({ getAdminConnection: async () => ({}) }));
vi.mock('@alga-psa/auth', () => ({ hasPermission: async () => true }));
vi.mock('@alga-psa/scheduling/lib/calendarAccess', () => ({
  resolveCalendarAccess: async () => ({ viewerUserId: 'user-1' }),
  evaluateEntryAccess: () => ({ access: 'full', canEdit: true }),
}));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishWorkflowEvent: async () => undefined }));
vi.mock('@alga-psa/workflow-streams', () => ({ buildScheduleEntryUpdatedPayload: (input: any) => input }));
vi.mock('@alga-psa/ee-calendar/lib/eventBus/publishers', () => ({ publishEvent: async () => undefined }));
vi.mock('@alga-psa/ee-calendar/lib/services/calendar/CalendarProviderService', () => ({
  CalendarProviderService: class {
    async getProvider() { return providerState.provider; }
    async updateProvider(_id: string, _tenant: string, data: { vendorConfig?: Record<string, any> }) {
      if (data.vendorConfig) {
        providerState.provider.provider_config = {
          ...providerState.provider.provider_config,
          ...data.vendorConfig,
        };
      }
    }
    async updateProviderStatus() { return undefined; }
  },
}));

vi.mock('@alga-psa/shared/models/scheduleEntry', () => {
  const parseRecurrencePattern = (pattern: any) =>
    typeof pattern === 'string' ? JSON.parse(pattern) : pattern ?? null;

  const model = {
    parseRecurrencePattern,
    get: async (_knex: any, _tenant: string, entryId: string) => {
      const entry = db.entries.get(entryId);
      return entry ? structuredClone(entry) : undefined;
    },
    create: async (_knex: any, tenant: string, data: any, options: any) => {
      db.sequence += 1;
      const entry = {
        ...data,
        entry_id: data.entry_id ?? `entry-${db.sequence}`,
        tenant,
        assigned_user_ids: options?.assignedUserIds ?? [],
        updated_at: new Date(),
      };
      db.entries.set(entry.entry_id, entry);
      return structuredClone(entry);
    },
    update: async (_knex: any, _tenant: string, entryId: string, changes: any, updateType?: string) => {
      const [masterId, timestamp] = entryId.includes('_') ? entryId.split('_') : [entryId, null];
      const master = db.entries.get(masterId);
      if (!master) return undefined;
      if (updateType === 'single' && master.recurrence_pattern) {
        const pattern = parseRecurrencePattern(master.recurrence_pattern);
        const exceptionDate = new Date(timestamp ? Number(timestamp) : changes.scheduled_start);
        exceptionDate.setUTCHours(0, 0, 0, 0);
        master.recurrence_pattern = { ...pattern, exceptions: [...(pattern.exceptions ?? []), exceptionDate] };
        db.sequence += 1;
        const override = {
          ...master, ...changes, entry_id: `entry-${db.sequence}`,
          is_recurring: false, recurrence_pattern: null, updated_at: new Date(),
        };
        db.entries.set(override.entry_id, override);
        return structuredClone(override);
      }
      const updated = { ...master, ...changes, entry_id: masterId, updated_at: new Date() };
      db.entries.set(masterId, updated);
      return structuredClone(updated);
    },
    delete: async (_knex: any, _tenant: string, entryId: string) => db.entries.delete(entryId),
  };

  return { default: model, ScheduleEntry: model };
});

let host: EmulatorHost;
let base: string;
let control: string;

const MASTER_TITLE = 'Go over advisories in Git @alga';

beforeAll(async () => {
  host = new EmulatorHost({ emulators: [googleCalendar], controlPort: 0, ports: { 'google-calendar': 0 } });
  const started = await host.start();
  base = `http://127.0.0.1:${started.ports['google-calendar']}`;
  control = `http://127.0.0.1:${started.controlPort}`;
  vi.stubEnv('GOOGLE_CALENDAR_API_ROOT_URL', `${base}/`);
  vi.stubEnv('GOOGLE_OAUTH_TOKEN_URL', `${base}/token`);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await host?.stop();
});

async function controlPost(path: string, body = {}) {
  const response = await fetch(`${control}/control/google-calendar/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  expect(response.ok).toBe(true);
  const result = await response.json();
  expect(result.ok).toBe(true);
  return result.result;
}

function api(path: string, method = 'GET', body?: unknown) {
  return fetch(`${base}/calendar/v3${path}`, {
    method,
    headers: { authorization: 'Bearer emulated-access-token', 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeEach(async () => {
  await controlPost('reset');
  db.tables = {
    calendar_event_mappings: [],
    calendar_provider_health: [],
    calendars: [],
    users: [{ tenant: 'tenant-1', user_id: 'user-1', user_type: 'internal', email: 'tech@example.com' }],
  };
  db.entries = new Map();
  db.sequence = 0;
  providerState.provider = {
    id: 'provider-1',
    tenant: 'tenant-1',
    user_id: 'user-1',
    name: 'Google',
    provider_type: 'google',
    calendar_id: 'primary',
    active: true,
    sync_direction: 'bidirectional',
    connection_status: 'connected',
    last_sync_at: null,
    provider_config: {
      clientId: 'emulated-client', clientSecret: 'emulated-secret',
      accessToken: 'emulated-access-token', refreshToken: 'emulated-refresh-token',
      tokenExpiresAt: new Date(Date.now() + 3600000).toISOString(),
    },
  };
});

afterEach(() => { vi.restoreAllMocks(); });

/** A webhook round: the processor's own pipeline against the live emulator. */
async function webhookRound() {
  const module = await import('@alga-psa/ee-calendar/lib/services/calendar/CalendarWebhookProcessor');
  const processor = new module.CalendarWebhookProcessor();
  vi.spyOn(processor as any, 'getProviderByGoogleSubscription').mockResolvedValue(providerState.provider);
  return processor.processGoogleWebhook({ data: 'ignored' }, 'subscription-1');
}

function mappings() {
  return db.tables['calendar_event_mappings'] ?? [];
}

function masterEntry() {
  return [...db.entries.values()].find((entry) => entry.is_recurring);
}

async function seedUnboundedSeries(cap?: number) {
  // The default cap is Google's observed answer for an unbounded series (730);
  // the later cases only need a handful of instances to prove their point.
  if (cap) await controlPost('seed/expansion-cap', { cap });
  return controlPost('seed/event', {
    event: {
      summary: MASTER_TITLE,
      // 10:15 local, first Thursday of every month, no end date — the series
      // production imported 730 times.
      start: { dateTime: '2026-10-01T10:15:00', timeZone: 'America/New_York' },
      end: { dateTime: '2026-10-01T10:45:00', timeZone: 'America/New_York' },
      recurrence: ['RRULE:FREQ=MONTHLY;BYDAY=1TH'],
    },
  });
}

describe('Google Calendar emulator: recurring series import', () => {
  it('imports an unbounded 730-instance series as exactly one recurring entry', async () => {
    // First round establishes the sync token; the series then arrives in one
    // incremental batch, the way the production webhook delivered it.
    expect(await webhookRound()).toEqual({ success: 0, failed: 0 });
    const master = await seedUnboundedSeries();

    const instances = (await (await api('/calendars/primary/events?singleEvents=true&maxResults=2500')).json()).items;
    expect(instances).toHaveLength(730);
    expect(instances.every((item: any) => item.recurringEventId === master.id)).toBe(true);
    // The DST fixture: the same local 10:15 is 14:15Z in summer, 15:15Z in winter.
    expect(instances[0].start.dateTime).toBe('2026-10-01T14:15:00.000Z');
    expect(instances[1].start.dateTime).toBe('2026-11-05T15:15:00.000Z');

    const outcome = await webhookRound();
    expect(outcome.failed).toBe(0);
    expect(outcome.success).toBe(730);

    expect(db.entries.size).toBe(1);
    expect(mappings()).toHaveLength(1);
    expect(mappings()[0].external_event_id).toBe(master.id);
    expect(mappings()[0].sync_direction).toBe('from_external');
    expect(masterEntry()).toMatchObject({
      title: MASTER_TITLE,
      is_recurring: true,
      assigned_user_ids: ['user-1'],
    });
    expect(masterEntry().recurrence_pattern).toMatchObject({
      frequency: 'monthly',
      daysOfWeek: [3],
      weekOfMonth: 1,
      timeZone: 'America/New_York',
    });
  });

  it('records a cancelled instance as an exception and keeps the series', async () => {
    await webhookRound();
    const master = await seedUnboundedSeries(6);
    await webhookRound();
    expect(db.entries.size).toBe(1);

    // "Delete this occurrence" in Google: the instance lists as a cancelled
    // tombstone that still names its series.
    const instances = (await (await api('/calendars/primary/events?singleEvents=true')).json()).items;
    expect((await api(`/calendars/primary/events/${instances[1].id}`, 'DELETE')).status).toBe(204);

    const outcome = await webhookRound();
    expect(outcome.failed).toBe(0);
    expect(db.entries.size).toBe(1);
    expect(masterEntry().is_recurring).toBe(true);
    expect(masterEntry().recurrence_pattern.exceptions.map((date: Date) => new Date(date).toISOString()))
      .toEqual(['2026-11-05T00:00:00.000Z']);
    expect(mappings()).toHaveLength(1);
    expect((await api(`/calendars/primary/events/${master.id}`)).status).toBe(200);
  });

  it('removes the series when the master is deleted on the provider side', async () => {
    await webhookRound();
    const master = await seedUnboundedSeries(6);
    await webhookRound();
    expect(db.entries.size).toBe(1);

    expect((await api(`/calendars/primary/events/${master.id}`, 'DELETE')).status).toBe(204);

    const outcome = await webhookRound();
    expect(outcome.failed).toBe(0);
    expect(db.entries.size).toBe(0);
    expect(mappings()).toHaveLength(0);
  });

  it('creates no duplicates when an expired sync token forces a full re-list', async () => {
    await webhookRound();
    await seedUnboundedSeries(6);
    await webhookRound();
    const entriesAfterImport = db.entries.size;
    const mappingsAfterImport = mappings().length;

    // 410 fullSyncRequired: the processor drops the token and re-lists.
    expect(await controlPost('actions/expire-sync-tokens')).toMatchObject({ expired: expect.any(Number) });
    const outcome = await webhookRound();

    expect(outcome.failed).toBe(0);
    expect(db.entries.size).toBe(entriesAfterImport);
    expect(mappings()).toHaveLength(mappingsAfterImport);
    expect(providerState.provider.provider_config.syncToken).toBeTruthy();
  });

  it('still round-trips a single event through the adapter', async () => {
    const { GoogleCalendarAdapter } = await import('@alga-psa/ee-calendar/lib/services/calendar/providers/GoogleCalendarAdapter');
    const adapter = new GoogleCalendarAdapter(providerState.provider as CalendarProviderConfig);
    const input: ExternalCalendarEvent = {
      id: '', provider: 'google', title: 'Scoped fixture event', description: 'Created by the adapter',
      start: { dateTime: '2026-09-29T10:00:00Z', timeZone: 'UTC' },
      end: { dateTime: '2026-09-29T11:00:00Z', timeZone: 'UTC' },
    };

    const created = await adapter.createEvent(input);
    expect(created.id).toBeTruthy();
    expect(await adapter.getEvent(created.id)).toMatchObject({ title: input.title, instanceType: 'single' });
    const updated = await adapter.updateEvent(created.id, { title: 'Updated fixture event' });
    expect(updated).toMatchObject({ title: 'Updated fixture event', id: created.id });
    await adapter.deleteEvent(created.id);
    await expect(adapter.getEvent(created.id)).rejects.toMatchObject({ status: 404 });
  });
});
