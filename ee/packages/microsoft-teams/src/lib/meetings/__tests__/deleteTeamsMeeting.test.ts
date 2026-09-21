import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../meetingConfig', () => ({
  resolveTeamsMeetingGraphConfig: vi.fn(async () => ({ microsoftTenantId: 'ms-tenant', clientId: 'client-id', clientSecret: 'client-secret' })),
  resolveTeamsMeetingConfigState: vi.fn(async () => ({
    status: 'ready',
    config: {
      organizerUpn: 'organizer@example.com',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      microsoftTenantId: 'ms-tenant',
    },
  })),
}));

vi.mock('../../graphAuth', () => ({
  fetchMicrosoftGraphAppToken: vi.fn(async () => 'token'),
}));

vi.mock('../../teams/microsoftEndpoints', () => ({
  getMicrosoftGraphBaseUrl: () => 'https://graph.example.com/v1.0',
}));

// createTeamsMeeting pulls the whole meeting-creation graph in; only the
// status→code mapper is needed here.
vi.mock('../createTeamsMeeting', () => ({
  mapGraphStatusToMeetingErrorCode: (status: number) => `graph_${status}`,
}));

import { deleteTeamsMeeting, deleteTeamsMeetingWithResult } from '../deleteTeamsMeeting';
import { updateTeamsMeetingWithResult } from '../updateTeamsMeeting';

const fetchMock = vi.fn();

const INPUT = {
  tenantId: 'tenant-1',
  meetingId: 'graph-meeting-1',
  eventId: 'graph-event-1',
  appointmentRequestId: null,
};

describe('deleteTeamsMeetingWithResult', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('compensates a creation in its original directory without a currently configured organizer', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    expect(await deleteTeamsMeetingWithResult({ ...INPUT, organizerUserId: 'original-organizer', microsoftTenantId: 'ms-tenant' })).toEqual({ status: 'deleted', alreadyDeleted: false });
    expect(fetchMock.mock.lastCall?.[0]).toBe('https://graph.example.com/v1.0/users/original-organizer/events/graph-event-1');
  });

  it('rejects a different directory or incomplete creation receipt before any delete request', async () => {
    expect(await deleteTeamsMeetingWithResult({ ...INPUT, organizerUserId: 'original-organizer', microsoftTenantId: 'other-directory' })).toMatchObject({ status: 'failed', errorCode: 'creation_target_changed' });
    expect(await deleteTeamsMeetingWithResult({ ...INPUT, microsoftTenantId: 'ms-tenant' })).toMatchObject({ status: 'failed', errorCode: 'creation_target_changed' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reconciles deletion against the persisted organizer after the configured organizer changes', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    expect(await deleteTeamsMeetingWithResult({ ...INPUT, organizerUserId: 'original/organizer' })).toEqual({ status: 'deleted', alreadyDeleted: false });
    expect(fetchMock.mock.lastCall?.[0]).toBe('https://graph.example.com/v1.0/users/original%2Forganizer/events/graph-event-1');
    expect(fetchMock.mock.lastCall?.[1].signal).toBeInstanceOf(AbortSignal);
  });

  it('reconciles clock changes against the original organizer without adding undisclosed content or attendees', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    expect(await updateTeamsMeetingWithResult({ ...INPUT, organizerUserId: 'original-organizer', startDateTime: '2026-09-15T09:30:00Z', endDateTime: '2026-09-15T11:00:00Z' })).toEqual({ status: 'updated' });
    expect(fetchMock.mock.lastCall?.[0]).toBe('https://graph.example.com/v1.0/users/original-organizer/events/graph-event-1');
    expect(JSON.parse(fetchMock.mock.lastCall?.[1].body)).toEqual({ start: { dateTime: '2026-09-15T09:30:00Z', timeZone: 'UTC' }, end: { dateTime: '2026-09-15T11:00:00Z', timeZone: 'UTC' } });
    expect(fetchMock.mock.lastCall?.[1].signal).toBeInstanceOf(AbortSignal);
  });

  it('treats an already-deleted meeting (Graph 404) as success', async () => {
    // The schedule-entry deletion sweep retries retraction for rows that were
    // cancelled locally (e.g. migration-collapsed duplicates) — an event that
    // is already gone must therefore be success, not an error.
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));

    const outcome = await deleteTeamsMeetingWithResult(INPUT);

    expect(outcome).toEqual({ status: 'deleted', alreadyDeleted: true });
    await expect(deleteTeamsMeeting(INPUT)).resolves.toBe(true);
  });

  it('reports other Graph errors as failed without throwing', async () => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 500 }));

    const outcome = await deleteTeamsMeetingWithResult(INPUT);

    expect(outcome.status).toBe('failed');
    await expect(deleteTeamsMeeting(INPUT)).resolves.toBe(false);
  });

  it('catches transport exceptions and reports failed without throwing', async () => {
    fetchMock.mockRejectedValue(new Error('connection reset'));

    const outcome = await deleteTeamsMeetingWithResult(INPUT);

    expect(outcome).toEqual({
      status: 'failed',
      errorCode: 'exception',
      errorMessage: 'connection reset',
    });
    await expect(deleteTeamsMeeting(INPUT)).resolves.toBe(false);
  });

  it('deletes a live meeting successfully', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    const outcome = await deleteTeamsMeetingWithResult(INPUT);

    expect(outcome).toEqual({ status: 'deleted', alreadyDeleted: false });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      'https://graph.example.com/v1.0/users/organizer%40example.com/events/graph-event-1',
    );
    expect(init.method).toBe('DELETE');
  });
});
