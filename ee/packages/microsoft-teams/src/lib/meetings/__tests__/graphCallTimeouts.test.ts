import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// N4: Teams Graph create/update/delete calls are time-bounded (30s), and a
// timeout/abort surfaces as a failed outcome. Main's Graph error-body
// handling on non-2xx responses is unchanged.

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../meetingConfig', () => ({
  resolveTeamsMeetingConfigState: vi.fn(async () => ({
    status: 'ready',
    config: {
      organizerUpn: 'organizer@example.com',
      organizerUserId: 'organizer-id',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      microsoftTenantId: 'ms-tenant',
      sendMeetingInvites: false,
    },
  })),
}));
vi.mock('../artifactSubscriptions', () => ({
  renewTeamsMeetingArtifactSubscriptions: vi.fn(async () => undefined),
}));
vi.mock('../../graphAuth', () => ({ fetchMicrosoftGraphAppToken: vi.fn(async () => 'token') }));
vi.mock('../../teams/microsoftEndpoints', () => ({
  getMicrosoftGraphBaseUrl: () => 'https://graph.example.com/v1.0',
}));

import { createTeamsMeetingWithResult } from '../createTeamsMeeting';
import { updateTeamsMeetingWithResult } from '../updateTeamsMeeting';
import { deleteTeamsMeetingWithResult } from '../deleteTeamsMeeting';

const fetchMock = vi.fn();

const calls = {
  create: () =>
    createTeamsMeetingWithResult({
      tenantId: 't1',
      subject: 'Sync',
      startDateTime: '2026-01-01T10:00:00',
      endDateTime: '2026-01-01T11:00:00',
    } as any),
  update: () =>
    updateTeamsMeetingWithResult({
      tenantId: 't1',
      meetingId: 'm1',
      eventId: 'e1',
      startDateTime: '2026-01-01T10:00:00',
      endDateTime: '2026-01-01T11:00:00',
    } as any),
  delete: () => deleteTeamsMeetingWithResult({ tenantId: 't1', meetingId: 'm1', eventId: 'e1' }),
};

describe.each(['create', 'update', 'delete'] as const)('Teams Graph %s call', (op) => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('passes an AbortSignal to the Graph request', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 500 }));
    await calls[op]();

    const init = fetchMock.mock.calls[0][1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('surfaces a timeout/abort as a failed outcome rather than hanging or throwing', async () => {
    fetchMock.mockRejectedValue(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));

    const outcome = (await calls[op]()) as any;

    expect(outcome.status).toBe('failed');
    expect(outcome.errorCode).toBe('exception');
    expect(outcome.errorMessage).toContain('timeout');
  });

  it('still reports the Graph error body on a non-2xx response', async () => {
    fetchMock.mockResolvedValue(
      new Response('{"error":{"code":"ErrorAccessDenied","message":"denied-by-graph"}}', { status: 403 })
    );

    const outcome = (await calls[op]()) as any;

    expect(outcome.status).toBe('failed');
    expect(outcome.errorCode).toBe('graph_unauthorized');
    expect(outcome.errorMessage).toContain('denied-by-graph');
  });
});

describe('Teams Graph create flow: every fetch is bounded', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('passes an AbortSignal on both the event POST and the onlineMeeting id lookup GET', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'event-1', onlineMeeting: { joinUrl: 'https://teams.example/join' } }), {
          status: 201,
        })
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ value: [{ id: 'meeting-1' }] }), { status: 200 }));

    const outcome = (await calls.create()) as any;

    expect(outcome.status).toBe('created');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map((c) => c[1].method)).toEqual(['POST', 'GET']);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('a timeout on the onlineMeeting id lookup surfaces as a failed outcome', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'event-1', onlineMeeting: { joinUrl: 'https://teams.example/join' } }), {
          status: 201,
        })
      )
      .mockRejectedValueOnce(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));

    const outcome = (await calls.create()) as any;

    expect(outcome.status).toBe('failed');
    expect(outcome.errorCode).toBe('exception');
  });
});
