import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const state = { rows: [] as any[] };
  const createQuery = (rows: any[]) => {
    const filters: Record<string, unknown>[] = [];
    const filtered = () =>
      rows.filter((row) => filters.every((cond) => Object.entries(cond).every(([k, v]) => row[k] === v)));
    const query: any = {
      where(cond: Record<string, unknown>) {
        filters.push(cond);
        return query;
      },
      async first() {
        const [row] = filtered();
        return row ? { ...row } : undefined;
      },
    };
    return query;
  };
  const knexMock: any = () => createQuery(state.rows);
  return { state, knexMock, createQuery };
});

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: hoisted.knexMock }),
  tenantDb: (_knex: any, tenant: string) => ({
    table: () => hoisted.createQuery(hoisted.state.rows).where({ tenant }),
  }),
}));
vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({ getAppSecret: async () => undefined, getTenantSecret: async () => 'shh' }),
}));
vi.mock('@alga-psa/event-bus', () => ({ getRedisConfig: () => ({ url: 'redis://x', prefix: 'alga-psa:' }) }));

import {
  downloadThreecxRecording,
  findThreecxRecordingForCall,
  isThreecxRecordingComplete,
  pickThreecxRecording,
  threecxNumbersMatch,
  threecxRecordingMimeType,
  threecxRecordingToCallArtifacts,
  threecxRecordingsFilter,
  type ThreecxRecording,
} from './recordings';

const TENANT = 'tenant-1';

function seedProvider(xapi: boolean) {
  hoisted.state.rows.push({
    tenant: TENANT,
    provider: '3cx',
    status: 'active',
    config: JSON.stringify({
      templateVersion: 2,
      pbx: { baseUrl: 'https://pbx.example.com', clientId: '900', clientSecretRef: 'ref', status: 'connected', capabilities: { xapi, callControl: false } },
    }),
  });
}

function fakeClient(recordings: ThreecxRecording[]) {
  return {
    xapiGet: vi.fn(async () => ({ value: recordings })),
    xapiDownload: vi.fn(async () => new Uint8Array([82, 73, 70, 70])),
  } as any;
}

const transcribed: ThreecxRecording = {
  Id: 42,
  StartTime: '2026-09-15T10:00:05Z',
  FromCallerNumber: '5551234567',
  ToCallerNumber: '101',
  IsTranscribed: true,
  Transcription: 'Caller: my laptop will not boot.',
  Summary: 'Laptop boot failure.',
  RecordingUrl: 'https://pbx.example.com/recordings/42.wav',
};

