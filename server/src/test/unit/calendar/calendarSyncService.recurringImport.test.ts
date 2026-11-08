import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression tests for the recurring-import defect: a Google series marked
 * "@alga" arrived as 730 expanded instances and was imported as 730 standalone
 * schedule entries. One series must become exactly one recurring entry, with a
 * single master mapping, one master read per batch, and instance-level changes
 * (moves, cancellations, deletes) applied to that master.
 */

const db = vi.hoisted(() => ({
  tables: {} as Record<string, any[]>,
  entries: new Map<string, any>(),
  sequence: 0,
}));

const adapterState = vi.hoisted(() => ({
  events: new Map<string, any>(),
  getEventCalls: [] as string[],
  deleteEventCalls: [] as string[],
}));

const providerState = vi.hoisted(() => ({
  provider: null as any,
  statusUpdates: [] as Array<{ providerId: string; status: any }>,
}));

/** Minimal knex-shaped query builder over an in-memory array. */
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
    insert: (row: any) => ({
      returning: async () => {
        const inserted = { ...row };
        replace([...rows(), inserted]);
        return [{ ...inserted }];
      },
    }),
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
}));

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
    async getProvider() {
      return providerState.provider;
    }
    async updateProviderStatus(providerId: string, status: any) {
      providerState.statusUpdates.push({ providerId, status });
    }
  },
}));

const fakeAdapter = {
  connect: async () => undefined,
  getEvent: async (id: string) => {
    adapterState.getEventCalls.push(id);
    const event = adapterState.events.get(id);
    if (!event) {
      const error: any = new Error('Event not found');
      error.status = 404;
      error.code = 404;
      throw error;
    }
    return structuredClone(event);
  },
  deleteEvent: async (id: string) => { adapterState.deleteEventCalls.push(id); },
  updateEvent: async (_id: string, event: any) => event,
  createEvent: async (event: any) => ({ ...event, id: 'created' }),
};

vi.mock('@alga-psa/ee-calendar/lib/services/calendar/providers/GoogleCalendarAdapter', () => ({
  GoogleCalendarAdapter: class { constructor() { return fakeAdapter as any; } },
}));
vi.mock('@alga-psa/ee-calendar/lib/services/calendar/providers/MicrosoftCalendarAdapter', () => ({
  MicrosoftCalendarAdapter: class { constructor() { return fakeAdapter as any; } },
}));

