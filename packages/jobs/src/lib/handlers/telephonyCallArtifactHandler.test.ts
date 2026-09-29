import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The per-provider dispatch behind the artifact sweep: Teams keeps its Graph
 * fetcher, 3CX gets a fetcher keyed on the record's provider that maps the
 * PBX recording lookup onto the vendor-neutral capture contract, and its
 * recordings are always stored (the PBX URL is useless without a bearer).
 */
const mocks = vi.hoisted(() => ({
  fetchTeams: vi.fn(async () => []),
  downloadTeams: vi.fn(async () => ({ buffer: Buffer.from('mp4'), contentType: 'video/mp4' })),
  findRecording: vi.fn(),
  downloadRecording: vi.fn(async () => new Uint8Array([1, 2, 3])),
  uploadFile: vi.fn(async () => ({ file_id: 'file-1' })),
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@alga-psa/db', () => ({
  runWithTenant: async (_tenantId: string, fn: () => Promise<unknown>) => fn(),
  createTenantKnex: async () => ({ knex: {} }),
  tenantDb: () => ({ table: () => ({ first: async () => undefined }) }),
}));

vi.mock('@alga-psa/ee-microsoft-teams/lib', () => ({
  fetchTeamsCallArtifacts: mocks.fetchTeams,
  downloadTeamsCallArtifactContent: mocks.downloadTeams,
  annotateLinkedTicketFromTranscript: undefined,
}));

vi.mock('@alga-psa/ee-threecx/lib', async () => {
  const actual = await vi.importActual<any>('@alga-psa/ee-threecx/lib/recordings');
  return {
    findThreecxRecordingForCall: mocks.findRecording,
    downloadThreecxRecording: mocks.downloadRecording,
    threecxRecordingToCallArtifacts: actual.threecxRecordingToCallArtifacts,
    isThreecxRecordingComplete: actual.isThreecxRecordingComplete,
    threecxRecordingMimeType: actual.threecxRecordingMimeType,
    threecxRecordingFileExtension: actual.threecxRecordingFileExtension,
  };
});

vi.mock('@alga-psa/storage/StorageService', () => ({
  StorageService: { uploadFile: mocks.uploadFile },
}));

const call = {
  tenant: 'tenant-1',
  call_record_id: 'call-record-1',
  provider: '3cx',
  provider_call_id: 'hash-1',
  direction: 'inbound',
  caller_number_raw: '5551234567',
  caller_number_e164: '+15551234567',
  callee_number_raw: null,
  callee_number_e164: null,
  started_at: '2026-09-15T10:00:00Z',
} as any;

let buildTelephonyCallArtifactDeps: () => Promise<any>;

beforeAll(async () => {
  process.env.EDITION = 'ee';
  ({ buildTelephonyCallArtifactDeps } = await import('./telephonyCallArtifactHandler'));
});

