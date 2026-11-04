/**
 * Lifecycle tests for the durable co-managed appointment-meeting creation state machine, driven
 * by a stub AppointmentMeetingProvider. The REAL appointmentMeetingCreation.ts runs over the
 * in-memory table store (workspace gate, uncertain-before-POST, receipt bookkeeping, attach,
 * cleanup, recovery). Mocked, and only these: the authorization boundary, the prepare admission
 * (it writes the 'prepared' row but its source/calendar locking is not exercised here), the
 * approval command, the request view and the slot retention. No Postgres is involved.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFake, type FakeStore } from './fakeCoManagedDb';

const OP = '00000000-0000-4000-8000-0000000000a1';
const TENANT = '00000000-0000-4000-8000-000000000001';
const USER = '00000000-0000-4000-8000-000000000002';
const REQUEST = '00000000-0000-4000-8000-000000000003';
const gate = vi.hoisted(() => ({ approvals: 0 }));

vi.mock('@alga-psa/db', async () => {
  const fake = await import('./fakeCoManagedDb');
  return {
    tenantDb: (db: any, tenant: string) => fake.fakeTenantDb(db, tenant),
    tenantTableMetadata: {},
    withTransaction: async (db: any, work: any) => db.transaction(work),
    registerAfterCommit: () => undefined,
  };
});
vi.mock('@alga-psa/licensing/lifecycle', () => ({ assertCoManagedOperationalWrite: async () => undefined }));
vi.mock('../localAuthentication', () => ({
  snapshotCoManagedAuthenticatedActor: (actor: any) => ({ ...actor }),
  lockCoManagedLocalAuthentication: async (_t: any, actor: any) => ({ actor, subject: {}, assertCurrent: async () => undefined }),
}));
vi.mock('../meetingCreationOperation', async () => {
  const actual = await vi.importActual<typeof import('../meetingCreationOperation')>('../meetingCreationOperation');
  const prepare = async (trx: any, tenant: string, purpose: string, input: any, target: any) => {
    const store = (globalThis as any).__meetingStore as FakeStore;
    if (!store.rows('co_managed_meeting_creation_operations').some(r => r.operation_id === OP)) {
      store.seed('co_managed_meeting_creation_operations', {
        tenant, operation_id: OP, purpose, appointment_request_id: REQUEST, status: 'prepared', attempt_count: 0, requested_by: USER,
        credential_kind: 'session', credential_id: 'sess-1', creation_target: target, approval_input: input ?? null,
        provider_request: { subject: 'Visit', startDateTime: '2026-11-02T09:00:00Z', endDateTime: '2026-11-02T10:00:00Z' },
        created_at: '2026-10-29T00:00:00.000Z',
      });
    }
    return { handled: true as const, operationId: OP };
  };
  return {
    ...actual,
    prepareCoManagedAppointmentMeeting: (trx: any, tenant: string, input: any, target: any) => prepare(trx, tenant, 'approve', input, target),
    prepareCoManagedApprovedAppointmentMeeting: (trx: any, tenant: string, _id: string, target: any) => prepare(trx, tenant, 'generate', null, target),
    retainAppointmentMeetingSlot: async () => null,
  };
});
vi.mock('../nativeAppointmentApproval', () => ({
  approveCoManagedNativeAppointment: async () => { gate.approvals += 1; return { handled: true, request: { id: REQUEST, status: 'approved' } }; },
  retainAppointmentMeetingGenerationPlan: async () => undefined,
}));
vi.mock('../nativeAppointmentRequest', () => ({
  retainNativeAppointmentRequest: async () => ({}),
  nativeAppointmentRequestView: async () => ({ id: REQUEST, status: 'approved', onlineMeetingUrl: 'https://teams.example/join' }),
}));

import { approveCoManagedAppointmentWithMeeting, recoverCoManagedAppointmentMeeting, type AppointmentMeetingProvider } from '../appointmentMeetingCreation';

const target = { organizerUserId: 'org-1', organizerUpn: 'org@example.com', microsoftTenantId: 'ms-1' } as any;
const receipt = { eventId: 'evt-1', organizerUserId: 'org-1', organizerUpn: 'org@example.com', microsoftTenantId: 'ms-1', joinWebUrl: 'https://teams.example/join' };
const actor: any = { kind: 'session', tenant: TENANT, userId: USER, sessionId: 'sess-1' };
const identify = async () => actor;
const publish = async () => undefined;
const input: any = { id: REQUEST, assignedUserId: USER };

let store: FakeStore; let db: any;
const op = () => store.rows('co_managed_meeting_creation_operations').find(r => r.operation_id === OP)!;
function provider(over: Partial<AppointmentMeetingProvider> = {}) {
  const calls = { create: 0, recover: 0, remove: [] as any[] };
  const p: AppointmentMeetingProvider = {
    target: async () => ({ status: 'ready', target }),
    create: async () => { calls.create += 1; return { status: 'created', meeting: { eventId: 'evt-1', meetingId: 'm-1', joinWebUrl: receipt.joinWebUrl, organizerUserId: 'org-1', organizerUpn: 'org@example.com' } }; },
    recover: async () => { calls.recover += 1; return { status: 'absent' }; },
    remove: async r => { calls.remove.push(r); return { status: 'deleted' }; },
    ...over,
  };
  return { p, calls };
}
beforeEach(() => {
  ({ store, db } = createFake());
  (globalThis as any).__meetingStore = store;
  gate.approvals = 0;
  store.seed('tenants', { tenant: TENANT, product_code: 'co_managed', suspended_at: null });
  store.seed('appointment_requests', { tenant: TENANT, appointment_request_id: REQUEST, schedule_entry_id: null });
});

describe('approval with a Teams meeting', () => {
  it('creates once, attaches the online_meetings row and request join url, and approves', async () => {
    const { p, calls } = provider();
    const result: any = await approveCoManagedAppointmentWithMeeting(db, TENANT, input, identify, publish, p);
    expect(result.handled).toBe(true);
    expect(result.request.status).toBe('approved');
    expect(calls.create).toBe(1);
    expect(gate.approvals).toBe(1);
    expect(op()).toMatchObject({ status: 'attached', attempt_count: 1, provider_meeting_id: 'm-1' });
    expect(op().completed_at).toBeTruthy();
    expect(store.rows('online_meetings')).toEqual([expect.objectContaining({ provider: 'teams', provider_meeting_id: 'm-1', provider_event_id: 'evt-1', join_url: receipt.joinWebUrl, status: 'scheduled', appointment_request_id: REQUEST, created_by: USER })]);
    expect(store.rows('appointment_requests')[0]).toMatchObject({ online_meeting_id: 'm-1', online_meeting_provider: 'teams', online_meeting_url: receipt.joinWebUrl });
  });

  it('stores no credential secrets in creation_target or approval_input', async () => {
    const { p } = provider();
    await approveCoManagedAppointmentWithMeeting(db, TENANT, input, identify, publish, p);
    const text = JSON.stringify([op().creation_target, op().approval_input]);
    expect(text).not.toMatch(/token|secret|password|apiKey"/i);
    expect(op()).toMatchObject({ credential_kind: 'session', credential_id: 'sess-1' });
  });
});

describe('approval without a meeting', () => {
  it('approves locally with a warning when Teams is not ready, creating no operation', async () => {
    const { p, calls } = provider({ target: async () => ({ status: 'skipped', reason: 'not_configured' }) });
    const result: any = await approveCoManagedAppointmentWithMeeting(db, TENANT, input, identify, publish, p);
    expect(result).toMatchObject({ handled: true });
    expect(result.warning).toMatch(/without a Teams meeting/);
    expect(calls.create).toBe(0);
    expect(gate.approvals).toBe(1);
    expect(store.rows('co_managed_meeting_creation_operations')).toEqual([]);
    expect(store.rows('online_meetings')).toEqual([]);
  });

  it('a non-co_managed workspace is handled:false and the provider is never consulted', async () => {
    store.tables.tenants = [{ tenant: TENANT, product_code: 'psa', suspended_at: null }];
    const target = vi.fn();
    const { p } = provider({ target });
    expect(await approveCoManagedAppointmentWithMeeting(db, TENANT, input, identify, publish, p)).toEqual({ handled: false });
    expect(target).not.toHaveBeenCalled();
  });

  it('provider unavailable at create time approves without a meeting (operation cleaned)', async () => {
    const { p } = provider({ create: async () => ({ status: 'skipped', reason: 'off' }) });
    const result: any = await approveCoManagedAppointmentWithMeeting(db, TENANT, input, identify, publish, p);
    expect(result.warning).toMatch(/without a Teams meeting/);
    expect(op().status).toBe('cleaned');
    expect(gate.approvals).toBe(1);
    expect(store.rows('online_meetings')).toEqual([]);
  });

  it('a failed create is reported and NOT approved unless approveWithoutMeeting', async () => {
    const { p } = provider({ create: async () => ({ status: 'failed', errorCode: 'graph_500' }) });
    expect(await approveCoManagedAppointmentWithMeeting(db, TENANT, input, identify, publish, p)).toEqual({ handled: true, meetingCreationFailed: true });
    expect(gate.approvals).toBe(0);
    expect(op().status).toBe('cleanup_pending');
    const again = provider({ create: async () => ({ status: 'failed', errorCode: 'graph_500' }) });
    store.tables.co_managed_meeting_creation_operations = [];
    const result: any = await approveCoManagedAppointmentWithMeeting(db, TENANT, input, identify, publish, again.p, true);
    expect(result.warning).toMatch(/cleaned up/);
    expect(gate.approvals).toBe(1);
  });
});

describe('partial event cleanup', () => {
  const partial = { status: 'failed', errorCode: 'no_join_url', createdEvent: { ...receipt, joinWebUrl: null } } as const;

  it('a failed create with a partial event is cleanup_pending with the receipt retained', async () => {
    const { p } = provider({ create: async () => partial as any });
    const result: any = await approveCoManagedAppointmentWithMeeting(db, TENANT, input, identify, publish, p);
    expect(result.meetingCreationFailed).toBe(true);
    expect(op().status).toBe('cleanup_pending');
    expect(op().event_receipt).toMatchObject({ eventId: 'evt-1' });
    expect(store.rows('online_meetings')).toEqual([]);
  });

  it('recovery removes exactly that event and marks the operation cleaned', async () => {
    const { p } = provider({ create: async () => partial as any });
    await approveCoManagedAppointmentWithMeeting(db, TENANT, input, identify, publish, p);
    const recoverer = provider();
    expect(await recoverCoManagedAppointmentMeeting(db, TENANT, OP, recoverer.p, publish)).toEqual({ status: 'cleaned' });
    expect(recoverer.calls.remove).toEqual([expect.objectContaining({ eventId: 'evt-1', organizerUpn: 'org@example.com' })]);
    expect(op()).toMatchObject({ status: 'cleaned' });
    expect(op().completed_at).toBeTruthy();
  });

  it('a failed removal stays cleanup_pending for a bounded retry', async () => {
    const { p } = provider({ create: async () => partial as any });
    await approveCoManagedAppointmentWithMeeting(db, TENANT, input, identify, publish, p);
    const recoverer = provider({ remove: async () => ({ status: 'failed' }) });
    expect(await recoverCoManagedAppointmentMeeting(db, TENANT, OP, recoverer.p, publish)).toEqual({ status: 'retry' });
    expect(op().status).toBe('cleanup_pending');
    expect(op().completed_at).toBeFalsy();
  });

  it('a thrown provider error is recorded as a bounded failure and never escapes', async () => {
    const { p } = provider({ create: async () => { throw new Error('socket hang up'); } });
    const result: any = await approveCoManagedAppointmentWithMeeting(db, TENANT, input, identify, publish, p);
    expect(result.meetingCreationFailed).toBe(true);
    expect(op().last_error_code).toBe('provider_creation_failed');
    expect(JSON.stringify(op())).not.toContain('socket hang up');
  });
});
