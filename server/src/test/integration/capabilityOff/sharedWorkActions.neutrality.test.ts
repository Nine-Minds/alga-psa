import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A2/A3 neutrality at the action level. The real exported actions run with their collaborators
 * mocked at the process boundary; the real seams and capability evaluator decide the route.
 *
 * - psa path (Kansas flag-off, Emerald flag-on-no-entitlement, FORCE off): the spy provider is
 *   never called, the knex stand-in is never used by the dispatcher, and the native body runs.
 * - served path: the spy provider is called, and the native body does not run.
 */
const native = vi.hoisted(() => ({
  reached: vi.fn(),
  knexTouched: [] as string[],
}));
const nativeStop = 'native-body-reached';

vi.mock('@alga-psa/core/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

vi.mock('@alga-psa/db', () => {
  const builder: any = new Proxy({}, { get: () => () => builder, });
  return {
    createTenantKnex: async () => ({
      knex: new Proxy(function () {}, { get(_t, p) { native.knexTouched.push(String(p)); return () => { throw new Error('knex used'); }; } }),
      tenant: 'tenant-1',
    }),
    tenantDb: () => builder,
    withTransaction: async () => { native.reached('withTransaction'); throw new Error(nativeStop); },
    resolveEffectiveTimeZone: vi.fn(),
    registerAfterCommit: vi.fn(),
  };
});

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: unknown[]) => action({ user_id: 'user-1', tenant: 'tenant-1' }, { tenant: 'tenant-1' }, ...args),
  hasPermission: vi.fn(async () => { native.reached('hasPermission'); return false; }),
  getSession: vi.fn(),
  getApiKeyUserOverride: vi.fn(() => null),
}));
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(), publishWorkflowEvent: vi.fn(),
}));
vi.mock('@alga-psa/shared/models/scheduleEntry', () => ({
  default: new Proxy({}, { get: (_t, name) => (..._a: unknown[]) => { native.reached(`ScheduleEntry.${String(name)}`); throw new Error(nativeStop); } }),
}));
vi.mock('../../../../../packages/scheduling/src/lib/appointmentMeetingCreation', () => ({
  appointmentMeetingProvider: vi.fn(async () => ({})),
}));
vi.mock('../../../../../packages/clients/src/lib/authHelpers', () => ({
  assertMspPermission: vi.fn(async () => undefined),
  hasPermissionAsync: vi.fn(async () => true),
}));
vi.mock('../../../../../packages/clients/src/models/interactions', () => ({
  default: new Proxy({}, { get: (_t, name) => (..._a: unknown[]) => { native.reached(`InteractionModel.${String(name)}`); throw new Error(nativeStop); } }),
}));
vi.mock('../../../../../packages/clients/src/models/onlineMeeting', () => ({
  default: { getByInteractionId: vi.fn(async () => { native.reached('OnlineMeetingModel.getByInteractionId'); return null; }) },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { registerCapabilityParticipation } from '@alga-psa/core/capability';
import { clearCapabilityCache, resetCapabilityRegistry } from '@alga-psa/core/capability/testing';
import { scheduleSeam } from '../../../../../packages/scheduling/src/lib/sharedWorkScheduling';
import { interactionSeam } from '../../../../../packages/clients/src/lib/coManagedInteractionReader';
import {
  getScheduleEntries, addScheduleEntry, updateScheduleEntry, deleteScheduleEntry,
} from '../../../../../packages/scheduling/src/actions/scheduleActions';
import {
  approveAppointmentRequest, declineAppointmentRequest, updateAppointmentRequestDateTime,
  generateTeamsMeetingForApprovedRequest,
} from '../../../../../packages/scheduling/src/actions/appointmentRequestManagementActions';
import {
  addInteraction, getInteractionsPage, updateInteraction, deleteInteraction,
} from '../../../../../packages/clients/src/actions/interactionActions';
import { getOnlineMeetingForInteraction } from '../../../../../packages/clients/src/actions/onlineMeetingActions';

const UUID = '33333333-3333-4333-8333-333333333333';
const hit = {
  handled: true as const, entries: [], entry: { entry_id: 'e', scheduled_start: '2026-01-01T00:00:00Z', scheduled_end: '2026-01-01T01:00:00Z', recurrence_pattern: null },
  requests: [], request: {}, interactions: [], interaction: {}, meeting: null, total: 0, page: 1, pageSize: 10,
};
const verbs = ['readSchedules', 'commandSchedule', 'readAppointmentRequests', 'approveAppointment', 'approveAppointmentWithMeeting', 'declineAppointment', 'rescheduleAppointment', 'associateAppointmentTicket', 'generateAppointmentMeeting', 'readInteractions', 'readInteractionMeeting', 'createInteraction', 'updateInteraction', 'deleteInteraction'];
let spies: Record<string, ReturnType<typeof vi.fn>>;

const start = new Date('2026-01-01T00:00:00Z'), end = new Date('2026-01-02T00:00:00Z');
const entry: any = { title: 't', scheduled_start: start, scheduled_end: end, assigned_user_ids: ['user-1'], work_item_type: 'ad_hoc', work_item_id: null, status: 'SCHEDULED' };
const interactionData: any = { client_id: UUID, user_id: 'user-1', type_id: UUID, title: 'i', status_id: UUID };

type Case = { name: string; run: () => Promise<unknown>; verb: string; nativeSignals: string[] };
const cases: Case[] = [
  { name: 'getScheduleEntries', verb: 'readSchedules', nativeSignals: ['hasPermission'], run: () => (getScheduleEntries as any)(start, end) },
  { name: 'addScheduleEntry', verb: 'commandSchedule', nativeSignals: ['hasPermission'], run: () => (addScheduleEntry as any)(entry) },
  { name: 'updateScheduleEntry', verb: 'commandSchedule', nativeSignals: ['hasPermission'], run: () => (updateScheduleEntry as any)(UUID, { title: 'x' }) },
  { name: 'deleteScheduleEntry', verb: 'commandSchedule', nativeSignals: ['hasPermission'], run: () => (deleteScheduleEntry as any)(UUID) },
  { name: 'approveAppointmentRequest', verb: 'approveAppointment', nativeSignals: ['hasPermission'], run: () => (approveAppointmentRequest as any)({ appointment_request_id: UUID, assigned_user_id: UUID }) },
  { name: 'declineAppointmentRequest', verb: 'declineAppointment', nativeSignals: ['hasPermission'], run: () => (declineAppointmentRequest as any)({ appointment_request_id: UUID, decline_reason: 'no' }) },
  { name: 'updateAppointmentRequestDateTime', verb: 'rescheduleAppointment', nativeSignals: ['hasPermission'], run: () => (updateAppointmentRequestDateTime as any)({ appointment_request_id: UUID, new_date: '2026-02-03', new_time: '10:00' }) },
  { name: 'generateTeamsMeetingForApprovedRequest', verb: 'generateAppointmentMeeting', nativeSignals: ['hasPermission'], run: () => (generateTeamsMeetingForApprovedRequest as any)(UUID) },
  { name: 'addInteraction', verb: 'createInteraction', nativeSignals: ['withTransaction'], run: () => (addInteraction as any)(interactionData) },
  { name: 'getInteractionsPage', verb: 'readInteractions', nativeSignals: ['withTransaction'], run: () => (getInteractionsPage as any)({}) },
  { name: 'updateInteraction', verb: 'updateInteraction', nativeSignals: ['withTransaction'], run: () => (updateInteraction as any)(UUID, { title: 'x' }) },
  { name: 'deleteInteraction', verb: 'deleteInteraction', nativeSignals: ['withTransaction'], run: () => (deleteInteraction as any)(UUID) },
  { name: 'getOnlineMeetingForInteraction', verb: 'readInteractionMeeting', nativeSignals: ['OnlineMeetingModel.getByInteractionId'], run: () => (getOnlineMeetingForInteraction as any)(UUID) },
];

beforeEach(() => {
  delete process.env.FORCE_CAPABILITIES;
  resetCapabilityRegistry();
  scheduleSeam.reset();
  interactionSeam.reset();
  native.reached.mockClear();
  native.knexTouched.length = 0;
  spies = Object.fromEntries(verbs.map(v => [v, vi.fn(async () => hit)]));
  scheduleSeam.register(() => spies as any);
  interactionSeam.register(() => spies as any);
});

const reachedNative = (signals: string[]) => signals.every(s => native.reached.mock.calls.some(([name]) => name === s));
const swallow = async (run: () => Promise<unknown>) => { try { await run(); } catch { /* the native body may throw once it is reached */ } };

describe.each([
  ['Kansas (flag off, nothing participates)', () => undefined],
  ['Emerald (flag on, no entitlement)', () => registerCapabilityParticipation('co-managed', async () => new Set<string>())],
  ['participating tenant with FORCE_CAPABILITIES=co-managed:off', () => {
    registerCapabilityParticipation('co-managed', async ({ tenantIds }) => new Set(tenantIds));
    process.env.FORCE_CAPABILITIES = 'co-managed:off'; clearCapabilityCache();
  }],
])('%s', (_label, arrange) => {
  it.each(cases)('$name runs the native body and never reaches a provider', async ({ run, nativeSignals }) => {
    arrange();
    await swallow(run);
    for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
    expect(native.knexTouched).toEqual([]);
    expect(reachedNative(nativeSignals)).toBe(true);
  });
});

describe('participating tenant', () => {
  it.each(cases)('$name is handled by the provider and skips the native body', async ({ run, verb }) => {
    registerCapabilityParticipation('co-managed', async ({ tenantIds }) => new Set(tenantIds));
    await swallow(run);
    expect(spies[verb]).toHaveBeenCalledTimes(1);
    expect(native.reached).not.toHaveBeenCalled();
  });
});
