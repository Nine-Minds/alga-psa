import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The webhook processor's *deleted* branch, driven end to end against the real
 * CalendarSyncService.
 *
 * Both halves of the recurring-import fix meet here: a provider delete that
 * names one occurrence of a synced series must become an exception date on the
 * master, and a delete nobody can place must be left alone. The resolution path
 * differs per provider — Google still serves a cancelled instance through
 * events.get, while Graph sends an `@removed` item holding nothing but an opaque
 * id that then 404s, so Microsoft occurrences are resolved from the index the
 * master's mapping row carries.
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
  googleChanges: [] as Array<{ id: string; changeType: 'updated' | 'deleted' }>,
  microsoftChanges: [] as Array<{ id: string; changeType: 'updated' | 'deleted' }>,
}));

const providerState = vi.hoisted(() => ({
  provider: null as any,
  vendorConfigUpdates: [] as Array<Record<string, any>>,
}));

/** Minimal knex-shaped query builder over an in-memory array. */
function fakeQuery(rows: () => any[], replace: (next: any[]) => void) {
  const predicates: Array<(row: any) => boolean> = [];

  const addCondition = (column: any, operatorOrValue?: any, maybeValue?: any) => {
    if (typeof column === 'object' && column !== null) {
      const criteria = column as Record<string, any>;
      predicates.push((row) => Object.entries(criteria).every(([key, value]) => row[key] === value));
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
    async getProvider() {
      return providerState.provider;
    }
    async updateProvider(_id: string, _tenant: string, data: { vendorConfig?: Record<string, any> }) {
      if (data.vendorConfig) {
        providerState.vendorConfigUpdates.push(data.vendorConfig);
        providerState.provider.provider_config = {
          ...providerState.provider.provider_config,
          ...data.vendorConfig,
        };
      }
    }
    async updateProviderStatus() {
      return undefined;
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
  fetchEventChanges: async () => ({ changes: [...adapterState.googleChanges], nextSyncToken: 'token-next' }),
  fetchDeltaChanges: async () => ({ changes: [...adapterState.microsoftChanges], deltaLink: 'delta-next' }),
};

vi.mock('@alga-psa/ee-calendar/lib/services/calendar/providers/GoogleCalendarAdapter', () => ({
  GoogleCalendarAdapter: class { constructor() { return fakeAdapter as any; } },
}));
vi.mock('@alga-psa/ee-calendar/lib/services/calendar/providers/MicrosoftCalendarAdapter', () => ({
  MicrosoftCalendarAdapter: class { constructor() { return fakeAdapter as any; } },
}));

/** In-memory stand-in for the schedule-entry model (see recurringImport test). */
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
    update: async (_knex: any, _tenant: string, entryId: string, changes: any) => {
      const entry = db.entries.get(entryId);
      if (!entry) return undefined;
      const updated = { ...entry, ...changes, entry_id: entryId, updated_at: new Date() };
      db.entries.set(entryId, updated);
      return structuredClone(updated);
    },
    delete: async (_knex: any, _tenant: string, entryId: string) => db.entries.delete(entryId),
  };

  return { default: model, ScheduleEntry: model };
});

const GOOGLE_MASTER_ID = '2ppb6f3ftc40nggeoqtsoh743g';
const MS_MASTER_ID = 'AAMkAGI2TG93AAA=';
const TITLE = 'Go over advisories in Git @alga';

