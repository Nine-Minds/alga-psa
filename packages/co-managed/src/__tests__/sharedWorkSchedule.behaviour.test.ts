/**
 * Behavioural tests for the co-managed schedule and appointment-request commands.
 *
 * They run the REAL command code (validation, occurrence-scope resolution, the in-use refusal,
 * appointment state transitions, workspace gate) over the in-memory table store used by the other
 * co-managed tests. Mocked, and only these: the authorization boundary (identity lock, RBAC, kernel
 * decision, write admission), the schedule-entry model's SQL mutators (replaced by a store-backed
 * double that runs the model's real `validateAllDayInterval`), and the relation sync. No Postgres
 * is involved: the tables these commands need (the new meeting-operation table, time_tracking_sessions
 * columns) are not all present in the dev-stack schema.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFake, type FakeStore } from './fakeCoManagedDb';

const gate = vi.hoisted(() => ({
  hooks: [] as Array<() => Promise<void>>,
  admissionCalls: 0,
  denyKernel: false,
  model: { create: [] as any[], update: [] as any[], delete: [] as any[] },
}));

vi.mock('@alga-psa/db', async () => {
  const fake = await import('./fakeCoManagedDb');
  return {
    tenantDb: (db: any, tenant: string) => fake.fakeTenantDb(db, tenant),
    tenantTableMetadata: {},
    withTransaction: async (db: any, work: any) => {
      gate.hooks.length = 0;
      const result = await db.transaction(work);
      for (const hook of gate.hooks.splice(0)) await hook();
      return result;
    },
    registerAfterCommit: (_trx: any, hook: () => Promise<void>) => { gate.hooks.push(hook); },
  };
});
vi.mock('@alga-psa/licensing/lifecycle', () => ({ assertCoManagedOperationalWrite: async () => { gate.admissionCalls += 1; } }));
vi.mock('../localAuthentication', () => ({
  snapshotCoManagedAuthenticatedActor: (actor: any) => ({ ...actor }),
  lockCoManagedLocalAuthentication: async (_trx: any, actor: any) => ({ actor, subject: { tenant: actor.tenant, userId: actor.userId, teamIds: [], roleIds: [] }, assertCurrent: async () => undefined }),
}));
vi.mock('../localPermission', () => ({ hasCoManagedLocalPermission: async () => true }));
vi.mock('@alga-psa/authorization', () => {
  const decision = () => gate.denyKernel ? { allowed: false, redactedFields: [], scope: { constraints: [] } } : { allowed: true, redactedFields: [], scope: { constraints: [] } };
  return {
    createAuthorizationKernel: () => ({ authorizeResource: async () => decision() }),
    BuiltinAuthorizationKernelProvider: class {}, BundleAuthorizationKernelProvider: class {},
    resolveBundleNarrowingRulesForEvaluation: async () => [],
  };
});
vi.mock('../nativeScheduleRelations', async () => {
  const actual = await vi.importActual<typeof import('../nativeScheduleRelations')>('../nativeScheduleRelations');
  return { ...actual, applyNativeScheduleRelations: async () => undefined };
});
vi.mock('@alga-psa/shared/models/scheduleEntry', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/shared/models/scheduleEntry')>('@alga-psa/shared/models/scheduleEntry');
  const store = () => (globalThis as any).__scheduleStore as FakeStore;
  const { randomUUID } = await import('node:crypto');
  const model = {
    async create(_trx: any, tenant: string, entry: any, options: any) {
      actual.validateAllDayInterval(entry);
      const row = { tenant, entry_id: options.entryId ?? randomUUID(), is_recurring: false, ...entry, work_item_id: entry.work_item_type === 'ad_hoc' ? null : entry.work_item_id };
      delete row.assigned_user_ids;
      store().rows('schedule_entries').push(row);
      for (const user_id of options.assignedUserIds) store().rows('schedule_entry_assignees').push({ tenant, entry_id: row.entry_id, user_id });
      gate.model.create.push({ entry, options });
      return { ...row };
    },
    async update(_trx: any, tenant: string, id: string, patch: any, scope?: string) {
      const master = id.split('_')[0];
      const row = store().rows('schedule_entries').find(item => item.entry_id === master && item.tenant === tenant)!;
      actual.validateAllDayInterval({ is_all_day: patch.is_all_day ?? row.is_all_day, scheduled_start: patch.scheduled_start ?? row.scheduled_start, scheduled_end: patch.scheduled_end ?? row.scheduled_end });
      gate.model.update.push({ id, patch, scope });
      return { ...row };
    },
    async delete(_trx: any, tenant: string, id: string, scope?: string) {
      gate.model.delete.push({ id, scope });
      if (scope === 'single' || scope === 'future') return true;
      store().tables.schedule_entries = store().rows('schedule_entries').filter(item => item.entry_id !== id.split('_')[0]);
      return true;
    },
  };
  return { ...actual, default: model };
});

import { commandCoManagedNativeSchedule, NativeScheduleError } from '../nativeScheduleCommand';
import { approveCoManagedNativeAppointment } from '../nativeAppointmentApproval';
import { declineCoManagedNativeAppointment, rescheduleCoManagedNativeAppointment } from '../nativeAppointmentRequestCommand';
import { CoManagedSharedWorkError } from '../sharedWorkIdentity';
import { NativeScheduleRelationError } from '../nativeScheduleRelations';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TENANT = id(1), USER = id(2), TECH = id(3), SESSION = id(4), ENTRY = id(10), REQUEST = id(20), TICKET = id(30), SERVICE = id(40), CLIENT = id(50), OTHER_ENTRY = id(11);
const actor = { kind: 'session' as const, tenant: TENANT, userId: USER, sessionId: SESSION };
const identify = async () => actor;
const DAY = 86_400_000;

let store: FakeStore, db: any, published: any[];
const publish = async (event: any) => { published.push(event); };

function seedWorkspace(productCode = 'co_managed', suspendedAt: string | null = null) {
  store.seed('tenants', { tenant: TENANT, product_code: productCode, suspended_at: suspendedAt });
  store.seed('users', { tenant: TENANT, user_id: USER, user_type: 'internal', is_inactive: false }, { tenant: TENANT, user_id: TECH, user_type: 'internal', is_inactive: false });
}
function seedEntry(overrides: Record<string, any> = {}, assignees = [USER]) {
  const entry_id = overrides.entry_id ?? ENTRY;
  store.seed('schedule_entries', { tenant: TENANT, entry_id, title: 'Visit', notes: '', status: 'scheduled', work_item_type: 'ad_hoc', work_item_id: null,
    is_private: false, is_all_day: false, is_recurring: false, recurrence_pattern: null, scheduled_start: new Date('2026-11-02T09:00:00Z'), scheduled_end: new Date('2026-11-02T10:00:00Z'), ...overrides });
  for (const user_id of assignees) store.seed('schedule_entry_assignees', { tenant: TENANT, entry_id, user_id });
}

beforeEach(() => {
  ({ store, db } = createFake());
  (globalThis as any).__scheduleStore = store;
  published = []; gate.hooks.length = 0; gate.admissionCalls = 0; gate.denyKernel = false;
  gate.model = { create: [], update: [], delete: [] };
});

describe('workspace gate', () => {
  const commands: Array<[string, () => Promise<any>]> = [
    ['schedule', () => commandCoManagedNativeSchedule(db, TENANT, { action: 'delete', id: ENTRY }, identify, publish)],
    ['approve', () => approveCoManagedNativeAppointment(db, TENANT, { id: REQUEST, assignedUserId: TECH }, identify, publish)],
    ['decline', () => declineCoManagedNativeAppointment(db, TENANT, { id: REQUEST, reason: 'no' }, identify, publish)],
    ['reschedule', () => rescheduleCoManagedNativeAppointment(db, TENANT, { id: REQUEST, date: '2026-11-06', time: '10:00' }, identify, publish)],
  ];

  it.each(commands)('%s answers handled:false for a non-co_managed workspace and touches nothing', async (_name, run) => {
    seedWorkspace('psa');
    seedEntry();
    const before = JSON.stringify(store.tables);
    expect(await run()).toEqual({ handled: false });
    expect(JSON.stringify(store.tables)).toBe(before);
    expect(gate.admissionCalls).toBe(0);
    expect(gate.model).toEqual({ create: [], update: [], delete: [] });
    expect(store.locks.filter(lock => !lock.endsWith(':tenants:share'))).toEqual([]);
  });

  it.each(commands)('%s refuses a suspended co_managed workspace', async (_name, run) => {
    seedWorkspace('co_managed', '2026-10-01T00:00:00.000Z');
    await expect(run()).rejects.toBeInstanceOf(CoManagedSharedWorkError);
    expect(gate.admissionCalls).toBe(0);
  });
});

describe('schedule command: all-day rule', () => {
  beforeEach(() => seedWorkspace());
  const allDay = { title: 'Offsite', is_all_day: true, work_item_type: 'ad_hoc', assigned_user_ids: [USER] };

  it('creates a valid all-day entry (UTC-midnight, exclusive end) and publishes after commit', async () => {
    const result = await commandCoManagedNativeSchedule(db, TENANT, { action: 'create', data: { ...allDay,
      scheduled_start: '2026-11-03T00:00:00.000Z', scheduled_end: '2026-11-04T00:00:00.000Z' } }, identify, publish);
    expect(result).toMatchObject({ handled: true, entry: { title: 'Offsite', is_all_day: true } });
    expect(gate.model.create).toHaveLength(1);
    expect(store.rows('schedule_entries')).toHaveLength(1);
    expect(published).toEqual([{ eventType: 'SCHEDULE_ENTRY_CREATED', payload: { tenantId: TENANT, userId: USER, entryId: store.rows('schedule_entries')[0].entry_id } }]);
    expect(gate.admissionCalls).toBeGreaterThan(0);
  });

  it.each([
    ['a timed boundary', '2026-11-03T09:00:00.000Z', '2026-11-04T00:00:00.000Z'],
    ['a zero-length day', '2026-11-03T00:00:00.000Z', '2026-11-03T00:00:00.000Z'],
    ['an inclusive end on the same day', '2026-11-03T00:00:00.000Z', '2026-11-03T23:59:59.000Z'],
  ])('rejects create with %s and writes nothing', async (_label, scheduled_start, scheduled_end) => {
    await expect(commandCoManagedNativeSchedule(db, TENANT, { action: 'create', data: { ...allDay, scheduled_start, scheduled_end } }, identify, publish))
      .rejects.toThrow(/UTC-midnight|invalid/i);
    expect(store.rows('schedule_entries')).toHaveLength(0);
    expect(published).toEqual([]);
  });

  it('validates a partial edit against the merged row, so the existing all-day flag still governs', async () => {
    seedEntry({ is_all_day: true, scheduled_start: new Date('2026-11-03T00:00:00Z'), scheduled_end: new Date('2026-11-04T00:00:00Z') });
    await expect(commandCoManagedNativeSchedule(db, TENANT, { action: 'update', id: ENTRY, data: { scheduled_end: '2026-11-04T08:00:00.000Z' } }, identify, publish))
      .rejects.toThrow(/UTC-midnight/);
    expect(gate.model.update).toHaveLength(0);
    const ok = await commandCoManagedNativeSchedule(db, TENANT, { action: 'update', id: ENTRY, data: { scheduled_end: '2026-11-05T00:00:00.000Z' } }, identify, publish);
    expect(ok).toMatchObject({ handled: true });
    expect(gate.model.update).toHaveLength(1);
  });

  it('refuses a caller the kernel denies, before any model write', async () => {
    gate.denyKernel = true;
    await expect(commandCoManagedNativeSchedule(db, TENANT, { action: 'create', data: { ...allDay,
      scheduled_start: '2026-11-03T00:00:00.000Z', scheduled_end: '2026-11-04T00:00:00.000Z' } }, identify, publish)).rejects.toBeInstanceOf(CoManagedSharedWorkError);
    expect(gate.model.create).toHaveLength(0);
  });
});

describe('schedule command: recurring scope', () => {
  const pattern = { frequency: 'daily', interval: 1, startDate: '2026-11-02T09:00:00.000Z' };
  const occurrence = new Date('2026-11-04T09:00:00Z').getTime();
  beforeEach(() => {
    seedWorkspace();
    seedEntry({ is_recurring: true, recurrence_pattern: pattern });
  });

  it('single update targets the virtual occurrence id with scope single', async () => {
    await commandCoManagedNativeSchedule(db, TENANT, { action: 'update', id: `${ENTRY}_${occurrence}`, scope: 'single', data: { title: 'Moved' } }, identify, publish);
    expect(gate.model.update).toMatchObject([{ id: `${ENTRY}_${occurrence}`, scope: 'single' }]);
  });

  it('all update on a virtual occurrence rewrites the master, keeping the series anchor date', async () => {
    await commandCoManagedNativeSchedule(db, TENANT, { action: 'update', id: `${ENTRY}_${occurrence}`, scope: 'all', data: { title: 'Series' } }, identify, publish);
    expect(gate.model.update).toHaveLength(1);
    expect(gate.model.update[0].id).toBe(ENTRY);
    expect(new Date(gate.model.update[0].patch.scheduled_start).getDate()).toBe(new Date('2026-11-02T09:00:00Z').getDate());
  });

  it('future delete on a later occurrence keeps the master and passes the occurrence id', async () => {
    await commandCoManagedNativeSchedule(db, TENANT, { action: 'delete', id: `${ENTRY}_${occurrence}`, scope: 'future' }, identify, publish);
    expect(gate.model.delete).toEqual([{ id: `${ENTRY}_${occurrence}`, scope: 'future' }]);
    expect(store.rows('schedule_entries')).toHaveLength(1);
  });

  it('future delete from the first occurrence widens to the whole series', async () => {
    const first = new Date('2026-11-02T09:00:00Z').getTime();
    await commandCoManagedNativeSchedule(db, TENANT, { action: 'delete', id: `${ENTRY}_${first}`, scope: 'future' }, identify, publish);
    expect(gate.model.delete).toEqual([{ id: ENTRY, scope: 'all' }]);
    expect(store.rows('schedule_entries')).toHaveLength(0);
  });

  it('an occurrence the pattern never generates is not found and writes nothing', async () => {
    const offPattern = new Date('2026-11-04T13:30:00Z').getTime();
    await expect(commandCoManagedNativeSchedule(db, TENANT, { action: 'delete', id: `${ENTRY}_${offPattern}`, scope: 'single' }, identify, publish))
      .rejects.toMatchObject({ code: 'SCHEDULE_OCCURRENCE_NOT_FOUND' });
    expect(gate.model.delete).toHaveLength(0);
  });

  it('rejects an unknown scope before opening a transaction', async () => {
    await expect(commandCoManagedNativeSchedule(db, TENANT, { action: 'delete', id: ENTRY, scope: 'bogus' as any }, identify, publish)).rejects.toBeInstanceOf(NativeScheduleError);
  });
});

describe('schedule command: delete is refused while time points at the entry', () => {
  beforeEach(() => { seedWorkspace(); seedEntry(); });
  const remove = () => commandCoManagedNativeSchedule(db, TENANT, { action: 'delete', id: ENTRY }, identify, publish);

  it('refuses when a time entry references the entry', async () => {
    store.seed('time_entries', { tenant: TENANT, entry_id: id(90), work_item_type: 'ad_hoc', work_item_id: ENTRY });
    await expect(remove()).rejects.toMatchObject({ code: 'SCHEDULE_IN_USE' });
    expect(gate.model.delete).toHaveLength(0);
    expect(store.rows('schedule_entries')).toHaveLength(1);
  });

  it.each(['running', 'paused'])('refuses while a %s timer references the entry', async status => {
    store.seed('time_tracking_sessions', { tenant: TENANT, session_id: id(91), work_item_type: 'ad_hoc', work_item_id: ENTRY, status });
    await expect(remove()).rejects.toMatchObject({ code: 'SCHEDULE_IN_USE' });
    expect(gate.model.delete).toHaveLength(0);
  });

  it('allows deletion once the timer is logged or discarded, and for an unrelated entry\'s time', async () => {
    store.seed('time_tracking_sessions', { tenant: TENANT, session_id: id(91), work_item_type: 'ad_hoc', work_item_id: ENTRY, status: 'logged' },
      { tenant: TENANT, session_id: id(92), work_item_type: 'ad_hoc', work_item_id: ENTRY, status: 'discarded' });
    store.seed('time_entries', { tenant: TENANT, entry_id: id(90), work_item_type: 'ad_hoc', work_item_id: OTHER_ENTRY });
    expect(await remove()).toMatchObject({ handled: true });
    expect(gate.model.delete).toEqual([{ id: ENTRY, scope: undefined }]);
    expect(published).toMatchObject([{ eventType: 'SCHEDULE_ENTRY_DELETED' }]);
  });

  it('time in another tenant does not block', async () => {
    store.seed('time_entries', { tenant: id(999), entry_id: id(90), work_item_type: 'ad_hoc', work_item_id: ENTRY });
    expect(await remove()).toMatchObject({ handled: true });
  });
});

describe('appointment requests on a shared ticket', () => {
  const baseRequest = (overrides: Record<string, any> = {}) => ({ tenant: TENANT, appointment_request_id: REQUEST, ticket_id: TICKET, client_id: null, service_id: SERVICE,
    requested_date: '2026-11-05', requested_time: '10:00:00', requested_duration: 60, requester_timezone: 'UTC', status: 'pending', preferred_assigned_user_id: TECH,
    schedule_entry_id: null, is_authenticated: false, requester_name: 'Pat', requester_email: 'pat@example.com', ...overrides });
  beforeEach(() => {
    seedWorkspace();
    store.seed('tickets', { tenant: TENANT, ticket_id: TICKET, title: 'Printer down', client_id: CLIENT, board_id: id(60), assigned_to: TECH, entered_by: USER });
    store.seed('service_catalog', { tenant: TENANT, service_id: SERVICE, service_name: 'On-site visit' });
  });

  it('approve creates the calendar entry under the reserved id, binds client from the ticket, and publishes CREATED', async () => {
    store.seed('appointment_requests', baseRequest());
    const result: any = await approveCoManagedNativeAppointment(db, TENANT, { id: REQUEST, assignedUserId: TECH, internalNotes: 'bring toner' }, identify, publish);
    expect(result.handled).toBe(true);
    expect(result.request).toMatchObject({ status: 'approved' });
    const [entry] = store.rows('schedule_entries');
    expect(entry).toMatchObject({ work_item_type: 'appointment_request', work_item_id: REQUEST, title: 'Appointment: On-site visit' });
    expect(entry.notes).toContain('bring toner');
    expect(new Date(entry.scheduled_start).toISOString()).toBe('2026-11-05T10:00:00.000Z');
    expect(gate.model.create[0].options).toMatchObject({ entryId: entry.entry_id, assignedUserIds: [TECH], assignedByUserId: USER });
    expect(store.rows('appointment_requests')[0]).toMatchObject({ status: 'approved', schedule_entry_id: entry.entry_id, client_id: CLIENT, ticket_id: TICKET, approved_by_user_id: USER, preferred_assigned_user_id: TECH });
    expect(published).toEqual([{ eventType: 'SCHEDULE_ENTRY_CREATED', payload: { tenantId: TENANT, userId: USER, entryId: entry.entry_id } }]);
  });

  it('approve honours a final date/time override (UTC) and refuses a request that is no longer pending', async () => {
    store.seed('appointment_requests', baseRequest());
    await approveCoManagedNativeAppointment(db, TENANT, { id: REQUEST, assignedUserId: TECH, finalDate: '2026-11-09', finalTime: '14:30' }, identify, publish);
    expect(new Date(store.rows('schedule_entries')[0].scheduled_start).toISOString()).toBe('2026-11-09T14:30:00.000Z');
    await expect(approveCoManagedNativeAppointment(db, TENANT, { id: REQUEST, assignedUserId: TECH }, identify, publish)).rejects.toBeInstanceOf(NativeScheduleRelationError);
    expect(store.rows('schedule_entries')).toHaveLength(1);
  });

  it('approve with an unknown technician rolls back and publishes nothing', async () => {
    store.seed('appointment_requests', baseRequest());
    await expect(approveCoManagedNativeAppointment(db, TENANT, { id: REQUEST, assignedUserId: id(777) }, identify, publish)).rejects.toBeInstanceOf(CoManagedSharedWorkError);
    expect(store.rows('appointment_requests')[0].status).toBe('pending');
    expect(published).toEqual([]);
  });

  describe('with an approved request on the calendar', () => {
    beforeEach(() => {
      seedEntry({ work_item_type: 'appointment_request', work_item_id: REQUEST, scheduled_start: new Date('2026-11-05T10:00:00Z'), scheduled_end: new Date('2026-11-05T11:00:00Z') }, [TECH]);
      store.seed('appointment_requests', baseRequest({ status: 'approved', schedule_entry_id: ENTRY, client_id: CLIENT }));
    });

    it('decline removes the entry and its assignees, records the reason, and publishes DELETED', async () => {
      expect(await declineCoManagedNativeAppointment(db, TENANT, { id: REQUEST, reason: 'No capacity' }, identify, publish)).toEqual({ handled: true });
      expect(store.rows('schedule_entries')).toHaveLength(0);
      expect(store.rows('schedule_entry_assignees')).toHaveLength(0);
      expect(store.rows('appointment_requests')[0]).toMatchObject({ status: 'declined', declined_reason: 'No capacity', approved_by_user_id: USER });
      expect(published).toEqual([{ eventType: 'SCHEDULE_ENTRY_DELETED', payload: { tenantId: TENANT, userId: USER, entryId: ENTRY } }]);
    });

    it('decline needs a reason, and an already declined request cannot be declined again', async () => {
      await expect(declineCoManagedNativeAppointment(db, TENANT, { id: REQUEST, reason: '   ' }, identify, publish)).rejects.toBeInstanceOf(CoManagedSharedWorkError);
      await declineCoManagedNativeAppointment(db, TENANT, { id: REQUEST, reason: 'x' }, identify, publish);
      await expect(declineCoManagedNativeAppointment(db, TENANT, { id: REQUEST, reason: 'again' }, identify, publish)).rejects.toBeInstanceOf(NativeScheduleRelationError);
    });

    it('decline is refused while a running timer points at the calendar entry', async () => {
      store.seed('time_tracking_sessions', { tenant: TENANT, session_id: id(91), work_item_type: 'ad_hoc', work_item_id: ENTRY, status: 'running' });
      await expect(declineCoManagedNativeAppointment(db, TENANT, { id: REQUEST, reason: 'nope' }, identify, publish)).rejects.toBeInstanceOf(NativeScheduleRelationError);
      expect(store.rows('schedule_entries')).toHaveLength(1);
      expect(store.rows('appointment_requests')[0].status).toBe('approved');
    });

    it('reschedule moves the entry and the request in the requester timezone and publishes UPDATED', async () => {
      const result: any = await rescheduleCoManagedNativeAppointment(db, TENANT, { id: REQUEST, date: '2026-11-06', time: '09:15', timezone: 'America/New_York', duration: 30 }, identify, publish);
      expect(result.handled).toBe(true);
      const [entry] = store.rows('schedule_entries');
      expect(new Date(entry.scheduled_start).toISOString()).toBe('2026-11-06T14:15:00.000Z');
      expect(new Date(entry.scheduled_end).toISOString()).toBe('2026-11-06T14:45:00.000Z');
      expect(store.rows('appointment_requests')[0]).toMatchObject({ requested_date: '2026-11-06', requested_time: '09:15', requester_timezone: 'America/New_York', requested_duration: 30, status: 'approved' });
      expect(published).toMatchObject([{ eventType: 'SCHEDULE_ENTRY_UPDATED', payload: { entryId: ENTRY } }]);
    });

    it('reschedule of a declined request is refused and leaves the calendar alone', async () => {
      store.rows('appointment_requests')[0].status = 'declined';
      await expect(rescheduleCoManagedNativeAppointment(db, TENANT, { id: REQUEST, date: '2026-11-06', time: '09:15' }, identify, publish)).rejects.toBeInstanceOf(NativeScheduleRelationError);
      expect(new Date(store.rows('schedule_entries')[0].scheduled_start).toISOString()).toBe('2026-11-05T10:00:00.000Z');
    });
  });
});
