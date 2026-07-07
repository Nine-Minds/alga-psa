import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * T035-T037 / T050-T051: the Teams meeting cleanup job (idempotent Graph
 * deletion for cancel_pending rows) and the recurring sweep (webhook-less
 * recording polling + cleanup retries), both runner-agnostic handlers.
 */

const hoisted = vi.hoisted(() => {
  // The handlers snapshot EDITION at module load; force EE before import.
  process.env.EDITION = 'enterprise';
  return {
    getByIdMock: vi.fn(),
    updateMock: vi.fn(async () => null),
    listPendingRecordingsMock: vi.fn(async () => []),
    listPendingCleanupMock: vi.fn(async () => []),
    deleteTeamsMeetingWithResultMock: vi.fn(),
    resolveTeamsMeetingGraphConfigMock: vi.fn(),
    fetchAndPersistMeetingArtifactsMock: vi.fn(async () => ({})),
    isRecordingFetchDueMock: vi.fn(() => true),
    buildTeamsArtifactCaptureDepsMock: vi.fn(async () => ({ marker: 'capture-deps' })),
  };
});

vi.mock('@alga-psa/clients/models', () => ({
  OnlineMeetingModel: {
    getById: hoisted.getByIdMock,
    update: hoisted.updateMock,
    listPendingRecordings: hoisted.listPendingRecordingsMock,
    listPendingCleanup: hoisted.listPendingCleanupMock,
  },
}));

vi.mock('@alga-psa/ee-microsoft-teams/lib', () => ({
  deleteTeamsMeetingWithResult: hoisted.deleteTeamsMeetingWithResultMock,
  resolveTeamsMeetingGraphConfig: hoisted.resolveTeamsMeetingGraphConfigMock,
}));

vi.mock('@alga-psa/clients/lib/onlineMeetingArtifactCapture', () => ({
  fetchAndPersistMeetingArtifacts: hoisted.fetchAndPersistMeetingArtifactsMock,
  isRecordingFetchDue: hoisted.isRecordingFetchDueMock,
}));

vi.mock('@alga-psa/scheduling/actions', () => ({
  buildTeamsArtifactCaptureDeps: hoisted.buildTeamsArtifactCaptureDepsMock,
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { teamsMeetingCleanupHandler } from '@alga-psa/jobs/handlers/teamsMeetingCleanupHandler';
import { teamsMeetingSweepHandler } from '@alga-psa/jobs/handlers/teamsMeetingSweepHandler';

const TENANT = 'tenant-1';

function meeting(overrides: Record<string, unknown> = {}) {
  return {
    tenant: TENANT,
    meeting_id: 'meeting-row-1',
    provider: 'teams',
    provider_meeting_id: 'graph-meeting-1',
    provider_event_id: 'graph-event-1',
    status: 'cancel_pending',
    appointment_request_id: 'req-1',
    end_time: new Date('2026-07-01T10:00:00.000Z'),
    recording_fetch_attempts: 0,
    last_fetch_at: null,
    artifacts: [],
    ...overrides,
  };
}

describe('teamsMeetingCleanupHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.getByIdMock.mockResolvedValue(meeting());
    hoisted.deleteTeamsMeetingWithResultMock.mockResolvedValue({ status: 'deleted', alreadyDeleted: false });
  });

  it('T035: confirms cancel_pending → cancelled once Graph deletion succeeds', async () => {
    await teamsMeetingCleanupHandler({ tenantId: TENANT, meetingId: 'meeting-row-1' });

    expect(hoisted.deleteTeamsMeetingWithResultMock).toHaveBeenCalledWith({
      tenantId: TENANT,
      meetingId: 'graph-meeting-1',
      eventId: 'graph-event-1',
      appointmentRequestId: 'req-1',
    });
    expect(hoisted.updateMock).toHaveBeenCalledWith(
      'meeting-row-1',
      { status: 'cancelled', error_code: null },
      TENANT,
    );
  });

  it('T036: treats a Graph 404 (already deleted) as success — idempotent across retries', async () => {
    hoisted.deleteTeamsMeetingWithResultMock.mockResolvedValue({ status: 'deleted', alreadyDeleted: true });

    await teamsMeetingCleanupHandler({ tenantId: TENANT, meetingId: 'meeting-row-1' });

    expect(hoisted.updateMock).toHaveBeenCalledWith(
      'meeting-row-1',
      { status: 'cancelled', error_code: null },
      TENANT,
    );
  });

  it('T036: throws on transient Graph failure so the job runner retries, keeping cancel_pending', async () => {
    hoisted.deleteTeamsMeetingWithResultMock.mockResolvedValue({
      status: 'failed',
      errorCode: 'graph_server_error',
      errorMessage: 'boom',
    });

    await expect(
      teamsMeetingCleanupHandler({ tenantId: TENANT, meetingId: 'meeting-row-1' }),
    ).rejects.toThrow('graph_server_error');

    // Status not flipped to cancelled; only the error code is recorded.
    expect(hoisted.updateMock).toHaveBeenCalledWith(
      'meeting-row-1',
      { error_code: 'graph_server_error' },
      TENANT,
    );
    expect(hoisted.updateMock).not.toHaveBeenCalledWith(
      'meeting-row-1',
      expect.objectContaining({ status: 'cancelled' }),
      TENANT,
    );
  });

  it('no-ops when the meeting is not cancel_pending (idempotent re-delivery)', async () => {
    hoisted.getByIdMock.mockResolvedValue(meeting({ status: 'cancelled' }));

    await teamsMeetingCleanupHandler({ tenantId: TENANT, meetingId: 'meeting-row-1' });

    expect(hoisted.deleteTeamsMeetingWithResultMock).not.toHaveBeenCalled();
    expect(hoisted.updateMock).not.toHaveBeenCalled();
  });

  it('cancels failed-creation rows (no Graph meeting) without calling Graph', async () => {
    hoisted.getByIdMock.mockResolvedValue(meeting({ provider_meeting_id: null }));

    await teamsMeetingCleanupHandler({ tenantId: TENANT, meetingId: 'meeting-row-1' });

    expect(hoisted.deleteTeamsMeetingWithResultMock).not.toHaveBeenCalled();
    expect(hoisted.updateMock).toHaveBeenCalledWith('meeting-row-1', { status: 'cancelled' }, TENANT);
  });

  it('records skip reasons when the tenant can no longer reach Graph', async () => {
    hoisted.deleteTeamsMeetingWithResultMock.mockResolvedValue({ status: 'skipped', reason: 'addon_inactive' });

    await teamsMeetingCleanupHandler({ tenantId: TENANT, meetingId: 'meeting-row-1' });

    expect(hoisted.updateMock).toHaveBeenCalledWith(
      'meeting-row-1',
      { status: 'cancelled', error_code: 'cleanup_skipped_addon_inactive' },
      TENANT,
    );
  });
});