describe('3CX recordings', () => {
  beforeEach(() => {
    hoisted.state.rows.length = 0;
  });

  it('T167: the filter brackets started_at by two minutes in ISO 8601', () => {
    expect(threecxRecordingsFilter(new Date('2026-09-15T10:00:00.000Z')))
      .toBe('StartTime ge 2026-09-15T09:58:00Z and StartTime le 2026-09-15T10:02:00Z');
  });

  it('T167: numbers match on digits regardless of national or E.164 form', () => {
    expect(threecxNumbersMatch('+1 (555) 123-4567', '5551234567')).toBe(true);
    expect(threecxNumbersMatch('15551234567', '+15551234567')).toBe(true);
    expect(threecxNumbersMatch('+15551234567', '+15559998888')).toBe(false);
    expect(threecxNumbersMatch('101', '101')).toBe(true);
    expect(threecxNumbersMatch('101', '1011')).toBe(false);
    expect(threecxNumbersMatch('', '')).toBe(false);
  });

  it('T167: picks the recording whose caller or callee is the external party', () => {
    const other: ThreecxRecording = { Id: 7, FromCallerNumber: '5559998888', ToCallerNumber: '101' };
    const outbound: ThreecxRecording = { Id: 8, FromCallerNumber: '102', ToCallerNumber: '5551234567' };
    expect(pickThreecxRecording([other, transcribed], '+15551234567')?.Id).toBe(42);
    expect(pickThreecxRecording([other, outbound], '+15551234567')?.Id).toBe(8);
    expect(pickThreecxRecording([other], '+15551234567')).toBeNull();
    expect(pickThreecxRecording([transcribed], null)).toBeNull();
  });

  it('T166: a tenant without the xapi capability is unsupported and the PBX is never asked', async () => {
    seedProvider(false);
    const client = fakeClient([transcribed]);

    const lookup = await findThreecxRecordingForCall({
      tenantId: TENANT,
      startedAt: '2026-09-15T10:00:00Z',
      externalNumber: '+15551234567',
      client,
    });

    expect(lookup).toEqual({ status: 'unsupported' });
    expect(client.xapiGet).not.toHaveBeenCalled();
  });

  it('T167: queries /Recordings with the StartTime window and returns the matching recording', async () => {
    seedProvider(true);
    const client = fakeClient([{ Id: 7, FromCallerNumber: '5559998888' }, transcribed]);

    const lookup = await findThreecxRecordingForCall({
      tenantId: TENANT,
      startedAt: '2026-09-15T10:00:00Z',
      externalNumber: '+15551234567',
      client,
    });

    expect(client.xapiGet).toHaveBeenCalledWith('/Recordings', {
      $filter: 'StartTime ge 2026-09-15T09:58:00Z and StartTime le 2026-09-15T10:02:00Z',
      $top: 100,
    });
    expect(lookup).toEqual({ status: 'found', recording: transcribed });
  });

  it('returns none when no recording matches or the call has no start time', async () => {
    seedProvider(true);
    const client = fakeClient([{ Id: 7, FromCallerNumber: '5559998888' }]);

    await expect(findThreecxRecordingForCall({ tenantId: TENANT, startedAt: '2026-09-15T10:00:00Z', externalNumber: '+15551234567', client }))
      .resolves.toEqual({ status: 'none' });
    await expect(findThreecxRecordingForCall({ tenantId: TENANT, startedAt: null, externalNumber: '+15551234567', client }))
      .resolves.toEqual({ status: 'none' });
  });

  it('T168/T170: a transcribed recording yields a transcript with its summary and a recording pointer', () => {
    expect(threecxRecordingToCallArtifacts(transcribed)).toEqual([
      {
        artifactType: 'transcript',
        providerArtifactId: '42',
        contentUrl: null,
        createdDateTime: '2026-09-15T10:00:05Z',
        transcriptContent: 'Caller: my laptop will not boot.',
        summary: 'Laptop boot failure.',
      },
      {
        artifactType: 'recording',
        providerArtifactId: '42',
        contentUrl: 'https://pbx.example.com/recordings/42.wav',
        createdDateTime: '2026-09-15T10:00:05Z',
      },
    ]);
    expect(isThreecxRecordingComplete(transcribed)).toBe(true);
  });

  it('T169: an untranscribed recording yields only the recording and is not complete', () => {
    const pending: ThreecxRecording = { ...transcribed, IsTranscribed: false, Transcription: null, Summary: null };
    expect(threecxRecordingToCallArtifacts(pending).map((a) => a.artifactType)).toEqual(['recording']);
    expect(isThreecxRecordingComplete(pending)).toBe(false);
    expect(threecxRecordingToCallArtifacts({ Id: 1, IsTranscribed: false })).toEqual([]);
  });

  it('T170: downloads through Pbx.DownloadRecording(recId=<Id>) and types by URL extension', async () => {
    const client = fakeClient([]);

    const bytes = await downloadThreecxRecording(TENANT, '42', { client });

    expect(client.xapiDownload).toHaveBeenCalledWith('/Recordings/Pbx.DownloadRecording(recId=42)');
    expect(Array.from(bytes)).toEqual([82, 73, 70, 70]);
    await expect(downloadThreecxRecording(TENANT, 'abc', { client })).rejects.toThrow('Invalid 3CX recording id');
    expect(threecxRecordingMimeType('https://pbx/rec/1.wav')).toBe('audio/wav');
    expect(threecxRecordingMimeType('https://pbx/rec/1.MP3?token=x')).toBe('audio/mpeg');
    expect(threecxRecordingMimeType(null)).toBe('audio/wav');
  });
});