describe('buildTelephonyCallArtifactDeps (3cx)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('T166: the 3cx fetcher reports unsupported when the tenant lacks the xapi capability', async () => {
    mocks.findRecording.mockResolvedValue({ status: 'unsupported' });
    const deps = await buildTelephonyCallArtifactDeps();

    await expect(deps.providerFetchers['3cx']({ tenantId: 'tenant-1', call })).resolves.toEqual({ status: 'unsupported' });
    expect(mocks.findRecording).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      startedAt: '2026-09-15T10:00:00Z',
      externalNumber: '+15551234567',
    });
    expect(mocks.fetchTeams).not.toHaveBeenCalled();
  });

  it('T167: the fetcher asks for the callee on outbound calls and returns no artifacts when nothing matches', async () => {
    mocks.findRecording.mockResolvedValue({ status: 'none' });
    const deps = await buildTelephonyCallArtifactDeps();

    const result = await deps.providerFetchers['3cx']({
      tenantId: 'tenant-1',
      call: { ...call, direction: 'outbound', caller_number_e164: null, callee_number_e164: '+15559998888' },
    });

    expect(result).toEqual({ status: 'fetched', artifacts: [] });
    expect(mocks.findRecording).toHaveBeenCalledWith(expect.objectContaining({ externalNumber: '+15559998888' }));
  });

  it('T168/T169: a found recording maps to artifacts and is complete only once transcribed', async () => {
    mocks.findRecording.mockResolvedValue({
      status: 'found',
      recording: { Id: 42, StartTime: '2026-09-15T10:00:05Z', IsTranscribed: false, RecordingUrl: 'https://pbx/rec/42.wav' },
    });
    const deps = await buildTelephonyCallArtifactDeps();

    const pending = await deps.providerFetchers['3cx']({ tenantId: 'tenant-1', call });
    expect(pending).toEqual({
      status: 'fetched',
      complete: false,
      artifacts: [{ artifactType: 'recording', providerArtifactId: '42', contentUrl: 'https://pbx/rec/42.wav', createdDateTime: '2026-09-15T10:00:05Z' }],
    });

    mocks.findRecording.mockResolvedValue({
      status: 'found',
      recording: { Id: 42, IsTranscribed: true, Transcription: 'Hi.', Summary: 'Greeting.', RecordingUrl: 'https://pbx/rec/42.wav' },
    });
    const done = await deps.providerFetchers['3cx']({ tenantId: 'tenant-1', call });
    expect(done.complete).toBe(true);
    expect(done.artifacts.map((a: any) => a.artifactType)).toEqual(['transcript', 'recording']);
    expect(done.artifacts[0]).toMatchObject({ transcriptContent: 'Hi.', summary: 'Greeting.' });
  });

  it('T170: a 3cx recording is downloaded from the PBX and stored as audio', async () => {
    const deps = await buildTelephonyCallArtifactDeps();

    const fileId = await deps.downloadRecording({
      tenantId: 'tenant-1',
      call,
      artifact: { artifactType: 'recording', providerArtifactId: '42', contentUrl: 'https://pbx/rec/42.wav', createdDateTime: null },
      actorUserId: 'user-system',
    });

    expect(fileId).toBe('file-1');
    expect(mocks.downloadRecording).toHaveBeenCalledWith('tenant-1', '42');
    expect(mocks.downloadTeams).not.toHaveBeenCalled();
    expect(mocks.uploadFile).toHaveBeenCalledWith(
      'tenant-1',
      Buffer.from([1, 2, 3]),
      'call-hash-1-42.wav',
      expect.objectContaining({
        mime_type: 'audio/wav',
        uploaded_by_id: 'user-system',
        origin: 'system-artifact',
        metadata: expect.objectContaining({ source: 'threecx_call_recording', call_record_id: 'call-record-1' }),
      }),
    );
  });

  it('3cx recordings are always stored; Teams keeps the tenant opt-in', async () => {
    const deps = await buildTelephonyCallArtifactDeps();

    await expect(deps.loadSettings('tenant-1', '3cx')).resolves.toEqual({ downloadRecordings: true, exposeRecordingsInPortal: false });
    await expect(deps.loadSettings('tenant-1', 'teams-phone')).resolves.toEqual({ downloadRecordings: false, exposeRecordingsInPortal: false });
  });

  it('a Teams recording still goes through the Graph download', async () => {
    const deps = await buildTelephonyCallArtifactDeps();

    await deps.downloadRecording({
      tenantId: 'tenant-1',
      call: { ...call, provider: 'teams-phone', provider_call_id: 'graph-1' },
      artifact: { artifactType: 'recording', providerArtifactId: 'rec-1', contentUrl: 'https://graph/rec', createdDateTime: null },
      actorUserId: 'user-system',
    });

    expect(mocks.downloadTeams).toHaveBeenCalledWith({ tenantId: 'tenant-1', contentUrl: 'https://graph/rec' });
    expect(mocks.downloadRecording).not.toHaveBeenCalled();
    expect(mocks.uploadFile).toHaveBeenCalledWith('tenant-1', expect.anything(), 'call-graph-1-rec-1.mp4', expect.objectContaining({ mime_type: 'video/mp4' }));
  });
});