function compactUtc(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function master(provider: 'google' | 'microsoft') {
  return {
    id: provider === 'google' ? GOOGLE_MASTER_ID : MS_MASTER_ID,
    provider,
    title: TITLE,
    description: '',
    start: { dateTime: '2026-10-01T10:15:00-04:00', timeZone: 'America/New_York' },
    end: { dateTime: '2026-10-01T10:45:00-04:00', timeZone: 'America/New_York' },
    recurrence: ['RRULE:FREQ=MONTHLY;BYDAY=1TH'],
    instanceType: 'master',
    status: 'confirmed',
    updated: '2026-09-24T18:47:00.000Z',
  };
}

function occurrence(provider: 'google' | 'microsoft', startIso: string, overrides: Record<string, any> = {}) {
  const masterId = provider === 'google' ? GOOGLE_MASTER_ID : MS_MASTER_ID;
  return {
    // Google instance ids name the master and the slot; Graph's are opaque.
    id: provider === 'google'
      ? `${masterId}_${compactUtc(startIso)}`
      : `AAMkAGI2TG93occurrence${compactUtc(startIso)}=`,
    provider,
    title: TITLE,
    description: '',
    start: { dateTime: startIso, timeZone: 'America/New_York' },
    end: { dateTime: new Date(new Date(startIso).getTime() + 30 * 60 * 1000).toISOString(), timeZone: 'America/New_York' },
    originalStartTime: { dateTime: startIso },
    recurringEventId: masterId,
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

function exceptionDates(): string[] {
  const pattern = masterEntry()?.recurrence_pattern;
  return (pattern?.exceptions ?? []).map((date: Date) => new Date(date).toISOString());
}

async function newProcessor(providerType: 'google' | 'microsoft') {
  const module = await import('@alga-psa/ee-calendar/lib/services/calendar/CalendarWebhookProcessor');
  const processor = new module.CalendarWebhookProcessor();
  const lookup = providerType === 'google'
    ? ['getProviderByGoogleSubscription', 'getProviderByGoogleChannelId']
    : ['getProviderByMicrosoftSubscription'];
  for (const method of lookup) {
    vi.spyOn(processor as any, method).mockResolvedValue(providerState.provider);
  }
  vi.spyOn(processor as any, 'createAdapter').mockResolvedValue(fakeAdapter as any);
  return processor;
}

describe('CalendarWebhookProcessor recurring deletes', () => {
  beforeEach(() => {
    db.tables = {
      calendar_event_mappings: [],
      calendar_provider_health: [],
      calendars: [],
      users: [{ tenant: 'tenant-1', user_id: 'user-1', user_type: 'internal', email: 'tech@example.com' }],
    };
    db.entries = new Map();
    db.sequence = 0;
    adapterState.events = new Map();
    adapterState.getEventCalls = [];
    adapterState.deleteEventCalls = [];
    adapterState.googleChanges = [];
    adapterState.microsoftChanges = [];
    providerState.vendorConfigUpdates = [];
    providerState.provider = {
      id: 'provider-1',
      tenant: 'tenant-1',
      user_id: 'user-1',
      name: 'Calendar',
      provider_type: 'google',
      calendar_id: 'primary',
      active: true,
      sync_direction: 'bidirectional',
      connection_status: 'connected',
      provider_config: { accessToken: 'access', refreshToken: 'refresh' },
    };
  });

  for (const flavour of ['pubsub', 'channel'] as const) {
    it(`turns a cancelled Google occurrence into a master exception (${flavour} webhook)`, async () => {
      const first = occurrence('google', '2026-10-01T14:15:00.000Z');
      const second = occurrence('google', '2026-11-05T15:15:00.000Z');
      registerEvents([master('google'), first, second]);
      const processor = await newProcessor('google');
      const deliver = () => flavour === 'pubsub'
        ? processor.processGoogleWebhook({ data: 'ignored' }, 'subscription-1')
        : processor.processGoogleChannelWebhook({ channelId: 'channel-1' });

      adapterState.googleChanges = [{ id: first.id, changeType: 'updated' }];
      expect(await deliver()).toEqual({ success: 1, failed: 0 });
      expect(mappings().map((row) => row.external_event_id)).toEqual([GOOGLE_MASTER_ID]);

      // The user deleted one occurrence. Google reports the instance id as
      // deleted with no series hint, and events.get still serves it as
      // cancelled — which is the only thing naming the master.
      adapterState.events.set(second.id, { ...second, status: 'cancelled' });
      adapterState.googleChanges = [{ id: second.id, changeType: 'deleted' }];
      adapterState.getEventCalls = [];

      expect(await deliver()).toEqual({ success: 1, failed: 0 });

      expect(adapterState.getEventCalls).toContain(second.id);
      expect(db.entries.size).toBe(1);
      expect(masterEntry().is_recurring).toBe(true);
      expect(exceptionDates()).toEqual(['2026-11-05T00:00:00.000Z']);
      expect(adapterState.deleteEventCalls).toEqual([]);
    });
  }

  it('skips a deleted Google id with no mapping that events.get no longer serves', async () => {
    const first = occurrence('google', '2026-10-01T14:15:00.000Z');
    const second = occurrence('google', '2026-11-05T15:15:00.000Z');
    registerEvents([master('google'), first, second]);
    const processor = await newProcessor('google');

    adapterState.googleChanges = [{ id: first.id, changeType: 'updated' }];
    await processor.processGoogleWebhook({ data: 'ignored' }, 'subscription-1');

    // Purged on the provider side: nothing places this id, so no series may be
    // guessed from its `_<timestamp>` suffix.
    adapterState.events.delete(second.id);
    adapterState.googleChanges = [{ id: second.id, changeType: 'deleted' }];
    adapterState.getEventCalls = [];

    expect(await processor.processGoogleWebhook({ data: 'ignored' }, 'subscription-1'))
      .toEqual({ success: 1, failed: 0 });

    expect(adapterState.getEventCalls).toContain(second.id);
    expect(exceptionDates()).toEqual([]);
    expect(db.entries.size).toBe(1);
    expect(mappings()).toHaveLength(1);
  });

  it('turns an @removed Microsoft occurrence into a master exception', async () => {
    providerState.provider.provider_type = 'microsoft';
    providerState.provider.provider_config.webhookVerificationToken = 'verify-token';
    const first = occurrence('microsoft', '2026-10-01T14:15:00.000Z');
    const second = occurrence('microsoft', '2026-11-05T15:15:00.000Z');
    registerEvents([master('microsoft'), first, second]);
    const processor = await newProcessor('microsoft');
    const notify = (id: string, changeType: 'updated' | 'deleted') => processor.processMicrosoftWebhook([
      { subscriptionId: 'subscription-1', clientState: 'verify-token', changeType, resourceData: { id } },
    ]);

    adapterState.microsoftChanges = [
      { id: first.id, changeType: 'updated' },
      { id: second.id, changeType: 'updated' },
    ];
    expect(await notify(first.id, 'updated')).toEqual({ success: 2, failed: 0 });
    expect(mappings().map((row) => row.external_event_id)).toEqual([MS_MASTER_ID]);
    expect(Object.keys(mappings()[0].occurrence_index).sort()).toEqual([first.id, second.id].sort());

    // Graph drops the occurrence from the series and reports only `@removed`
    // with its opaque id; a GET on it 404s.
    adapterState.events.delete(second.id);
    adapterState.microsoftChanges = [{ id: second.id, changeType: 'deleted' }];
    adapterState.getEventCalls = [];

    expect(await notify(second.id, 'deleted')).toEqual({ success: 1, failed: 0 });

    expect(db.entries.size).toBe(1);
    expect(masterEntry().is_recurring).toBe(true);
    expect(exceptionDates()).toEqual(['2026-11-05T00:00:00.000Z']);
    expect(adapterState.deleteEventCalls).toEqual([]);
  });

  it('deletes the series when the Microsoft master itself is removed', async () => {
    providerState.provider.provider_type = 'microsoft';
    providerState.provider.provider_config.webhookVerificationToken = 'verify-token';
    const first = occurrence('microsoft', '2026-10-01T14:15:00.000Z');
    registerEvents([master('microsoft'), first]);
    const processor = await newProcessor('microsoft');
    const notify = (id: string, changeType: 'updated' | 'deleted') => processor.processMicrosoftWebhook([
      { subscriptionId: 'subscription-1', clientState: 'verify-token', changeType, resourceData: { id } },
    ]);

    adapterState.microsoftChanges = [{ id: first.id, changeType: 'updated' }];
    await notify(first.id, 'updated');
    expect(db.entries.size).toBe(1);

    adapterState.microsoftChanges = [{ id: MS_MASTER_ID, changeType: 'deleted' }];
    expect(await notify(MS_MASTER_ID, 'deleted')).toEqual({ success: 1, failed: 0 });

    // Master gone, and with it the occurrence index on its mapping row.
    expect(db.entries.size).toBe(0);
    expect(mappings()).toHaveLength(0);
    expect(adapterState.deleteEventCalls).toEqual([]);
  });
});
