import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sharedWorkSeam } from '@alga-psa/shared/utils/sharedWorkSeam';

/**
 * A5 image boot isolation. The recurring Teams sweep runs for every tenant on every worker, so it must
 * import and run natively when no co-managed provider was registered on the 'meetingReconciliation'
 * shared-work seam (package unresolved at boot), when the co-managed tables or columns are absent, and
 * when participation cannot be determined. The sweep never names the co-managed package.
 */
const hoisted = vi.hoisted(() => {
  process.env.EDITION = 'enterprise';
  return {
    served: { value: true as boolean | 'throw' },
    providerBuilt: vi.fn(),
    listDue: vi.fn(),
    listSyncs: vi.fn(),
    recover: vi.fn(async () => ({ status: 'attached' })),
    sync: vi.fn(async () => ({ status: 'synchronized' })),
    getConnection: vi.fn(async () => ({ marker: 'db' })),
    listPendingRecordings: vi.fn(async () => [{ meeting_id: 'native-1' }]),
    listPendingCleanup: vi.fn(async () => [{ meeting_id: 'native-cleanup-1' }]),
    fetchArtifacts: vi.fn(async () => ({})),
    cleanup: vi.fn(async () => undefined),
  };
});

vi.mock('@alga-psa/core/capability', () => ({
  serves: vi.fn(async () => {
    if (hoisted.served.value === 'throw') throw new Error('capability gate unavailable');
    return { served: hoisted.served.value };
  }),
}));
vi.mock('@alga-psa/db', () => ({ getConnection: hoisted.getConnection }));
vi.mock('@alga-psa/scheduling/lib/appointmentMeetingCreation', () => ({
  listDueCoManagedAppointmentMeetingOperations: hoisted.listDue,
  appointmentMeetingProvider: vi.fn(async () => ({ marker: 'provider' })),
  appointmentReconciliationPublisher: vi.fn(async () => vi.fn()),
}));
vi.mock('@alga-psa/scheduling/lib/scheduleMeetingSynchronization', () => ({
  listPendingScheduleMeetingSyncs: hoisted.listSyncs,
  scheduleMeetingSyncDelivery: vi.fn(async () => vi.fn()),
}));
vi.mock('@alga-psa/clients/models', () => ({
  OnlineMeetingModel: { listPendingRecordings: hoisted.listPendingRecordings, listPendingCleanup: hoisted.listPendingCleanup },
}));
vi.mock('@alga-psa/ee-microsoft-teams/lib', () => ({ resolveTeamsMeetingGraphConfig: vi.fn(async () => ({ clientId: 'c' })) }));
vi.mock('@alga-psa/clients/lib/onlineMeetingArtifactCapture', () => ({
  fetchAndPersistMeetingArtifacts: hoisted.fetchArtifacts, isRecordingFetchDue: () => true,
}));
vi.mock('@alga-psa/scheduling/actions', () => ({ buildTeamsArtifactCaptureDeps: vi.fn(async () => ({})) }));
vi.mock('@alga-psa/jobs/handlers/teamsMeetingCleanupHandler', () => ({ teamsMeetingCleanupHandler: hoisted.cleanup }));
vi.mock('@alga-psa/core/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const seam = sharedWorkSeam('meetingReconciliation');

// The handler is imported fresh per test; `registered` decides whether a co-managed provider is on the
// seam (co-managed's schedulingRegistration ran at boot) or absent (the package failed to resolve).
async function loadHandler(registered: boolean) {
  vi.resetModules();
  seam.reset();
  if (registered) {
    seam.register(() => {
      hoisted.providerBuilt();
      return { recoverAppointmentMeeting: hoisted.recover, synchronizeScheduleMeeting: hoisted.sync };
    });
  }
  return (await import('@alga-psa/jobs/handlers/teamsMeetingSweepHandler')).teamsMeetingSweepHandler;
}

const TENANT = 'tenant-1';
async function expectNativeSweepRan() {
  expect(hoisted.fetchArtifacts).toHaveBeenCalledWith({ tenantId: TENANT, meetingId: 'native-1' }, expect.anything());
}

describe('teamsMeetingSweepHandler co-managed isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.served.value = true;
    hoisted.listDue.mockResolvedValue([]);
    hoisted.listSyncs.mockResolvedValue([]);
  });

  it('the sweep module has no static co-managed import and its native selectors do not name co-managed storage', () => {
    const source = readFileSync(resolve(__dirname, '../../../../../packages/jobs/src/lib/handlers/teamsMeetingSweepHandler.ts'), 'utf8');
    expect(source).not.toMatch(/@alga-psa\/co-managed/);
    expect(source).not.toMatch(/^import[^\n]*lib\/(appointmentMeetingCreation|scheduleMeetingSynchronization)/m);
    expect(source).not.toMatch(/co_managed_(sync|meeting)/);
  });

  it('a non-participating tenant never builds the co-managed provider or opens a co-managed query', async () => {
    hoisted.served.value = false;
    const teamsMeetingSweepHandler = await loadHandler(true);
    await teamsMeetingSweepHandler({ tenantId: TENANT });
    expect(hoisted.providerBuilt).not.toHaveBeenCalled();
    expect(hoisted.getConnection).not.toHaveBeenCalled();
    expect(hoisted.listDue).not.toHaveBeenCalled();
    await expectNativeSweepRan();
    expect(hoisted.cleanup).toHaveBeenCalledWith({ tenantId: TENANT, meetingId: 'native-cleanup-1' });
  });

  it('still sweeps natively when no co-managed provider was registered (package unresolved at boot)', async () => {
    const teamsMeetingSweepHandler = await loadHandler(false);
    await expect(teamsMeetingSweepHandler({ tenantId: TENANT })).resolves.toBeUndefined();
    expect(hoisted.providerBuilt).not.toHaveBeenCalled();
    expect(hoisted.getConnection).not.toHaveBeenCalled();
    expect(hoisted.listDue).not.toHaveBeenCalled();
    await expectNativeSweepRan();
    expect(hoisted.cleanup).toHaveBeenCalled();
  });

  it('still sweeps natively when the co-managed table or columns are absent', async () => {
    hoisted.listDue.mockRejectedValue(Object.assign(new Error('relation "co_managed_meeting_creation_operations" does not exist'), { code: '42P01' }));
    hoisted.listSyncs.mockRejectedValue(Object.assign(new Error('column "co_managed_sync_operation_id" does not exist'), { code: '42703' }));
    const teamsMeetingSweepHandler = await loadHandler(true);
    await expect(teamsMeetingSweepHandler({ tenantId: TENANT })).resolves.toBeUndefined();
    await expectNativeSweepRan();
  });

  it('still sweeps natively when participation cannot be determined', async () => {
    hoisted.served.value = 'throw';
    const teamsMeetingSweepHandler = await loadHandler(true);
    await expect(teamsMeetingSweepHandler({ tenantId: TENANT })).resolves.toBeUndefined();
    expect(hoisted.providerBuilt).not.toHaveBeenCalled();
    await expectNativeSweepRan();
  });

  it('a participating tenant reconciles each durable operation and one failing operation does not stop the rest', async () => {
    hoisted.listDue.mockResolvedValue(['op-1', 'op-2']);
    hoisted.listSyncs.mockResolvedValue([{ meetingId: 'm-1', operationId: 's-1' }]);
    hoisted.recover.mockRejectedValueOnce(new Error('graph down'));
    const teamsMeetingSweepHandler = await loadHandler(true);
    await teamsMeetingSweepHandler({ tenantId: TENANT });
    expect(hoisted.recover.mock.calls.map(call => (call as unknown[])[2])).toEqual(['op-1', 'op-2']);
    expect(hoisted.sync).toHaveBeenCalledWith({ marker: 'db' }, { tenant: TENANT, meetingId: 'm-1', operationId: 's-1' }, expect.any(Function));
    await expectNativeSweepRan();
  });

  it('co-managed registers the real recovery and sync verbs on the seam the sweep resolves', async () => {
    seam.reset();
    vi.resetModules();
    const registration = await import('@alga-psa/co-managed/schedulingRegistration');
    const [{ recoverCoManagedAppointmentMeeting }, { synchronizeNativeScheduleMeeting }] = await Promise.all([
      import('@alga-psa/co-managed/appointmentMeetingCreation'),
      import('@alga-psa/co-managed/nativeScheduleMeetingSync'),
    ]);
    expect(seam.hasProvider()).toBe(true);
    expect(registration.coManagedMeetingReconciliationProvider).toEqual({
      recoverAppointmentMeeting: recoverCoManagedAppointmentMeeting,
      synchronizeScheduleMeeting: synchronizeNativeScheduleMeeting,
    });
    hoisted.served.value = true;
    expect(await seam.resolve(TENANT)).toBe(registration.coManagedMeetingReconciliationProvider);
  });
});