/**
 * In-memory stand-in for the schedule-entry model, reproducing the pieces the
 * sync service relies on: the simple field update, and the SINGLE scope that
 * excepts one occurrence out of a master and writes a standalone override.
 */
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
        updated_at: new Date('2026-09-24T18:47:00.000Z'),
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
        master.recurrence_pattern = {
          ...pattern,
          exceptions: [...(pattern.exceptions ?? []), exceptionDate],
        };

        db.sequence += 1;
        const override = {
          ...master,
          ...changes,
          entry_id: `entry-${db.sequence}`,
          is_recurring: false,
          original_entry_id: null,
          recurrence_pattern: null,
          updated_at: new Date(),
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

const MASTER_ID = '2ppb6f3ftc40nggeoqtsoh743g';
const MASTER_TITLE = 'Go over advisories in Git @alga';
const GROUP_CALENDAR_NAME = 'On-call';
const GROUP_CALENDAR_MARKER = `[Alga calendar: ${GROUP_CALENDAR_NAME}]`;

function compactUtc(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function googleMaster(overrides: Record<string, any> = {}) {
  return {
    id: MASTER_ID,
    provider: 'google',
    title: MASTER_TITLE,
    description: '',
    start: { dateTime: '2026-10-01T10:15:00-04:00', timeZone: 'America/New_York' },
    end: { dateTime: '2026-10-01T10:45:00-04:00', timeZone: 'America/New_York' },
    recurrence: ['RRULE:FREQ=MONTHLY;BYDAY=1TH'],
    instanceType: 'master',
    status: 'confirmed',
    updated: '2026-09-24T18:47:00.000Z',
    ...overrides,
  };
}

function googleOccurrence(startIso: string, overrides: Record<string, any> = {}) {
  const masterId = (overrides.recurringEventId as string) ?? MASTER_ID;
  return {
    id: `${masterId}_${compactUtc(startIso)}`,
    provider: 'google',
    title: MASTER_TITLE,
    description: '',
    start: { dateTime: startIso, timeZone: 'America/New_York' },
    end: { dateTime: new Date(new Date(startIso).getTime() + 30 * 60 * 1000).toISOString(), timeZone: 'America/New_York' },
    originalStartTime: { dateTime: startIso, timeZone: 'America/New_York' },
    recurringEventId: masterId,
    instanceType: 'occurrence',
    status: 'confirmed',
    updated: '2026-09-24T18:47:00.000Z',
    ...overrides,
  };
}

/**
 * The production shape: an unbounded monthly series expanded to 730 instances
 * out to 2087, alternating 14:15Z (EDT) and 15:15Z (EST).
 */
function productionInstances(count = 730): any[] {
  const instances: any[] = [];
  let year = 2026;
  let month = 9; // October (0-based)
  for (let index = 0; index < count; index += 1) {
    const firstOfMonth = new Date(Date.UTC(year, month, 1));
    const offsetToThursday = (4 - firstOfMonth.getUTCDay() + 7) % 7;
    const day = 1 + offsetToThursday;
    const isEdt = month >= 2 && month <= 10;
    const startIso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T${isEdt ? '14' : '15'}:15:00.000Z`;
    instances.push(googleOccurrence(startIso));
    month += 1;
    if (month > 11) { month = 0; year += 1; }
  }
  return instances;
}

const MS_MASTER_ID = 'AAMkAGI2TG93AAA=';

function microsoftMaster(overrides: Record<string, any> = {}) {
  return {
    id: MS_MASTER_ID,
    provider: 'microsoft',
    title: MASTER_TITLE,
    description: '',
    start: { dateTime: '2026-10-01T14:15:00.000Z', timeZone: 'UTC' },
    end: { dateTime: '2026-10-01T14:45:00.000Z', timeZone: 'UTC' },
    recurrence: ['RRULE:FREQ=MONTHLY;BYDAY=1TH'],
    instanceType: 'master',
    status: 'confirmed',
    updated: '2026-09-24T18:47:00.000Z',
    ...overrides,
  };
}

/**
 * Graph occurrence ids are opaque: nothing in them names the master or the slot,
 * which is why a cancelled Microsoft occurrence can only be resolved from the
 * index recorded while it was still visible.
 */
function microsoftOccurrence(startIso: string, overrides: Record<string, any> = {}) {
  return {
    id: `AAMkAGI2TG93occurrence${compactUtc(startIso)}=`,
    provider: 'microsoft',
    title: MASTER_TITLE,
    description: '',
    start: { dateTime: startIso, timeZone: 'UTC' },
    end: { dateTime: new Date(new Date(startIso).getTime() + 30 * 60 * 1000).toISOString(), timeZone: 'UTC' },
    originalStartTime: { dateTime: startIso },
    recurringEventId: MS_MASTER_ID,
    instanceType: 'occurrence',
    status: 'confirmed',
    updated: '2026-09-24T18:47:00.000Z',
    ...overrides,
  };
}

function registerEvents(events: any[]) {
  for (const event of events) adapterState.events.set(event.id, event);
}

function mappings() {
  return db.tables['calendar_event_mappings'] ?? [];
}

function masterEntry() {
  return [...db.entries.values()].find((entry) => entry.is_recurring);
}

async function newSyncService() {
  const module = await import('@alga-psa/ee-calendar/lib/services/calendar/CalendarSyncService');
  return new module.CalendarSyncService();
}

describe('CalendarSyncService recurring import', () => {
  beforeEach(() => {
    db.tables = {
      calendar_event_mappings: [],
      calendars: [],
      users: [{ tenant: 'tenant-1', user_id: 'user-1', user_type: 'internal', email: 'tech@example.com' }],
    };
    db.entries = new Map();
    db.sequence = 0;
    adapterState.events = new Map();
    adapterState.getEventCalls = [];
    adapterState.deleteEventCalls = [];
    providerState.statusUpdates = [];
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
      provider_config: { accessToken: 'access', refreshToken: 'refresh' },
    };
  });

  it('imports a 730-instance batch as one recurring entry with one master read', async () => {
    const instances = productionInstances();
    registerEvents([googleMaster(), ...instances]);
    const service = await newSyncService();

    for (const instance of instances) {
      const result = await service.syncExternalEventToSchedule(instance.id, 'provider-1');
      expect(result.success).toBe(true);
    }

    expect(db.entries.size).toBe(1);
    expect(mappings()).toHaveLength(1);
    expect(mappings()[0].external_event_id).toBe(MASTER_ID);
    expect(mappings()[0].sync_direction).toBe('from_external');
    expect(adapterState.getEventCalls.filter((id) => id === MASTER_ID)).toHaveLength(1);

    const master = masterEntry();
    expect(master.is_recurring).toBe(true);
    expect(master.recurrence_pattern).toMatchObject({
      frequency: 'monthly',
      daysOfWeek: [3],
      weekOfMonth: 1,
      timeZone: 'America/New_York',
    });
    expect(master.assigned_user_ids).toEqual(['user-1']);
  });

  it('creates nothing extra when the same batch is replayed after a sync-token reset', async () => {
    const instances = productionInstances(24);
    registerEvents([googleMaster(), ...instances]);
    const service = await newSyncService();

    for (const instance of instances) {
      await service.syncExternalEventToSchedule(instance.id, 'provider-1');
    }
    const entriesAfterFirstPass = db.entries.size;
    const mappingsAfterFirstPass = mappings().length;

    // A 410 GONE resets the sync token and the next list replays the window.
    for (const instance of instances) {
      await service.syncExternalEventToSchedule(instance.id, 'provider-1');
    }

    expect(db.entries.size).toBe(entriesAfterFirstPass);
    expect(mappings()).toHaveLength(mappingsAfterFirstPass);
    expect(db.entries.size).toBe(1);
  });

  it('leaves a group-calendar series whole, marker line and all', async () => {
    // Outbound, a series on a group calendar gets an `[Alga calendar: <name>]`
    // line appended to its description; inbound that line is stripped again, so
    // schedule_entries.notes never holds it. Every expanded occurrence inherits
    // the decorated description, so comparing it against the stored notes calls
    // each plain occurrence an exception — the per-occurrence materialisation
    // this suite exists to prevent, back again for group calendars.
    const decorated = {
      description: `Daily sync\n${GROUP_CALENDAR_MARKER}`,
      extendedProperties: {
        private: {
          'alga-calendar-marker-name': GROUP_CALENDAR_NAME,
          'alga-calendar-marker-note-count': '0',
          'alga-calendar-marker-notes-format': 'text',
        },
      },
    };
    const instances = productionInstances(6).map((instance) => ({ ...instance, ...decorated }));
    registerEvents([googleMaster(decorated), ...instances]);
    const service = await newSyncService();

    for (const instance of instances) {
      expect((await service.syncExternalEventToSchedule(instance.id, 'provider-1')).success).toBe(true);
    }

    expect(db.entries.size).toBe(1);
    expect(mappings()).toHaveLength(1);
    const master = masterEntry();
    expect(master.notes).toBe('Daily sync');
    expect(master.recurrence_pattern.exceptions ?? []).toHaveLength(0);
  });

  it('turns a moved occurrence into an exception date plus a standalone override', async () => {
    const instances = productionInstances(3);
    const moved = googleOccurrence('2026-12-03T15:15:00.000Z', {
      title: 'Advisories (moved) @alga',
      start: { dateTime: '2026-12-04T15:15:00.000Z', timeZone: 'America/New_York' },
      end: { dateTime: '2026-12-04T15:45:00.000Z', timeZone: 'America/New_York' },
      instanceType: 'exception',
    });
    registerEvents([googleMaster(), ...instances, moved]);
    const service = await newSyncService();

    await service.syncExternalEventToSchedule(instances[0].id, 'provider-1');
    const result = await service.syncExternalEventToSchedule(moved.id, 'provider-1');

    expect(result.success).toBe(true);
    expect(db.entries.size).toBe(2);
    const master = masterEntry();
    expect(master.recurrence_pattern.exceptions.map((date: Date) => new Date(date).toISOString())).toEqual([
      '2026-12-03T00:00:00.000Z',
    ]);
    const override = [...db.entries.values()].find((entry) => !entry.is_recurring);
    expect(override.title).toBe('Advisories (moved) @alga');
    expect(override.recurrence_pattern).toBeNull();
    const overrideMapping = mappings().find((row) => row.external_event_id === moved.id);
    expect(overrideMapping.schedule_entry_id).toBe(override.entry_id);
  });

  it('turns an occurrence whose end moved into an override, keeping its slot', async () => {
    // Google does not flag exceptions, and lengthening just one occurrence
    // leaves its start — and therefore originalStartTime — untouched, so only
    // its duration tells it apart from the master.
    const instances = productionInstances(3);
    const lengthened = {
      ...instances[1],
      end: { dateTime: '2026-11-05T16:15:00.000Z', timeZone: 'America/New_York' },
    };
    registerEvents([googleMaster(), ...instances]);
    adapterState.events.set(lengthened.id, lengthened);
    const service = await newSyncService();

    await service.syncExternalEventToSchedule(instances[0].id, 'provider-1');
    const result = await service.syncExternalEventToSchedule(lengthened.id, 'provider-1');

    expect(result.success).toBe(true);
    expect(db.entries.size).toBe(2);
    expect(masterEntry().recurrence_pattern.exceptions.map((date: Date) => new Date(date).toISOString()))
      .toEqual(['2026-11-05T00:00:00.000Z']);
    const override = [...db.entries.values()].find((entry) => !entry.is_recurring);
    expect(new Date(override.scheduled_end).toISOString()).toBe('2026-11-05T16:15:00.000Z');
    expect(mappings().find((row) => row.external_event_id === lengthened.id).schedule_entry_id)
      .toBe(override.entry_id);
  });

  it('records a cancelled occurrence as an exception and keeps the master', async () => {
    const instances = productionInstances(3);
    const cancelled = { ...instances[1], status: 'cancelled' };
    registerEvents([googleMaster(), ...instances]);
    adapterState.events.set(cancelled.id, cancelled);
    const service = await newSyncService();

    await service.syncExternalEventToSchedule(instances[0].id, 'provider-1');
    const result = await service.syncExternalEventToSchedule(cancelled.id, 'provider-1');

    expect(result.success).toBe(true);
    expect(db.entries.size).toBe(1);
    expect(masterEntry().is_recurring).toBe(true);
    expect(masterEntry().recurrence_pattern.exceptions).toHaveLength(1);
    expect(mappings()).toHaveLength(1);
    expect(adapterState.deleteEventCalls).toEqual([]);
  });

  it('records a deleted occurrence as an exception without touching the master row', async () => {
    const instances = productionInstances(3);
    registerEvents([googleMaster(), ...instances]);
    const service = await newSyncService();
    await service.syncExternalEventToSchedule(instances[0].id, 'provider-1');

    const result = await service.handleInboundExternalDelete(instances[2].id, 'provider-1', {
      recurringEventId: MASTER_ID,
      originalStart: instances[2].start.dateTime,
    });

    expect(result.success).toBe(true);
    expect(db.entries.size).toBe(1);
    expect(masterEntry().recurrence_pattern.exceptions).toHaveLength(1);
    expect(adapterState.deleteEventCalls).toEqual([]);
  });

  it('asks Google for an unhinted deleted occurrence, which still names its series', async () => {
    const instances = productionInstances(3);
    registerEvents([googleMaster(), ...instances]);
    const service = await newSyncService();
    await service.syncExternalEventToSchedule(instances[0].id, 'provider-1');
    adapterState.getEventCalls = [];
    // Google answers events.get for a cancelled instance with status
    // 'cancelled', recurringEventId and originalStartTime.
    adapterState.events.set(instances[1].id, { ...instances[1], status: 'cancelled' });

    const result = await service.handleInboundExternalDelete(instances[1].id, 'provider-1');

    expect(result.success).toBe(true);
    expect(adapterState.getEventCalls).toContain(instances[1].id);
    expect(masterEntry().recurrence_pattern.exceptions).toHaveLength(1);
  });

  it('skips an unmapped Google delete the provider no longer serves, adding no exception', async () => {
    const instances = productionInstances(3);
    registerEvents([googleMaster(), ...instances]);
    const service = await newSyncService();
    await service.syncExternalEventToSchedule(instances[0].id, 'provider-1');
    // Hard delete: events.get 404s, so nothing proves which series the id was
    // part of. Guessing from the `_<timestamp>` suffix would except out an
    // occurrence of whatever series happens to share the id prefix.
    adapterState.events.delete(instances[1].id);

    const result = await service.handleInboundExternalDelete(instances[1].id, 'provider-1');

    expect(result).toMatchObject({ success: true, skipped: true });
    expect(masterEntry().recurrence_pattern.exceptions ?? []).toHaveLength(0);
    expect(db.entries.size).toBe(1);
    expect(mappings()).toHaveLength(1);
  });

  it('deletes the series when a removed Google master only shows up as instance tombstones', async () => {
    const instances = productionInstances(3);
    registerEvents([googleMaster(), ...instances]);
    const service = await newSyncService();
    await service.syncExternalEventToSchedule(instances[0].id, 'provider-1');

    // The user deleted the whole series. An expanded (singleEvents) list never
    // carries the master, so the next sync reports one cancelled tombstone per
    // instance and nothing at all under the master's own id.
    adapterState.events.clear();
    const laterRun = await newSyncService();
    const result = await laterRun.handleInboundExternalDelete(instances[1].id, 'provider-1');

    expect(result.success).toBe(true);
    expect(db.entries.size).toBe(0);
    expect(mappings()).toHaveLength(0);
    expect(adapterState.deleteEventCalls).toEqual([]);
  });

  it('indexes Microsoft occurrences so an @removed id becomes a master exception', async () => {
    providerState.provider.provider_type = 'microsoft';
    const occurrences = [
      microsoftOccurrence('2026-10-01T14:15:00.000Z'),
      microsoftOccurrence('2026-11-05T15:15:00.000Z'),
    ];
    registerEvents([microsoftMaster(), ...occurrences]);
    const service = await newSyncService();

    for (const occurrence of occurrences) {
      expect((await service.syncExternalEventToSchedule(occurrence.id, 'provider-1')).success).toBe(true);
    }

    expect(db.entries.size).toBe(1);
    expect(mappings()).toHaveLength(1);
    expect(Object.keys(mappings()[0].occurrence_index).sort())
      .toEqual(occurrences.map((occurrence) => occurrence.id).sort());

    // Graph's @removed item carries only the opaque id, and a GET on it 404s.
    adapterState.events.delete(occurrences[1].id);
    adapterState.getEventCalls = [];
    const result = await service.handleInboundExternalDelete(occurrences[1].id, 'provider-1');

    expect(result.success).toBe(true);
    expect(adapterState.getEventCalls).toEqual([]);
    expect(db.entries.size).toBe(1);
    expect(masterEntry().is_recurring).toBe(true);
    expect(masterEntry().recurrence_pattern.exceptions.map((date: Date) => new Date(date).toISOString()))
      .toEqual(['2026-11-05T00:00:00.000Z']);
    expect(adapterState.deleteEventCalls).toEqual([]);
  });

  it('deletes the master and its overrides on a master delete, never calling the provider', async () => {
    const instances = productionInstances(3);
    const moved = googleOccurrence('2026-12-03T15:15:00.000Z', {
      title: 'Advisories (moved) @alga',
      start: { dateTime: '2026-12-04T15:15:00.000Z', timeZone: 'America/New_York' },
      instanceType: 'exception',
    });
    registerEvents([googleMaster(), ...instances, moved]);
    const service = await newSyncService();
    await service.syncExternalEventToSchedule(instances[0].id, 'provider-1');
    await service.syncExternalEventToSchedule(moved.id, 'provider-1');
    expect(db.entries.size).toBe(2);

    const result = await service.handleInboundExternalDelete(MASTER_ID, 'provider-1');

    expect(result.success).toBe(true);
    expect(db.entries.size).toBe(0);
    expect(mappings()).toHaveLength(0);
    expect(adapterState.deleteEventCalls).toEqual([]);
  });

  it('re-reads the master when a series-level edit arrives only as instance changes', async () => {
    // Neither a Google singleEvents list nor Graph's calendarView/delta ever
    // returns the master, so re-ruling a whole series shows up purely as
    // instance changes. Without the re-read the master kept its old pattern
    // while the old slots' tombstones were recorded as exceptions on it —
    // excepting the series away one occurrence at a time.
    const original = productionInstances(2);
    registerEvents([googleMaster(), ...original]);
    const service = await newSyncService();
    await service.syncExternalEventToSchedule(original[0].id, 'provider-1');
    expect(masterEntry().recurrence_pattern.weekOfMonth).toBe(1);

    // The user moves the series to the second Thursday. Google bumps `updated`
    // on the master and on every instance it re-emits.
    const editedAt = '2026-10-05T12:00:00.000Z';
    adapterState.events.set(
      MASTER_ID,
      googleMaster({ recurrence: ['RRULE:FREQ=MONTHLY;BYDAY=2TH'], updated: editedAt })
    );
    const reruled = [
      googleOccurrence('2026-11-12T15:15:00.000Z', { updated: editedAt }),
      googleOccurrence('2026-12-10T15:15:00.000Z', { updated: editedAt }),
    ];
    registerEvents(reruled);

    for (const instance of reruled) {
      expect((await service.syncExternalEventToSchedule(instance.id, 'provider-1')).success).toBe(true);
    }

    expect(db.entries.size).toBe(1);
    expect(mappings()).toHaveLength(1);
    expect(masterEntry().recurrence_pattern.weekOfMonth).toBe(2);
    // One read for the initial import, one for the edit — not one per instance.
    expect(adapterState.getEventCalls.filter((id) => id === MASTER_ID)).toHaveLength(2);
  });

  it('keeps the exceptions a series accumulated when its master is re-read', async () => {
    const instances = productionInstances(2);
    const cancelled = { ...instances[1], status: 'cancelled' };
    registerEvents([googleMaster(), ...instances]);
    adapterState.events.set(cancelled.id, cancelled);
    const service = await newSyncService();

    await service.syncExternalEventToSchedule(instances[0].id, 'provider-1');
    await service.syncExternalEventToSchedule(cancelled.id, 'provider-1');
    expect(masterEntry().recurrence_pattern.exceptions).toHaveLength(1);

    // The provider's recurrence[] never lists a cancelled occurrence, so a
    // re-read would otherwise resurrect it.
    const editedAt = '2026-10-05T12:00:00.000Z';
    adapterState.events.set(MASTER_ID, googleMaster({ updated: editedAt }));
    const later = googleOccurrence('2027-01-07T15:15:00.000Z', { updated: editedAt });
    registerEvents([later]);

    await service.syncExternalEventToSchedule(later.id, 'provider-1');

    expect(masterEntry().recurrence_pattern.exceptions.map((date: Date) => new Date(date).toISOString()))
      .toEqual(['2026-11-05T00:00:00.000Z']);
  });

  it('removes a Microsoft override on master delete, despite its unrelated id', async () => {
    // A Graph occurrence id is opaque base64 that shares nothing with its
    // master's, so the id-prefix sweep cannot find this child — the master's
    // occurrence index is what links them.
    const occurrence = microsoftOccurrence('2026-10-01T14:15:00.000Z');
    const moved = microsoftOccurrence('2026-11-05T14:15:00.000Z', {
      id: 'AAMkAGI2TG93exception-opaque=',
      title: 'Advisories (moved) @alga',
      start: { dateTime: '2026-11-06T14:15:00.000Z', timeZone: 'UTC' },
      end: { dateTime: '2026-11-06T14:45:00.000Z', timeZone: 'UTC' },
      instanceType: 'exception',
    });
    providerState.provider.provider_type = 'microsoft';
    registerEvents([microsoftMaster(), occurrence, moved]);
    const service = await newSyncService();

    await service.syncExternalEventToSchedule(occurrence.id, 'provider-1');
    await service.syncExternalEventToSchedule(moved.id, 'provider-1');
    expect(db.entries.size).toBe(2);
    expect(mappings().map((row) => row.external_event_id).sort())
      .toEqual([MS_MASTER_ID, moved.id].sort());

    const result = await service.handleInboundExternalDelete(MS_MASTER_ID, 'provider-1');

    expect(result.success).toBe(true);
    expect(db.entries.size).toBe(0);
    expect(mappings()).toHaveLength(0);
    expect(adapterState.deleteEventCalls).toEqual([]);
  });

  it('treats a split series (_R master) as its own master', async () => {
    const splitMasterId = `${MASTER_ID}_R20261105T151500Z`;
    const splitMaster = googleMaster({
      id: splitMasterId,
      title: 'Advisories, rescheduled @alga',
      recurrence: ['RRULE:FREQ=MONTHLY;BYDAY=2TH'],
    });
    const original = productionInstances(2);
    const splitInstance = googleOccurrence('2026-12-10T15:15:00.000Z', {
      recurringEventId: splitMasterId,
      title: 'Advisories, rescheduled @alga',
    });
    registerEvents([googleMaster(), ...original, splitMaster, splitInstance]);
    const service = await newSyncService();

    await service.syncExternalEventToSchedule(original[0].id, 'provider-1');
    await service.syncExternalEventToSchedule(splitInstance.id, 'provider-1');

    expect(db.entries.size).toBe(2);
    expect(mappings().map((row) => row.external_event_id).sort()).toEqual([MASTER_ID, splitMasterId].sort());
    const patterns = [...db.entries.values()].map((entry) => entry.recurrence_pattern.weekOfMonth);
    expect(patterns.sort()).toEqual([1, 2]);
  });

  it('skips a series whose master carries no @alga marker, even when an instance does', async () => {
    const master = googleMaster({ title: 'Private planning', description: 'personal' });
    const instance = googleOccurrence('2026-10-01T14:15:00.000Z', { title: 'Private planning @alga' });
    registerEvents([master, instance]);
    const service = await newSyncService();

    const result = await service.syncExternalEventToSchedule(instance.id, 'provider-1');

    expect(result.skipped).toBe(true);
    expect(db.entries.size).toBe(0);
    expect(mappings()).toHaveLength(0);
  });

  it('falls back to bounded per-instance import for a rule Alga cannot express', async () => {
    const master = googleMaster({ recurrence: ['RRULE:FREQ=MONTHLY;BYDAY=1TH', 'RDATE:20270210T151500Z'] });
    const inWindow = googleOccurrence(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString());
    const outOfWindow = googleOccurrence(new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000).toISOString());
    registerEvents([master, inWindow, outOfWindow]);
    const service = await newSyncService();

    const near = await service.syncExternalEventToSchedule(inWindow.id, 'provider-1');
    const far = await service.syncExternalEventToSchedule(outOfWindow.id, 'provider-1');

    expect(near.success).toBe(true);
    expect(far.skipped).toBe(true);
    expect(far.reason).toContain('12-month fallback window');

    expect(db.entries.size).toBe(1);
    expect(mappings()).toHaveLength(1);
    expect(mappings()[0].external_event_id).toBe(inWindow.id);
    expect(mappings()[0].sync_error_message).toContain('Alga cannot represent');
    expect(providerState.statusUpdates.some((update) => /cannot represent/.test(update.status.errorMessage ?? '')))
      .toBe(true);
  });

  it('re-pulls the master when its mapping still points at a non-recurring entry', async () => {
    // The user turned a single Alga-exported event into a recurring series on
    // the provider side: an instance must never overwrite that entry as if it
    // were standalone.
    const instances = productionInstances(2);
    registerEvents([googleMaster(), ...instances]);
    db.entries.set('exported-entry', {
      entry_id: 'exported-entry',
      tenant: 'tenant-1',
      title: MASTER_TITLE,
      is_recurring: false,
      recurrence_pattern: null,
      assigned_user_ids: ['user-1'],
      scheduled_start: new Date('2026-10-01T14:15:00.000Z'),
      scheduled_end: new Date('2026-10-01T14:45:00.000Z'),
      updated_at: new Date('2026-09-01T00:00:00.000Z'),
    });
    db.tables['calendar_event_mappings'].push({
      id: 'mapping-exported',
      tenant: 'tenant-1',
      calendar_provider_id: 'provider-1',
      schedule_entry_id: 'exported-entry',
      external_event_id: MASTER_ID,
      sync_status: 'synced',
      sync_direction: 'to_external',
      last_synced_at: '2026-09-20T00:00:00.000Z',
    });
    const service = await newSyncService();

    const result = await service.syncExternalEventToSchedule(instances[1].id, 'provider-1');

    expect(result.success).toBe(true);
    expect(db.entries.size).toBe(1);
    const entry = db.entries.get('exported-entry');
    expect(entry.is_recurring).toBe(true);
    expect(entry.recurrence_pattern).toMatchObject({ weekOfMonth: 1, daysOfWeek: [3] });
    expect(mappings()).toHaveLength(1);
  });

  it('cleans up an orphaned instance row when the series master is gone', async () => {
    const instance = googleOccurrence('2026-10-01T14:15:00.000Z');
    registerEvents([instance]);
    db.entries.set('legacy-entry', {
      entry_id: 'legacy-entry',
      tenant: 'tenant-1',
      title: MASTER_TITLE,
      is_recurring: false,
      assigned_user_ids: ['user-1'],
      scheduled_start: new Date('2026-10-01T14:15:00.000Z'),
      scheduled_end: new Date('2026-10-01T14:45:00.000Z'),
      updated_at: new Date('2026-09-24T18:47:00.000Z'),
    });
    db.tables['calendar_event_mappings'].push({
      id: 'mapping-legacy',
      tenant: 'tenant-1',
      calendar_provider_id: 'provider-1',
      schedule_entry_id: 'legacy-entry',
      external_event_id: instance.id,
      sync_status: 'synced',
      sync_direction: 'from_external',
    });
    const service = await newSyncService();

    const result = await service.syncExternalEventToSchedule(instance.id, 'provider-1');

    expect(result.success).toBe(true);
    expect(db.entries.has('legacy-entry')).toBe(false);
    expect(mappings()).toHaveLength(0);
    expect(adapterState.deleteEventCalls).toEqual([]);
  });
});