describe('teamsMeetingSweepHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.resolveTeamsMeetingGraphConfigMock.mockResolvedValue({ clientId: 'client-1' });
    hoisted.listPendingRecordingsMock.mockResolvedValue([]);
    hoisted.listPendingCleanupMock.mockResolvedValue([]);
    hoisted.isRecordingFetchDueMock.mockReturnValue(true);
    hoisted.getByIdMock.mockResolvedValue(meeting());
    hoisted.deleteTeamsMeetingWithResultMock.mockResolvedValue({ status: 'deleted', alreadyDeleted: false });
  });

  it('T051: skips the tenant entirely when Teams Graph config is unavailable (add-on gating)', async () => {
    hoisted.resolveTeamsMeetingGraphConfigMock.mockResolvedValue(null);

    await teamsMeetingSweepHandler({ tenantId: TENANT });

    expect(hoisted.listPendingRecordingsMock).not.toHaveBeenCalled();
    expect(hoisted.fetchAndPersistMeetingArtifactsMock).not.toHaveBeenCalled();
  });

  it('T050: fetches artifacts for due recording_pending meetings without any webhook', async () => {
    const dueMeeting = meeting({ meeting_id: 'due-1', status: 'recording_pending' });
    hoisted.listPendingRecordingsMock.mockResolvedValue([dueMeeting]);

    await teamsMeetingSweepHandler({ tenantId: TENANT });

    expect(hoisted.fetchAndPersistMeetingArtifactsMock).toHaveBeenCalledWith(
      { tenantId: TENANT, meetingId: 'due-1' },
      { marker: 'capture-deps' },
    );
  });

  it('T051: leaves meetings that are not yet due per the backoff schedule untouched', async () => {
    const dueMeeting = meeting({ meeting_id: 'due-1', status: 'recording_pending' });
    const notDueMeeting = meeting({ meeting_id: 'not-due-1', status: 'recording_pending' });
    hoisted.listPendingRecordingsMock.mockResolvedValue([dueMeeting, notDueMeeting]);
    hoisted.isRecordingFetchDueMock.mockImplementation(
      (candidate: any) => candidate.meeting_id === 'due-1',
    );

    await teamsMeetingSweepHandler({ tenantId: TENANT });

    expect(hoisted.fetchAndPersistMeetingArtifactsMock).toHaveBeenCalledTimes(1);
    expect(hoisted.fetchAndPersistMeetingArtifactsMock).toHaveBeenCalledWith(
      expect.objectContaining({ meetingId: 'due-1' }),
      expect.anything(),
    );
  });

  it('retries cleanup for cancel_pending rows left behind by lost jobs', async () => {
    hoisted.listPendingCleanupMock.mockResolvedValue([meeting({ meeting_id: 'stale-1' })]);
    hoisted.getByIdMock.mockResolvedValue(meeting({ meeting_id: 'stale-1' }));

    await teamsMeetingSweepHandler({ tenantId: TENANT });

    expect(hoisted.deleteTeamsMeetingWithResultMock).toHaveBeenCalledTimes(1);
    expect(hoisted.updateMock).toHaveBeenCalledWith(
      'stale-1',
      { status: 'cancelled', error_code: null },
      TENANT,
    );
  });

  it('isolates per-meeting fetch failures so one meeting cannot abort the sweep', async () => {
    hoisted.listPendingRecordingsMock.mockResolvedValue([
      meeting({ meeting_id: 'boom-1', status: 'recording_pending' }),
      meeting({ meeting_id: 'ok-1', status: 'recording_pending' }),
    ]);
    hoisted.fetchAndPersistMeetingArtifactsMock
      .mockRejectedValueOnce(new Error('graph down'))
      .mockResolvedValueOnce({} as any);

    await expect(teamsMeetingSweepHandler({ tenantId: TENANT })).resolves.toBeUndefined();
    expect(hoisted.fetchAndPersistMeetingArtifactsMock).toHaveBeenCalledTimes(2);
  });
});
