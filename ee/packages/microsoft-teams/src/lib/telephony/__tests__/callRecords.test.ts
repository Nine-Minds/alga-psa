import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphCallRecord } from '../callRecords';

/**
 * Fixtures mirror what the msgraph emulator's `addCallRecord` builds, which in
 * turn mirrors real Graph: the PSTN leg lives on a session endpoint's
 * `identity.phone.id`, and an unanswered call carries `failureInfo` with a
 * zero-length session.
 */
function callRecordFixture(overrides: {
  id?: string;
  direction?: 'inbound' | 'outbound';
  answered?: boolean;
  durationSeconds?: number;
  callerNumber?: string;
  calleeNumber?: string;
} = {}): GraphCallRecord {
  const direction = overrides.direction ?? 'inbound';
  const answered = overrides.answered ?? true;
  const durationSeconds = answered ? overrides.durationSeconds ?? 120 : 0;
  const start = '2026-08-22T15:00:00Z';
  const end = new Date(new Date(start).getTime() + durationSeconds * 1000).toISOString();
  const phone = (id: string) => ({ identity: { phone: { id } } });
  const agent = () => ({ identity: { user: { id: 'agent-object-id', displayName: 'Emulated Agent' } } });

  return {
    id: overrides.id ?? 'call-record-1',
    type: 'peerToPeer',
    modalities: ['audio'],
    startDateTime: start,
    endDateTime: end,
    organizer: { user: { id: 'organizer-object-id' } },
    sessions: [
      {
        id: 'session-1',
        caller: direction === 'inbound' ? phone(overrides.callerNumber ?? '+15551234567') : agent(),
        callee: direction === 'inbound' ? agent() : phone(overrides.calleeNumber ?? '+15559990000'),
        startDateTime: start,
        endDateTime: end,
        modalities: ['audio'],
        failureInfo: answered ? null : { reason: 'The call was not answered.', stage: 'callSetup' },
      },
    ],
  };
}

const graphConfig = vi.hoisted(() => ({
  value: {
    microsoftTenantId: 'contoso.onmicrosoft.com',
    clientId: 'client-id',
    clientSecret: 'client-secret',
  } as Record<string, string> | null,
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../graphAuth', () => ({
  fetchMicrosoftGraphAppToken: vi.fn(async () => 'app-token'),
}));

vi.mock('../../meetings/meetingConfig', () => ({
  resolveTeamsMeetingGraphConfig: vi.fn(async () => graphConfig.value),
}));

import { fetchTeamsCallRecord, mapTeamsCallRecordToCanonical } from '../callRecords';

describe('mapTeamsCallRecordToCanonical', () => {
  it('T038: extracts the PSTN caller, direction and duration from an answered inbound CDR', () => {
    const mapped = mapTeamsCallRecordToCanonical(callRecordFixture({ durationSeconds: 210 }));

    expect(mapped).toMatchObject({
      provider: 'teams-phone',
      providerCallId: 'call-record-1',
      direction: 'inbound',
      durationSeconds: 210,
      modality: 'audio',
      organizerUserId: 'organizer-object-id',
      startedAt: '2026-08-22T15:00:00Z',
    });
    expect(mapped?.callerNumber).toEqual({ raw: '+15551234567', e164: '+15551234567' });
    // The agent side is an Entra identity, not a phone number.
    expect(mapped?.calleeNumber).toEqual({ raw: null, e164: null });
  });

  it('T038: an outbound CDR carries the dialled number on the callee side', () => {
    const mapped = mapTeamsCallRecordToCanonical(
      callRecordFixture({ direction: 'outbound', calleeNumber: '+15557654321' }),
    );

    expect(mapped).toMatchObject({ direction: 'outbound' });
    expect(mapped?.calleeNumber).toEqual({ raw: '+15557654321', e164: '+15557654321' });
    expect(mapped?.callerNumber).toEqual({ raw: null, e164: null });
  });

  it('T040: an unanswered inbound CDR maps to a missed call', () => {
    const mapped = mapTeamsCallRecordToCanonical(callRecordFixture({ answered: false }));

    expect(mapped).toMatchObject({ direction: 'missed', durationSeconds: 0 });
    expect(mapped?.callerNumber?.e164).toBe('+15551234567');
  });

  it('T040: an outbound call that never connected stays outbound', () => {
    const mapped = mapTeamsCallRecordToCanonical(
      callRecordFixture({ direction: 'outbound', answered: false }),
    );

    // "Missed" describes a call we failed to answer; an unanswered outbound is
    // still an outbound attempt.
    expect(mapped?.direction).toBe('outbound');
  });

  it('T038: a record without an id is unusable, because the id is the dedupe key', () => {
    expect(mapTeamsCallRecordToCanonical(null)).toBeNull();
    expect(mapTeamsCallRecordToCanonical({ sessions: [] } as GraphCallRecord)).toBeNull();
  });
});

describe('fetchTeamsCallRecord', () => {
  const previousMode = process.env.TEAMS_EMULATOR_MODE;
  const previousBaseUrl = process.env.MICROSOFT_GRAPH_BASE_URL;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    graphConfig.value = {
      microsoftTenantId: 'contoso.onmicrosoft.com',
      clientId: 'client-id',
      clientSecret: 'client-secret',
    };
    process.env.TEAMS_EMULATOR_MODE = 'true';
    process.env.MICROSOFT_GRAPH_BASE_URL = 'http://localhost:4010/v1.0';
    fetchMock = vi.fn(async () => new Response(JSON.stringify(callRecordFixture()), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env.TEAMS_EMULATOR_MODE = previousMode;
    process.env.MICROSOFT_GRAPH_BASE_URL = previousBaseUrl;
  });

  it('T037: fetches through the gated Graph base URL and expands sessions', async () => {
    const record = await fetchTeamsCallRecord({ tenantId: 'tenant-1', callRecordId: 'call-record-1' });

    expect(record?.id).toBe('call-record-1');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    // Sessions carry the PSTN leg, so the $expand is what makes the CDR usable.
    expect(url).toBe('http://localhost:4010/v1.0/communications/callRecords/call-record-1?$expand=sessions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer app-token');
  });

  it('T037: falls back to real Graph when the emulator gate is off', async () => {
    process.env.TEAMS_EMULATOR_MODE = 'false';

    await fetchTeamsCallRecord({ tenantId: 'tenant-1', callRecordId: 'call-record-1' });

    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://graph.microsoft.com/v1.0/communications/callRecords/call-record-1?$expand=sessions',
    );
  });

  it('T037: an unconfigured tenant never reaches Graph', async () => {
    graphConfig.value = null;

    await expect(fetchTeamsCallRecord({ tenantId: 'tenant-1', callRecordId: 'call-record-1' }))
      .resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('T037: a Graph error is reported as no record rather than a throw', async () => {
    fetchMock.mockResolvedValueOnce(new Response('forbidden', { status: 403 }));

    await expect(fetchTeamsCallRecord({ tenantId: 'tenant-1', callRecordId: 'call-record-1' }))
      .resolves.toBeNull();
  });
});
